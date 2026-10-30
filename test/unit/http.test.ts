import { spawn } from 'node:child_process';
import { connect as netConnect, createServer } from 'node:net';
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

describe('startHttpServer drain', () => {
  it('close() lets an in-flight request finish when upstream answers within the grace period', async () => {
    const base = fakeFetch();
    const slow = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith(API_URL)) await new Promise((r) => setTimeout(r, 200));
      return base(input, init);
    });
    const server = await startHttpServer(CONFIG, { fetch: slow });
    const pending = fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${BEARER}`,
      },
      body: CALL_BODY,
    });
    await vi.waitFor(() =>
      expect(slow).toHaveBeenCalledWith(`${API_URL}/invoices/${ID}`, expect.anything()),
    );
    const closing = server.close();
    const res = await pending;
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('INV-1');
    await closing;
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

  type Signals = readonly NodeJS.Signals[];

  async function stopWith(signals: Signals) {
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
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      child.once('exit', (code, sig) => resolve({ code, signal: sig })),
    );
    let timer: NodeJS.Timeout | undefined;
    try {
      await vi.waitFor(() => expect(stderr).toContain('server started'), { timeout: 8_000 });
      for (const s of signals) child.kill(s);
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(resolve, 2_000, 'timeout');
      });
      const result = await Promise.race([exited, timeout]);
      return { result, port, stderr: () => stderr };
    } finally {
      clearTimeout(timer);
      child.kill('SIGKILL');
    }
  }

  const stoppedLines = (stderr: string) =>
    stderr.split('\n').filter((l) => l.includes('"msg":"server stopped"'));

  it.each(['SIGTERM', 'SIGINT'] as const)(
    'shuts down gracefully on %s: logs server stopped and exits 0 within 2 s',
    async (signal) => {
      const { result, port, stderr } = await stopWith([signal]);
      expect(result).toEqual({ code: 0, signal: null });
      expect(stoppedLines(stderr())).toHaveLength(1);
      await expect(fetch(`http://127.0.0.1:${port}/mcp`)).rejects.toThrow(/fetch failed/);
    },
    20_000,
  );

  it('survives SIGTERM sent twice: one server stopped, exit 0, no error output', async () => {
    const { result, stderr } = await stopWith(['SIGTERM', 'SIGTERM']);
    expect(result).toEqual({ code: 0, signal: null });
    expect(stoppedLines(stderr())).toHaveLength(1);
    expect(stderr()).not.toContain('Error');
    expect(stderr()).not.toContain('    at ');
  }, 20_000);

  it('survives SIGINT immediately followed by SIGTERM: one server stopped, exit 0, no error output', async () => {
    const { result, stderr } = await stopWith(['SIGINT', 'SIGTERM']);
    expect(result).toEqual({ code: 0, signal: null });
    expect(stoppedLines(stderr())).toHaveLength(1);
    expect(stderr()).not.toContain('Error');
    expect(stderr()).not.toContain('    at ');
  }, 20_000);
});

const MIB = 1024 * 1024;

/** Sends headers plus a first chunk of a declared 1 MiB upload and never finishes it. */
function openUpload(port: number, path: string, headers: Record<string, string>) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; closed: boolean }>(
    (resolve) => {
      const req = http.request({
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        agent: false,
        headers: { 'content-type': 'application/json', 'content-length': String(MIB), ...headers },
      });
      const bail = setTimeout(() => {
        req.destroy();
        resolve({ status: 0, headers: {}, closed: false });
      }, 1_500);
      req.on('error', () => {});
      req.on('response', (res) => {
        res.resume();
        const socket = res.socket;
        const settle = (closed: boolean) => {
          clearTimeout(bail);
          req.destroy();
          resolve({ status: res.statusCode ?? 0, headers: res.headers, closed });
        };
        if (socket.destroyed) settle(true);
        else {
          socket.once('close', () => settle(true));
          setTimeout(() => settle(false), 1_000).unref();
        }
      });
      req.write(Buffer.alloc(16 * 1024, 0x61));
    },
  );
}

describe('rejection before the body is read', () => {
  it.each([
    ['no Authorization header', {}],
    ['malformed Authorization header', { authorization: `Token ${BEARER}` }],
    ['wrong token', { authorization: `Bearer ${WRONG}` }],
  ])('answers 401 with WWW-Authenticate and closes while the upload is open: %s', async (_n, h) => {
    const fetch = fakeFetch();
    const server = await startHttpServer(CONFIG, { fetch });
    servers.push(server);
    const out = await openUpload(server.port, '/mcp', h);
    expect(out.status).toBe(401);
    expect(out.headers['www-authenticate']).toBe('Bearer');
    expect(out.headers['content-type']).toBe('text/plain');
    expect(out.headers.connection).toBe('close');
    expect(out.closed).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('answers 404 for a valid token on another path while the upload is open', async () => {
    const server = await startHttpServer(CONFIG, { fetch: fakeFetch() });
    servers.push(server);
    const out = await openUpload(server.port, '/other', { authorization: `Bearer ${BEARER}` });
    expect(out.status).toBe(404);
    expect(out.closed).toBe(true);
  });

  it('answers 404 for a GET without a body on another path', async () => {
    const server = await startHttpServer(CONFIG, { fetch: fakeFetch() });
    servers.push(server);
    const res = await fetch(`http://127.0.0.1:${server.port}/other`, {
      headers: { authorization: `Bearer ${BEARER}` },
    });
    expect(res.status).toBe(404);
  });
});

describe('malformed request target', () => {
  function raw(port: number, line: string) {
    return new Promise<string>((resolve) => {
      const sock = netConnect(port, '127.0.0.1', () =>
        sock.write(`${line}\r\nHost: x\r\nConnection: close\r\n\r\n`),
      );
      let data = '';
      sock.on('data', (c: Buffer) => (data += c.toString('latin1')));
      sock.on('error', () => resolve(data));
      sock.on('close', () => resolve(data));
    });
  }

  it.each(['GET http://[/mcp HTTP/1.1', 'GET http://h:99999/mcp HTTP/1.1'])(
    'answers 404 and keeps serving after %s',
    async (line) => {
      const server = await startHttpServer(CONFIG, { fetch: fakeFetch() });
      servers.push(server);
      expect(await raw(server.port, line)).toMatch(/^HTTP\/1\.1 404 /);
      const res = await fetch(`http://127.0.0.1:${server.port}/mcp`);
      expect(res.status).toBe(401);
    },
  );
});

describe('request body cap', () => {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${BEARER}`,
  };

  it('answers 413 for a 300 KiB authenticated body without calling the MCP handler', async () => {
    const upstream = fakeFetch();
    const server = await startHttpServer(CONFIG, { fetch: upstream });
    servers.push(server);
    const body = INIT_BODY.replace('"name":"t"', `"name":"${'a'.repeat(300 * 1024)}"`);
    expect(body.length).toBeGreaterThan(300 * 1024);
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers,
      body,
    });
    expect(res.status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('still completes initialize and tools/call over a real socket', async () => {
    const server = await startHttpServer(CONFIG, { fetch: fakeFetch() });
    servers.push(server);
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${server.port}/mcp`),
      { requestInit: { headers: { authorization: `Bearer ${BEARER}` } } },
    );
    const client = new Client({ name: 'http-test', version: '0.0.0' });
    clients.push(client);
    await client.connect(transport);
    const result = await client.callTool({ name: 'get_invoice', arguments: { id: ID } });
    expect(JSON.stringify(result.content)).toContain('INV-1');
  });
});

describe('startup warning and drain (spawned process)', () => {
  function spawnEntry(env: Record<string, string>) {
    const child = spawn(process.execPath, ['src/index.ts'], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH ?? '',
        INIO_CLIENT_ID: 'x',
        INIO_CLIENT_SECRET: SECRET,
        INIO_AUTH_URL: 'http://127.0.0.1:9/token',
        INIO_URL: 'http://127.0.0.1:9/v1',
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString('utf8');
    });
    return { child, stderr: () => stderr };
  }
  const warnLines = (s: string) => s.split('\n').filter((l) => l.includes('"level":40'));

  it.each([
    ['0.0.0.0', 1],
    ['127.0.0.1', 0],
    ['localhost', 0],
  ])(
    'HOST=%s logs %i warn line(s) naming the host',
    async (host, count) => {
      const port = await freePort();
      const { child, stderr } = spawnEntry({
        MCP_TRANSPORT: 'http',
        MCP_AUTH_TOKEN: BEARER,
        HOST: host,
        PORT: String(port),
      });
      try {
        await vi.waitFor(() => expect(stderr()).toContain('server started'), { timeout: 8_000 });
        const warns = warnLines(stderr());
        expect(warns).toHaveLength(count);
        const first = warns[0] ?? '';
        expect(first.includes(`"host":"${host}"`)).toBe(count === 1);
        expect(first.includes('the bearer token is the only barrier')).toBe(count === 1);
        expect(stderr()).not.toContain(BEARER);
      } finally {
        child.kill('SIGKILL');
      }
    },
    20_000,
  );

  it('logs no warn line in stdio mode', async () => {
    const { child, stderr } = spawnEntry({ HOST: '0.0.0.0' });
    try {
      await vi.waitFor(() => expect(stderr()).toContain('server started'), { timeout: 8_000 });
      expect(warnLines(stderr())).toHaveLength(0);
    } finally {
      child.kill('SIGKILL');
    }
  }, 20_000);

  it('SIGTERM with an in-flight authenticated request exits 0 within 2 s and ends the request', async () => {
    // Upstream auth endpoint that never answers keeps the tools/call pending.
    const hang = http.createServer(() => {});
    await new Promise<void>((r) => hang.listen(0, '127.0.0.1', r));
    const hangAddr = hang.address();
    if (hangAddr === null || typeof hangAddr === 'string') throw new Error('no port');
    const hangPort = hangAddr.port;
    const port = await freePort();
    const { child, stderr } = spawnEntry({
      MCP_TRANSPORT: 'http',
      MCP_AUTH_TOKEN: BEARER,
      HOST: '127.0.0.1',
      PORT: String(port),
      INIO_AUTH_URL: `http://127.0.0.1:${hangPort}/token`,
    });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      child.once('exit', (code, sig) => resolve({ code, signal: sig })),
    );
    try {
      await vi.waitFor(() => expect(stderr()).toContain('server started'), { timeout: 8_000 });
      const outcome = fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${BEARER}`,
        },
        body: CALL_BODY,
      }).then(
        (res) =>
          res.text().then(
            () => 'finished',
            () => 'closed',
          ),
        () => 'closed',
      );
      await new Promise((r) => setTimeout(r, 500));
      child.kill('SIGTERM');
      const started = Date.now();
      const result = await Promise.race([
        exited,
        new Promise<'timeout'>((r) => setTimeout(r, 2_000, 'timeout')),
      ]);
      expect(result).toEqual({ code: 0, signal: null });
      expect(Date.now() - started).toBeLessThan(2_000);
      await expect(outcome).resolves.toMatch(/^(finished|closed)$/);
      expect(
        stderr()
          .split('\n')
          .filter((l) => l.includes('"msg":"server stopped"')),
      ).toHaveLength(1);
    } finally {
      child.kill('SIGKILL');
      hang.closeAllConnections();
      hang.close();
    }
  }, 20_000);
});

describe('startHttpServer shutdown timing', () => {
  const keepAliveGet = (agent: http.Agent, port: number, path: string) =>
    new Promise<void>((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path, agent }, (res) => {
          res.resume();
          res.on('end', resolve);
        })
        .on('error', reject);
    });

  it('removes the startup error listener once listening', async () => {
    const once = vi.spyOn(http.Server.prototype, 'once');
    const off = vi.spyOn(http.Server.prototype, 'off');
    const server = await startHttpServer(CONFIG, { fetch: fakeFetch() });
    const registered = (once.mock.calls as unknown[][]).find((c) => c[0] === 'error')?.[1];
    expect(registered).toEqual(expect.any(Function));
    expect(off).toHaveBeenCalledWith('error', registered);
    await server.close();
    once.mockRestore();
    off.mockRestore();
  });

  it('close() does not leave the grace-period cut to fire after a clean close', async () => {
    const cut = vi.spyOn(http.Server.prototype, 'closeAllConnections');
    const server = await startHttpServer(CONFIG, { fetch: fakeFetch() });
    await server.close();
    await new Promise((r) => setTimeout(r, 800));
    expect(cut).not.toHaveBeenCalled();
    cut.mockRestore();
  }, 5_000);

  it('close() drops an idle keep-alive connection well before the grace period', async () => {
    const server = await startHttpServer(CONFIG, { fetch: fakeFetch() });
    const agent = new http.Agent({ keepAlive: true });
    await keepAliveGet(agent, server.port, '/other');
    const started = Date.now();
    await server.close();
    agent.destroy();
    expect(Date.now() - started).toBeLessThan(250);
  }, 5_000);
});
