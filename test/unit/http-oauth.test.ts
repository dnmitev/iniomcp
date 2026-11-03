import http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createHttpHandler, startHttpServer } from '../../src/http.ts';
import type { HttpConfig } from '../../src/http.ts';
import { WRITE_TOOL_NAMES } from '../../src/config.ts';
import {
  AUDIENCE,
  createFakeIdp,
  ISSUER,
  JWKS_URL,
  makeKey,
  unsignedToken,
  urlOf,
} from './helpers/fake-idp.ts';

const BEARER = 'mcp-bearer-0123456789-abcdefghijklmnopqrstuvwxyz';
const WRONG = 'wrong-bearer-0123456789-abcdefghijklmnopqrstuvwx';
const ID = '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b';
const AUTH_URL = 'https://kc.example/realms/api/protocol/openid-connect/token';
const API_URL = 'https://api.example/v1';
const PRM_URL = 'https://mcp.example/.well-known/oauth-protected-resource/mcp';
const CHALLENGE = `Bearer resource_metadata="${PRM_URL}"`;
const CHALLENGE_INVALID = `${CHALLENGE}, error="invalid_token"`;
const PRM_PATHS = [
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
];

const BASE: HttpConfig = {
  clientId: 'mcp-client',
  clientSecret: 's3cr3t',
  authUrl: AUTH_URL,
  apiUrl: API_URL,
  allowWrites: false,
  revealPii: false,
  transport: 'http',
  logLevel: 'info',
  requestTimeoutMs: 30000,
  writeTools: new Set(WRITE_TOOL_NAMES),
  http: { port: 0, host: '127.0.0.1', authToken: BEARER, allowedOrigins: [] },
};
const OAUTH = { issuer: ISSUER, resourceUrl: AUDIENCE, audience: AUDIENCE };
const withOauth = (): HttpConfig => ({ ...BASE, http: { ...BASE.http, oauth: OAUTH } });

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

function inioFetch() {
  return vi.fn<typeof globalThis.fetch>((input) => {
    const url = urlOf(input);
    const ok = (b: unknown) => Promise.resolve(Response.json(b));
    if (url === AUTH_URL) return ok({ access_token: 'up-tok', expires_in: 300 });
    if (url === `${API_URL}/invoices/${ID}`) {
      return ok({ success: true, status: 200, result: { id: ID, number: 'INV-1', total: 10 } });
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

const post = (authorization?: string, path = '/mcp') =>
  new Request(`http://127.0.0.1:3000${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(authorization === undefined ? {} : { authorization }),
    },
    body: INIT_BODY,
  });

async function setup(config = withOauth()) {
  const upstream = inioFetch();
  const idp = await createFakeIdp(upstream);
  const logger = fakeLogger();
  const handler = createHttpHandler(config, { fetch: idp.fetch, logger });
  return { idp, upstream, logger, handler };
}

const servers: Array<{ close(): Promise<void> }> = [];
const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe('Protected Resource Metadata (OAuth on)', () => {
  const req = (method: string, path: string, headers: Record<string, string> = {}) =>
    new Request(`http://127.0.0.1:3000${path}`, { method, headers });

  it.each(PRM_PATHS)('serves the document on GET %s without a token', async (path) => {
    const { handler } = await setup();
    const res = await handler(req('GET', path));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toEqual({
      resource: AUDIENCE,
      authorization_servers: [ISSUER],
      bearer_methods_supported: ['header'],
      resource_name: 'Inio MCP',
    });
  });

  it.each(PRM_PATHS)('answers HEAD %s with 200, the headers and no body', async (path) => {
    const { handler } = await setup();
    const res = await handler(req('HEAD', path));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.text()).toBe('');
  });

  it('makes no network call', async () => {
    const { handler, idp, upstream } = await setup();
    await handler(req('GET', PRM_PATHS[0] ?? ''));
    await handler(req('GET', PRM_PATHS[1] ?? ''));
    expect(idp.fetch).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });

  it('ignores a foreign Origin and a bad token', async () => {
    const { handler } = await setup();
    const res = await handler(
      req('GET', PRM_PATHS[1] ?? '', {
        origin: 'https://evil.example',
        authorization: `Bearer ${WRONG}`,
      }),
    );
    expect(res.status).toBe(200);
  });

  it.each(['POST', 'PUT', 'DELETE'])('answers 404 for %s', async (method) => {
    const { handler } = await setup();
    for (const path of PRM_PATHS) {
      const res = await handler(req(method, path));
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('Not Found');
    }
  });

  it.each([
    '/.well-known/oauth-authorization-server',
    '/.well-known/openid-configuration',
    '/.well-known/oauth-protected-resource/other',
    '/.well-known/oauth-protected-resource/',
    '/.well-known/oauth-protected-resource/mcp/',
  ])('answers 404 for %s', async (path) => {
    const { handler } = await setup();
    expect((await handler(req('GET', path))).status).toBe(404);
  });
});

describe('without OAuth', () => {
  it.each(PRM_PATHS)('answers 404 for GET %s', async (path) => {
    const handler = createHttpHandler(BASE, { fetch: inioFetch() });
    const res = await handler(new Request(`http://127.0.0.1:3000${path}`));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Not Found');
  });

  it('keeps the plain Bearer challenge', async () => {
    const handler = createHttpHandler(BASE, { fetch: inioFetch() });
    const res = await handler(post());
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('does not treat a JWT as valid', async () => {
    const idp = await createFakeIdp(inioFetch());
    const handler = createHttpHandler(BASE, { fetch: idp.fetch });
    const res = await handler(post(`Bearer ${await idp.sign()}`));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
    expect(idp.fetch).not.toHaveBeenCalled();
  });
});

describe('challenge (OAuth on)', () => {
  it.each([
    ['no header', undefined],
    ['basic scheme', `Basic ${BEARER}`],
  ])('answers 401 with resource_metadata and no error for %s', async (_n, auth) => {
    const { handler } = await setup();
    const res = await handler(post(auth));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('Unauthorized');
    expect(res.headers.get('www-authenticate')).toBe(CHALLENGE);
  });

  it.each([
    ['wrong static-length token', `Bearer ${WRONG}`],
    ['garbage', 'Bearer garbage'],
    ['lowercase scheme', `bearer ${WRONG}`],
  ])('adds error="invalid_token" when a token was sent: %s', async (_n, auth) => {
    const { handler } = await setup();
    const res = await handler(post(auth));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(CHALLENGE_INVALID);
  });

  it('derives the metadata URL from the public URL', async () => {
    const config = withOauth();
    const custom: HttpConfig = {
      ...config,
      http: {
        ...config.http,
        oauth: { ...OAUTH, resourceUrl: 'https://mcp.example/v1/mcp' },
      },
    };
    const { idp } = await setup();
    const handler = createHttpHandler(custom, { fetch: idp.fetch });
    const res = await handler(post());
    expect(res.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource/v1/mcp"',
    );
  });

  it('works with the authToken property missing entirely', async () => {
    const config = withOauth();
    const { authToken: _drop, ...rest } = config.http;
    const { idp } = await setup();
    const handler = createHttpHandler({ ...config, http: rest }, { fetch: idp.fetch });
    expect((await handler(post(`Bearer ${WRONG}`))).status).toBe(401);
    expect((await handler(post(`Bearer ${await idp.sign()}`))).status).toBe(200);
  });
});

describe('access tokens (OAuth on)', () => {
  it('serves a valid JWT like the static token', async () => {
    const { handler, idp } = await setup();
    const res = await handler(post(`Bearer ${await idp.sign({ claims: { sub: 'u-1' } })}`));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('"protocolVersion"');
  });

  it('serves the static token first, without touching the provider', async () => {
    const { handler, idp } = await setup();
    const res = await handler(post(`Bearer ${BEARER}`));
    expect(res.status).toBe(200);
    expect(idp.fetch).not.toHaveBeenCalled();
  });

  it('still serves the static token while the provider is down', async () => {
    const { handler, idp } = await setup();
    idp.state.down = true;
    expect((await handler(post(`Bearer ${BEARER}`))).status).toBe(200);
  });

  describe.each([
    [
      'another issuer',
      (i: Awaited<ReturnType<typeof createFakeIdp>>) =>
        i.sign({ iss: 'https://evil.example/realms/mcp' }),
    ],
    ['no audience', (i: Awaited<ReturnType<typeof createFakeIdp>>) => i.sign({ aud: null })],
    [
      'another audience',
      (i: Awaited<ReturnType<typeof createFakeIdp>>) =>
        i.sign({ aud: 'https://other.example/mcp' }),
    ],
    [
      'expired',
      (i: Awaited<ReturnType<typeof createFakeIdp>>) =>
        i.sign({ exp: Math.floor(Date.now() / 1000) - 300 }),
    ],
    [
      'not yet valid',
      (i: Awaited<ReturnType<typeof createFakeIdp>>) =>
        i.sign({ nbf: Math.floor(Date.now() / 1000) + 300 }),
    ],
    [
      'bad signature',
      async (i: Awaited<ReturnType<typeof createFakeIdp>>) =>
        i.sign({ key: (await makeKey('k1')).privateKey }),
    ],
    ['alg none', () => Promise.resolve(unsignedToken())],
    [
      'HS256',
      (i: Awaited<ReturnType<typeof createFakeIdp>>) =>
        i.sign({ alg: 'HS256', key: new TextEncoder().encode('0123456789abcdef0123456789abcdef') }),
    ],
    ['garbage', () => Promise.resolve('not.a.jwt')],
  ])('rejects a token with %s', (_name, make) => {
    it('with 401 and the invalid_token challenge', async () => {
      const { handler, idp } = await setup();
      const res = await handler(post(`Bearer ${await make(idp)}`));
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe(CHALLENGE_INVALID);
    });
  });

  it('answers 401 for a valid JWT while the provider is down', async () => {
    const { handler, idp } = await setup();
    const token = await idp.sign();
    idp.state.down = true;
    const res = await handler(post(`Bearer ${token}`));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(CHALLENGE_INVALID);
  });

  it('fetches discovery once across requests', async () => {
    const { handler, idp } = await setup();
    await handler(post(`Bearer ${await idp.sign()}`));
    await handler(post(`Bearer ${await idp.sign()}`));
    expect(
      idp.idpCalls('https://idp.example/realms/mcp/.well-known/openid-configuration'),
    ).toHaveLength(1);
  });
});

describe('non-URL audience (OAuth on)', () => {
  it('serves a valid JWT whose aud is a plain client id', async () => {
    const { handler, idp } = await setup({
      ...BASE,
      http: { ...BASE.http, oauth: { ...OAUTH, audience: 'inio-mcp' } },
    });
    const res = await handler(post(`Bearer ${await idp.sign({ aud: 'inio-mcp' })}`));
    expect(res.status).toBe(200);
  });
});

describe('startHttpServer (OAuth on)', () => {
  async function start(now: () => number = () => 0, config = withOauth()) {
    const upstream = inioFetch();
    const idp = await createFakeIdp(upstream);
    const logger = fakeLogger();
    const server = await startHttpServer(config, { fetch: idp.fetch, logger, now });
    servers.push(server);
    const url = (p = '/mcp') => `http://127.0.0.1:${server.port}${p}`;
    return { idp, logger, url, server };
  }
  const unauthorized = (l: ReturnType<typeof fakeLogger>) =>
    l.warn.mock.calls.filter(([, m]) => m === 'unauthorized request');
  const providerWarns = (l: ReturnType<typeof fakeLogger>) =>
    l.warn.mock.calls.filter(([, m]) => m !== 'unauthorized request');

  it.each(PRM_PATHS)('serves PRM on GET %s and does not log it', async (path) => {
    const { logger, url, idp } = await start();
    const res = await fetch(url(path));
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toMatchObject({ resource: AUDIENCE, authorization_servers: [ISSUER] });
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
    expect(idp.fetch).not.toHaveBeenCalled();
  });

  it('answers HEAD on PRM with no body', async () => {
    const { url } = await start();
    const res = await fetch(url(PRM_PATHS[0]), { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('answers PRM before any body is read', async () => {
    const { server } = await start();
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const r = http.request(
        {
          port: server.port,
          host: '127.0.0.1',
          method: 'GET',
          path: PRM_PATHS[1],
          headers: { 'content-length': '1000000' },
        },
        resolve,
      );
      r.on('error', reject);
      r.write('x');
    });
    expect(res.statusCode).toBe(200);
    res.destroy();
  });

  it('answers 401 with the challenge and Connection: close before the body is read', async () => {
    const { server } = await start();
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const r = http.request(
        {
          port: server.port,
          host: '127.0.0.1',
          method: 'POST',
          path: '/mcp',
          headers: { 'content-length': '1000000', authorization: `Bearer ${WRONG}` },
        },
        resolve,
      );
      r.on('error', reject);
      r.write('x');
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['connection']).toBe('close');
    expect(res.headers['www-authenticate']).toBe(CHALLENGE_INVALID);
    res.destroy();
  });

  it('challenges a request without a token', async () => {
    const { url } = await start();
    const res = await fetch(url(), { method: 'POST' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(CHALLENGE);
  });

  it('counts a rejected access token in the existing 401 throttle', async () => {
    const { url, logger, idp } = await start(() => 0);
    const bad = await idp.sign({ aud: null });
    await fetch(url(), { headers: { authorization: `Bearer ${bad}` } });
    await fetch(url(), { headers: { authorization: `Bearer ${bad}` } });
    expect(unauthorized(logger)).toEqual([
      [{ remoteAddress: '127.0.0.1', path: '/mcp' }, 'unauthorized request'],
    ]);
  });

  it('logs the signed-in user for a tool call made over the socket', async () => {
    const { url, idp, logger } = await start();
    const token = await idp.sign({ claims: { sub: 'user-1', preferred_username: 'alice' } });
    const transport = new StreamableHTTPClientTransport(new URL(url()), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: 'c', version: '1' });
    clients.push(client);
    await client.connect(transport);
    await client.callTool({ name: 'get_invoice', arguments: { id: ID } });
    const lines = logger.info.mock.calls.filter(([, m]) => m === 'tool call').map(([o]) => o);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ user: { sub: 'user-1', name: 'alice' } });
  });

  it('answers 500 and closes the connection when the 401 warn itself throws', async () => {
    const { url, logger } = await start();
    logger.warn.mockImplementation(() => {
      throw new Error('log sink down');
    });
    const res = await fetch(url(), { method: 'POST' });
    expect(res.status).toBe(500);
    expect(res.headers.get('connection')).toBe('close');
  });

  it('serves a valid JWT over the socket', async () => {
    const { url, idp } = await start();
    const res = await fetch(url(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${await idp.sign()}`,
      },
      body: INIT_BODY,
    });
    expect(res.status).toBe(200);
  });

  it('logs one throttled warn when the provider is unreachable, and keeps serving the static token', async () => {
    let clock = 0;
    const { url, logger, idp } = await start(() => clock);
    const token = await idp.sign();
    idp.state.down = true;
    for (let i = 0; i < 3; i++) {
      const res = await fetch(url(), { headers: { authorization: `Bearer ${token}` } });
      expect(res.status).toBe(401);
    }
    expect(providerWarns(logger)).toHaveLength(1);
    clock = 61_000;
    await fetch(url(), { headers: { authorization: `Bearer ${token}` } });
    expect(providerWarns(logger)).toHaveLength(2);
    const ok = await fetch(url(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${BEARER}`,
      },
      body: INIT_BODY,
    });
    expect(ok.status).toBe(200);
  });

  it('answers 401 and warns once per window when the JWKS endpoint returns 503', async () => {
    let clock = 0;
    const { url, logger, idp } = await start(() => clock);
    idp.state.jwksStatus = 503;
    const token = await idp.sign();
    for (let i = 0; i < 3; i++) {
      const res = await fetch(url(), { headers: { authorization: `Bearer ${token}` } });
      expect(res.status).toBe(401);
    }
    expect(providerWarns(logger).map(([, m]) => m)).toEqual(['token verification unavailable']);
    clock = 61_000;
    await fetch(url(), { headers: { authorization: `Bearer ${token}` } });
    expect(providerWarns(logger)).toHaveLength(2);
  });

  it('warns about provider misconfiguration when jwks_uri is plain http on an https issuer', async () => {
    const { url, logger, idp } = await start(() => 0);
    idp.state.jwksUri = 'http://idp.example/realms/mcp/certs';
    const res = await fetch(url(), { headers: { authorization: `Bearer ${await idp.sign()}` } });
    expect(res.status).toBe(401);
    expect(idp.idpCalls(idp.state.jwksUri)).toHaveLength(0);
    expect(providerWarns(logger).map(([, m]) => m)).toEqual(['token verification unavailable']);
  });

  it('logs the provider failure as exactly the error message, never the token', async () => {
    const { url, logger, idp } = await start(() => 0);
    const token = await idp.sign();
    idp.state.down = true;
    await fetch(url(), { headers: { authorization: `Bearer ${token}` } });
    expect(providerWarns(logger)).toEqual([
      [{ err: 'connect ECONNREFUSED' }, 'token verification unavailable'],
    ]);
  });

  it('counts a JWKS timeout as a provider outage', async () => {
    const { url, logger, idp } = await start(() => 0);
    const token = await idp.sign();
    const inner = idp.fetch.getMockImplementation();
    idp.fetch.mockImplementation((input, init) =>
      urlOf(input) === JWKS_URL || !inner
        ? Promise.reject(new DOMException('timed out', 'TimeoutError'))
        : inner(input, init),
    );
    const res = await fetch(url(), { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
    expect(providerWarns(logger)).toHaveLength(1);
    expect(providerWarns(logger)[0]?.[1]).toBe('token verification unavailable');
  });

  it('does not log a provider warn for a merely invalid token', async () => {
    const { url, logger, idp } = await start(() => 0);
    await fetch(url(), { headers: { authorization: `Bearer ${await idp.sign({ aud: null })}` } });
    await fetch(url(), { headers: { authorization: 'Bearer garbage' } });
    expect(providerWarns(logger)).toEqual([]);
  });

  it('answers 401 invalid_token for an ID-token-shaped JWT without a provider warn', async () => {
    const { url, logger, idp } = await start(() => 0);
    const token = await idp.sign({ claims: { typ: 'ID' } });
    const res = await fetch(url(), { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(CHALLENGE_INVALID);
    expect(providerWarns(logger)).toEqual([]);
  });

  it('PR47-typ:http-reject-id-token-no-typ: answers 401 for an ID token with no typ claim', async () => {
    const { url, logger, idp } = await start(() => 0);
    const token = await idp.sign({
      claims: { sub: 'user-1', email: 'user@example.com' },
    });
    const res = await fetch(url(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
      },
      body: INIT_BODY,
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(CHALLENGE_INVALID);
    expect(providerWarns(logger)).toEqual([]);
  });

  it('PR47-typ:http-reject-id-token-jwt-header: answers 401 for an ID token with header typ JWT', async () => {
    const { url, logger, idp } = await start(() => 0);
    const token = await idp.sign({
      typ: 'JWT',
      claims: { sub: 'user-1', email: 'user@example.com' },
    });
    const res = await fetch(url(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
      },
      body: INIT_BODY,
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(CHALLENGE_INVALID);
    expect(providerWarns(logger)).toEqual([]);
  });

  it('PR47-typ:http-accept-at-jwt: accepts an access token with header typ at+jwt', async () => {
    const { url, idp } = await start();
    const token = await idp.sign({
      typ: 'at+jwt',
      claims: { sub: 'user-1', scope: 'openid profile' },
    });
    const res = await fetch(url(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
      },
      body: INIT_BODY,
    });
    expect(res.status).toBe(200);
  });

  it('PR47-typ:http-accept-bearer-payload: accepts an access token with payload typ Bearer', async () => {
    const { url, idp } = await start();
    const token = await idp.sign({
      claims: { sub: 'user-1', typ: 'Bearer', scope: 'openid profile' },
    });
    const res = await fetch(url(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
      },
      body: INIT_BODY,
    });
    expect(res.status).toBe(200);
  });

  it('never logs a presented token', async () => {
    const { url, logger, idp } = await start(() => 0);
    const token = await idp.sign({ aud: null });
    idp.state.down = true;
    await fetch(url(), { headers: { authorization: `Bearer ${token}` } });
    const all = JSON.stringify([
      logger.debug.mock.calls,
      logger.info.mock.calls,
      logger.warn.mock.calls,
    ]);
    expect(all).not.toContain(token);
    expect(all).not.toContain(token.split('.')[1]);
  });
});

describe('signed-in user in tool-call logs over HTTP', () => {
  async function callTool(token: string, claims = true) {
    const upstream = inioFetch();
    const idp = await createFakeIdp(upstream);
    const logger = fakeLogger();
    const handler = createHttpHandler(withOauth(), { fetch: idp.fetch, logger });
    const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:3000/mcp'), {
      requestInit: {
        headers: {
          authorization: `Bearer ${claims ? await idp.sign({ claims: { sub: 'user-1', preferred_username: 'alice', email: 'alice@corp.example' } }) : token}`,
        },
      },
      fetch: (input, init) => handler(new Request(input, init)),
    });
    const client = new Client({ name: 'c', version: '1' });
    clients.push(client);
    await client.connect(transport);
    await client.callTool({ name: 'get_invoice', arguments: { id: ID } });
    return logger.info.mock.calls.filter(([, m]) => m === 'tool call').map(([o]) => o);
  }

  it('adds user sub and name for an access token, and nothing else about the person', async () => {
    const lines = await callTool('');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ tool: 'get_invoice', user: { sub: 'user-1', name: 'alice' } });
    expect(JSON.stringify(lines)).not.toContain('alice@corp.example');
  });

  it('adds no user for the static token', async () => {
    const lines = await callTool(BEARER, false);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toHaveProperty('user');
  });
});
