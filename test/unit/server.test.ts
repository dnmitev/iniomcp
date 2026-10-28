import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createServer } from '../../src/server.ts';
import type { Config } from '../../src/config.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PKG = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')));

const SECRET = 's3cr3t';
const TOKEN = 'tok-server-test-do-not-leak';
const ID = '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b';
const AUTH_URL = 'https://kc.example/realms/api/protocol/openid-connect/token';
const API_URL = 'https://api.example/v1';

const CONFIG: Config = {
  clientId: 'mcp-client',
  clientSecret: SECRET,
  authUrl: AUTH_URL,
  apiUrl: API_URL,
  allowWrites: false,
  revealPii: false,
  transport: 'stdio',
  logLevel: 'info',
};

const INVOICE = { id: ID, number: 'INV-1', total: 10, IBAN: 'BG80BNBG96611020345678' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function fakeFetch() {
  return vi.fn<typeof globalThis.fetch>((input) => {
    const url = urlOf(input);
    if (url === AUTH_URL) return Promise.resolve(json({ access_token: TOKEN, expires_in: 300 }));
    if (url === `${API_URL}/invoices/${ID}`) {
      return Promise.resolve(json({ success: true, status: 200, result: INVOICE }));
    }
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
}

function fakeLogger() {
  return {
    debug: vi.fn<(obj: object, msg?: string) => void>(),
    info: vi.fn<(obj: object, msg?: string) => void>(),
    warn: vi.fn<(obj: object, msg?: string) => void>(),
  };
}

let mcpClient: Client | undefined;

afterEach(async () => {
  await mcpClient?.close();
  mcpClient = undefined;
});

async function connect(config: Config = CONFIG) {
  const fetch = fakeFetch();
  const logger = fakeLogger();
  const server = createServer(config, { fetch, logger });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  mcpClient = client;
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, fetch, logger };
}

describe('createServer', () => {
  it('identifies as inio-mcp with the package.json version', async () => {
    const { client } = await connect();
    expect(client.getServerVersion()).toMatchObject({ name: 'inio-mcp', version: PKG.version });
  });

  it('lists exactly the get_invoice tool', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['get_invoice']);
  });

  it('wires config, token provider, client and tool so get_invoice returns the redacted invoice', async () => {
    const { client, fetch } = await connect();
    const result = await client.callTool({ name: 'get_invoice', arguments: { id: ID } });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify({ ...INVOICE, IBAN: '[redacted]' }) },
    ]);
    expect(fetch.mock.calls.map(([url]) => urlOf(url))).toEqual([
      AUTH_URL,
      `${API_URL}/invoices/${ID}`,
    ]);
  });

  it('sends the configured client credentials to the token endpoint', async () => {
    const { client, fetch } = await connect();
    await client.callTool({ name: 'get_invoice', arguments: { id: ID } });
    const raw = fetch.mock.calls[0]?.[1]?.body;
    const body = new URLSearchParams(
      raw instanceof URLSearchParams ? raw : typeof raw === 'string' ? raw : '',
    );
    expect(body.get('client_id')).toBe('mcp-client');
    expect(body.get('client_secret')).toBe(SECRET);
  });

  it('sends the fetched token to the API', async () => {
    const { client, fetch } = await connect();
    await client.callTool({ name: 'get_invoice', arguments: { id: ID } });
    const headers = new Headers(fetch.mock.calls[1]?.[1]?.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('passes revealPii from config to the tool', async () => {
    const { client } = await connect({ ...CONFIG, revealPii: true });
    const result = await client.callTool({ name: 'get_invoice', arguments: { id: ID } });
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(INVOICE) }]);
  });

  it('logs the tool call through the injected logger', async () => {
    const { client, logger } = await connect();
    await client.callTool({ name: 'get_invoice', arguments: { id: ID } });
    const toolCalls = logger.info.mock.calls.filter(([, msg]) => msg === 'tool call');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.[0]).toMatchObject({ tool: 'get_invoice', outcome: 'ok' });
  });

  it('threads the logger into the API client', async () => {
    const { client, logger } = await connect();
    await client.callTool({ name: 'get_invoice', arguments: { id: ID } });
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: `/invoices/${ID}`, status: 200 }),
      'upstream request',
    );
  });

  it('never logs the client secret or token', async () => {
    const { client, logger } = await connect();
    await client.callTool({ name: 'get_invoice', arguments: { id: ID } });
    const logged = JSON.stringify([
      logger.debug.mock.calls,
      logger.info.mock.calls,
      logger.warn.mock.calls,
    ]);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain(TOKEN);
  });
});

const SPAWN_TIMEOUT = 15_000;

describe('stdio entry point (spawned process)', () => {
  it(
    'serves get_invoice over stdio and logs a JSON startup line to stderr',
    async () => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ['src/index.ts'],
        cwd: ROOT,
        env: {
          PATH: process.env.PATH ?? '',
          INIO_CLIENT_ID: 'x',
          INIO_CLIENT_SECRET: SECRET,
          INIO_AUTH_URL: 'http://127.0.0.1:9/token',
          INIO_URL: 'http://127.0.0.1:9/v1',
        },
        stderr: 'pipe',
      });
      let stderr = '';
      transport.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      const transportErrors: unknown[] = [];
      const client = new Client({ name: 'spawn-test', version: '0.0.0' });
      client.onerror = (e) => transportErrors.push(e);
      mcpClient = client;
      await client.connect(transport);

      expect(client.getServerVersion()).toMatchObject({ name: 'inio-mcp', version: PKG.version });
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(['get_invoice']);

      await vi.waitFor(() => expect(stderr).toContain('server started'), { timeout: 5_000 });
      await client.close();
      mcpClient = undefined;

      expect(transportErrors).toEqual([]);
      const lines = stderr.split('\n').filter((l) => l.trim() !== '');
      const parsed = lines.map((l) => z.record(z.string(), z.unknown()).parse(JSON.parse(l)));
      const startup = parsed.filter((l) => l.msg === 'server started');
      expect(startup).toHaveLength(1);
      expect(startup[0]).toMatchObject({
        level: 30,
        msg: 'server started',
        version: PKG.version,
        transport: 'stdio',
        allowWrites: false,
        revealPii: false,
        logLevel: 'info',
      });
      expect(stderr).not.toContain(SECRET);
    },
    SPAWN_TIMEOUT,
  );

  it(
    'exits 1 with the config error on stderr and nothing on stdout when env is empty',
    () => {
      const res = spawnSync(process.execPath, ['src/index.ts'], {
        cwd: ROOT,
        env: { PATH: process.env.PATH ?? '' },
        encoding: 'utf8',
        timeout: SPAWN_TIMEOUT,
        input: '',
      });
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('Invalid Inio MCP configuration');
      expect(res.stderr).toContain('INIO_CLIENT_ID is required');
      expect(res.stdout).toBe('');
    },
    SPAWN_TIMEOUT,
  );
});
