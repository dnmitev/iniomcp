import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createHttpHandler, startHttpServer } from '../../src/http.ts';
import type { HttpConfig } from '../../src/http.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SECRET = 's3cr3t';
const BEARER = 'mcp-bearer-0123456789-abcdefghijklmnopqrstuvwxyz';
const WRONG = 'wrong-bearer-0123456789-abcdefghijklmnopqrstuvwx';
const UPSTREAM_TOKEN = 'tok-upstream-do-not-leak';
const ID = '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b';
const AUTH_URL = 'https://kc.example/realms/api/protocol/openid-connect/token';
const API_URL = 'https://api.example/v1';
const URL_MCP = 'http://127.0.0.1:3000/mcp';

const CONFIG: HttpConfig = {
  clientId: 'mcp-client',
  clientSecret: SECRET,
  authUrl: AUTH_URL,
  apiUrl: API_URL,
  allowWrites: false,
  revealPii: false,
  transport: 'http',
  logLevel: 'info',
  requestTimeoutMs: 30000,
  http: {
    port: 0,
    host: '127.0.0.1',
    authToken: BEARER,
    allowedOrigins: ['https://app.example'],
  },
};

const INIT_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 't', version: '0' },
  },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeFetch() {
  return vi.fn<typeof globalThis.fetch>((input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === AUTH_URL) {
      return Promise.resolve(json({ access_token: UPSTREAM_TOKEN, expires_in: 300 }));
    }
    if (url === `${API_URL}/invoices/${ID}`) {
      const result = { id: ID, number: 'INV-1', total: 10 };
      return Promise.resolve(json({ success: true, status: 200, result }));
    }
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
}

const CALL_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: { name: 'get_invoice', arguments: { id: ID } },
});

function post(headers: Record<string, string>, path = '/mcp', body = INIT_BODY): Request {
  return new Request(`http://127.0.0.1:3000${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body,
  });
}

function setup() {
  const fetch = fakeFetch();
  const handler = createHttpHandler(CONFIG, { fetch });
  return { fetch, handler };
}

const clients: Client[] = [];
const servers: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe('path', () => {
  it.each(['/', '/mcp/x', '/other'])('returns 404 for %s', async (path) => {
    const { handler, fetch } = setup();
    const res = await handler(post({ authorization: `Bearer ${BEARER}` }, path, CALL_BODY));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Not Found');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('bearer auth', () => {
  it.each([
    ['missing', {}],
    ['basic scheme', { authorization: `Basic ${BEARER}` }],
    ['empty token', { authorization: 'Bearer ' }],
    ['wrong token', { authorization: `Bearer ${WRONG}` }],
    ['lowercase scheme with wrong token', { authorization: `bearer ${WRONG}` }],
  ])('returns 401 with WWW-Authenticate for %s', async (_name, headers) => {
    const { handler, fetch } = setup();
    const res = await handler(post(headers, '/mcp', CALL_BODY));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('Unauthorized');
    expect(res.headers.get('www-authenticate')?.startsWith('Bearer')).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not leak the expected or presented token in a 401', async () => {
    const { handler } = setup();
    const res = await handler(post({ authorization: `Bearer ${WRONG}` }));
    const dump = `${await res.text()}${JSON.stringify([...res.headers])}`;
    expect(dump).not.toContain(BEARER);
    expect(dump).not.toContain(WRONG);
  });

  it('accepts a lowercase bearer scheme with the right token', async () => {
    const { handler } = setup();
    const res = await handler(post({ authorization: `bearer ${BEARER}` }));
    expect(res.status).toBe(200);
  });

  it.each([
    ['unanchored scheme', `Xyz Bearer ${BEARER}`, 401],
    ['two spaces after the scheme', `Bearer  ${BEARER}`, 200],
    ['trailing junk after the token', `Bearer ${BEARER} extra`, 401],
  ])('%s', async (_name, authorization, status) => {
    const { handler } = setup();
    const res = await handler(post({ authorization }));
    expect(res.status).toBe(status);
  });

  it('returns 401, not 403, for a foreign Origin without a token', async () => {
    const { handler } = setup();
    const res = await handler(post({ origin: 'https://evil.example' }));
    expect(res.status).toBe(401);
  });
});

describe('origin', () => {
  const auth = { authorization: `Bearer ${BEARER}` };

  it.each(['https://evil.example', 'null'])('returns 403 for Origin %s', async (origin) => {
    const { handler, fetch } = setup();
    const res = await handler(post({ ...auth, origin }, '/mcp', CALL_BODY));
    expect(res.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['absent', undefined],
    ['localhost with port', 'http://localhost:5173'],
    ['configured allowed origin', 'https://app.example'],
  ])('allows %s', async (_name, origin) => {
    const { handler } = setup();
    const res = await handler(post(origin === undefined ? auth : { ...auth, origin }));
    expect(res.status).toBe(200);
  });
});

describe('MCP over the handler', () => {
  async function connect(fetch: ReturnType<typeof fakeFetch>) {
    const handler = createHttpHandler(CONFIG, { fetch });
    const transport = new StreamableHTTPClientTransport(new URL(URL_MCP), {
      requestInit: { headers: { authorization: `Bearer ${BEARER}` } },
      fetch: (input, init) => handler(new Request(input, init)),
    });
    const client = new Client({ name: 'http-test', version: '0.0.0' });
    clients.push(client);
    await client.connect(transport);
    return client;
  }

  it('lists the 7 read tools', async () => {
    const client = await connect(fakeFetch());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_customer',
      'get_customer_pause',
      'get_invoice',
      'get_invoice_retry_attempts',
      'list_customer_pauses',
      'list_customers',
      'list_invoices',
    ]);
  });

  it('calls get_invoice and returns the invoice', async () => {
    const client = await connect(fakeFetch());
    const result = await client.callTool({ name: 'get_invoice', arguments: { id: ID } });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.content)).toContain('INV-1');
  });

  it('fetches the upstream token once for two tool calls', async () => {
    const fetch = fakeFetch();
    const client = await connect(fetch);
    await client.callTool({ name: 'get_invoice', arguments: { id: ID } });
    await client.callTool({ name: 'get_invoice', arguments: { id: ID } });
    const tokenCalls = fetch.mock.calls.filter(
      ([i]) => (i instanceof Request ? i.url : i.toString()) === AUTH_URL,
    );
    expect(tokenCalls).toHaveLength(1);
  });
});

describe('startHttpServer', () => {
  it('binds a real port and rejects a POST without a token with 401', async () => {
    const server = await startHttpServer(CONFIG, { fetch: fakeFetch() });
    servers.push(server);
    expect(server.port).toBeGreaterThan(0);
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: INIT_BODY,
    });
    expect(res.status).toBe(401);
  });

  it('close() stops accepting connections', async () => {
    const server = await startHttpServer(CONFIG, { fetch: fakeFetch() });
    await server.close();
    await expect(fetch(`http://127.0.0.1:${server.port}/mcp`)).rejects.toThrow(/fetch failed/);
  });
});

describe('startHttpServer lifecycle', () => {
  it('rejects when the port is already in use', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const address = blocker.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    const config = { ...CONFIG, http: { ...CONFIG.http, port: address.port } };
    try {
      await expect(startHttpServer(config, { fetch: fakeFetch() })).rejects.toThrow(/EADDRINUSE/);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  }, 3_000);

  it('close() ends an in-flight request whose Inio call never resolves', async () => {
    const pending = vi.fn<typeof globalThis.fetch>((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === AUTH_URL) {
        return Promise.resolve(json({ access_token: UPSTREAM_TOKEN, expires_in: 300 }));
      }
      return new Promise<Response>(() => {});
    });
    const server = await startHttpServer(CONFIG, { fetch: pending });
    const outcome = fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${BEARER}`,
      },
      body: CALL_BODY,
    }).then(
      (res) => res.text(),
      () => 'rejected',
    );
    await vi.waitFor(() => expect(pending).toHaveBeenCalled(), { timeout: 2_000 });
    const started = Date.now();
    await server.close();
    expect(Date.now() - started).toBeLessThan(1_000);
    await expect(outcome).resolves.toEqual(expect.any(String));
  }, 5_000);

  it('close() resolves promptly with an idle keep-alive connection open', async () => {
    const server = await startHttpServer(CONFIG, { fetch: fakeFetch() });
    const agent = new http.Agent({ keepAlive: true });
    await new Promise<void>((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port: server.port, path: '/other', agent }, (res) => {
          res.resume();
          res.on('end', resolve);
        })
        .on('error', reject);
    });
    const started = Date.now();
    await server.close();
    agent.destroy();
    expect(Date.now() - started).toBeLessThan(1_000);
  }, 5_000);
});

async function freePort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const address = srv.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  return address.port;
}

describe('http entry point (spawned process)', () => {
  it('logs a token-free startup line and enforces auth', async () => {
    const port = await freePort();
    const child = spawn(process.execPath, ['src/index.ts'], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH ?? '',
        INIO_CLIENT_ID: 'x',
        INIO_CLIENT_SECRET: SECRET,
        INIO_AUTH_URL: 'http://127.0.0.1:9/token',
        INIO_URL: 'http://127.0.0.1:9/v1',
        MCP_TRANSPORT: 'http',
        MCP_AUTH_TOKEN: BEARER,
        HOST: '127.0.0.1',
        PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString('utf8');
    });
    try {
      await vi.waitFor(() => expect(stderr).toContain('server started'), { timeout: 8_000 });
      const line = stderr.split('\n').find((l) => l.includes('server started')) ?? '';
      expect(line).toContain('"transport":"http"');
      expect(line).toContain('"host":"127.0.0.1"');
      expect(line).toContain(`"port":${port}`);
      expect(stderr).not.toContain(BEARER);
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: INIT_BODY,
      });
      expect(res.status).toBe(401);
    } finally {
      child.kill();
    }
  }, 20_000);
});
