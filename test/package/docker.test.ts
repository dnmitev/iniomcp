import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const execFileAsync = promisify(execFile);
const image = process.env.DOCKER_IMAGE ?? '';

const TOOLS = [
  'get_customer',
  'get_customer_pause',
  'get_invoice',
  'get_invoice_retry_attempts',
  'list_customer_pauses',
  'list_customers',
  'list_invoices',
];

const ExecError = z.object({
  code: z.number().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
});

const clients: Client[] = [];

afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()));
});

/** Runs docker and returns exit code, stdout and stderr (never throws on a non-zero exit). */
async function docker(args: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync('docker', args, { timeout: 60_000 });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = ExecError.parse(e);
    return { code: err.code ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

describe.skipIf(!process.env.DOCKER_IMAGE)('docker image', () => {
  it('serves the seven read tools over stdio', async () => {
    const client = new Client({ name: 'docker-test', version: '0.0.0' });
    clients.push(client);
    await client.connect(
      new StdioClientTransport({
        command: 'docker',
        args: [
          'run',
          '-i',
          '--rm',
          '-e',
          'INIO_CLIENT_ID',
          '-e',
          'INIO_CLIENT_SECRET',
          '-e',
          'INIO_AUTH_URL',
          '-e',
          'INIO_URL',
          image,
        ],
        env: {
          PATH: process.env.PATH ?? '',
          INIO_CLIENT_ID: 'x',
          INIO_CLIENT_SECRET: 'y',
          INIO_AUTH_URL: 'https://auth.example/realms/r',
          INIO_URL: 'https://api.example/v1',
        },
        stderr: 'pipe',
      }),
    );
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);
  }, 60_000);

  it('runs as uid 1000', async () => {
    const res = await docker(['run', '--rm', '--entrypoint', 'id', image, '-u']);
    expect(res.stdout.trim()).toBe('1000');
  }, 60_000);

  it('runs as the user node', async () => {
    const res = await docker(['run', '--rm', '--entrypoint', 'id', image, '-un']);
    expect(res.stdout.trim()).toBe('node');
  }, 60_000);

  it('exits 1 with the config error on stderr and nothing on stdout when env is empty', async () => {
    const res = await docker(['run', '--rm', image]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('Invalid Inio MCP configuration');
    expect(res.stdout).toBe('');
  }, 60_000);

  it('contains no source, tests or .env in /app', async () => {
    const res = await docker(['run', '--rm', '--entrypoint', 'sh', image, '-c', 'ls -A /app']);
    expect(res.code).toBe(0);
    const entries = res.stdout.split('\n').filter((l) => l.length > 0);
    for (const forbidden of ['src', 'test', '.env']) expect(entries).not.toContain(forbidden);
  }, 60_000);

  it('installs production dependencies only', async () => {
    const res = await docker([
      'run',
      '--rm',
      '--entrypoint',
      'sh',
      image,
      '-c',
      'ls -A /app/node_modules',
    ]);
    expect(res.code).toBe(0);
    const entries = res.stdout.split('\n').filter((l) => l.length > 0);
    expect(entries.length).toBeGreaterThan(0);
    for (const dev of ['vitest', 'typescript', '@stryker-mutator', 'testcontainers']) {
      expect(entries).not.toContain(dev);
    }
  }, 60_000);

  it('is smaller than 200 MB', async () => {
    const res = await docker(['image', 'inspect', image, '--format', '{{.Size}}']);
    expect(res.code).toBe(0);
    expect(Number(res.stdout.trim())).toBeLessThan(200_000_000);
  }, 60_000);
});

const HTTP_TOKEN = 'a3f1c2d4e5b60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const INIT_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'docker-test', version: '0' },
  },
});

async function freePort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const address = srv.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  return address.port;
}

describe.skipIf(!process.env.DOCKER_IMAGE)('docker image over HTTP', () => {
  let hostPort = 0;
  let container = '';

  beforeAll(async () => {
    hostPort = await freePort();
    const res = await docker([
      'run',
      '-d',
      '-e',
      'MCP_TRANSPORT=http',
      '-e',
      `MCP_AUTH_TOKEN=${HTTP_TOKEN}`,
      '-e',
      'INIO_CLIENT_ID=x',
      '-e',
      'INIO_CLIENT_SECRET=y',
      '-e',
      'INIO_AUTH_URL=https://auth.example/realms/r',
      '-e',
      'INIO_URL=https://api.example/v1',
      '-p',
      `${hostPort}:3000`,
      image,
    ]);
    if (res.code !== 0) throw new Error(`docker run failed: ${res.stderr}`);
    container = res.stdout.trim();
  }, 60_000);

  afterAll(async () => {
    if (container) await docker(['rm', '-f', container]);
  }, 60_000);

  async function logs(): Promise<string> {
    const res = await docker(['logs', container]);
    return `${res.stdout}${res.stderr}`;
  }

  it('logs server started on 0.0.0.0:3000 without the token', async () => {
    await expect.poll(logs, { timeout: 15_000, interval: 250 }).toContain('server started');
    const text = await logs();
    const line = text.split('\n').find((l) => l.includes('server started')) ?? '';
    expect(line).toContain('"host":"0.0.0.0"');
    expect(line).toContain('"port":3000');
    expect(text).not.toContain(HTTP_TOKEN);
  }, 30_000);

  it('rejects a POST without a token with 401', async () => {
    const res = await fetch(`http://127.0.0.1:${hostPort}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: INIT_BODY,
    });
    expect(res.status).toBe(401);
  }, 30_000);

  it('lists the seven read tools for a client with the bearer token', async () => {
    const client = new Client({ name: 'docker-http-test', version: '0.0.0' });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${hostPort}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${HTTP_TOKEN}` } },
      }),
    );
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);
  }, 30_000);

  it('stops on docker stop in under 5 s with exit code 0 and logs server stopped', async () => {
    const started = Date.now();
    const stop = await docker(['stop', container]);
    expect(stop.code).toBe(0);
    expect(Date.now() - started).toBeLessThan(5_000);
    const inspect = await docker(['inspect', container, '--format', '{{.State.ExitCode}}']);
    expect(inspect.stdout.trim()).toBe('0');
    expect(await logs()).toContain('"msg":"server stopped"');
  }, 30_000);
});
