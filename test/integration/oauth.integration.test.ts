import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startHttpServer } from '../../src/http.ts';
import type { HttpConfig } from '../../src/http.ts';
import { WRITE_TOOL_NAMES } from '../../src/config.ts';
import { startFakeInioApi, type FakeInioApi } from './fake-inio-api.ts';

const REALM_FILE = fileURLToPath(new URL('./keycloak-realm.json', import.meta.url));
const REALM = 'inio-test-api';
const BEARER = 'oauth-it-bearer-0123456789-abcdefghijklmnopqrstuvwxyz';
const AUDIENCE = 'inio-mcp-test';

let keycloak: StartedTestContainer;
let api: FakeInioApi;
let server: { port: number; close(): Promise<void> };
let issuer: string;
let resourceUrl: string;
const clients: Client[] = [];

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      s.close(() =>
        addr && typeof addr === 'object' ? resolve(addr.port) : reject(new Error('no port')),
      );
    });
  });

const tokenEndpoint = () => `${issuer}/protocol/openid-connect/token`;

async function grant(params: Record<string, string>): Promise<string> {
  const res = await fetch(tokenEndpoint(), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  expect(res.status).toBe(200);
  const body: { access_token: string } = await res.json();
  return body.access_token;
}

const userToken = () =>
  grant({
    grant_type: 'password',
    client_id: 'mcp-test-public',
    username: 'mcp-test-user',
    password: 'mcp-test-password',
  });

const serviceToken = () =>
  grant({
    grant_type: 'client_credentials',
    client_id: 'mcp-it',
    client_secret: 'mcp-it-test-secret',
  });

const post = (token?: string) =>
  fetch(resourceUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body: '{}',
  });

async function connect(token: string): Promise<Client> {
  const client = new Client({ name: 'oauth-it', version: '0.0.0' });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(resourceUrl), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

beforeAll(async () => {
  [keycloak, api] = await Promise.all([
    new GenericContainer('quay.io/keycloak/keycloak:26.8.1')
      .withCommand(['start-dev', '--import-realm'])
      .withEnvironment({
        KC_BOOTSTRAP_ADMIN_USERNAME: 'admin',
        KC_BOOTSTRAP_ADMIN_PASSWORD: 'admin',
      })
      .withCopyFilesToContainer([
        { source: REALM_FILE, target: '/opt/keycloak/data/import/realm.json' },
      ])
      .withExposedPorts(8080)
      .withWaitStrategy(
        Wait.forHttp(`/realms/${REALM}/.well-known/openid-configuration`, 8080).forStatusCode(200),
      )
      .withStartupTimeout(110_000)
      .start(),
    startFakeInioApi(),
  ]);
  issuer = `http://localhost:${keycloak.getMappedPort(8080)}/realms/${REALM}`;
  const port = await freePort();
  resourceUrl = `http://127.0.0.1:${port}/mcp`;
  const config: HttpConfig = {
    clientId: 'mcp-it',
    clientSecret: 'mcp-it-test-secret',
    authUrl: tokenEndpoint(),
    apiUrl: api.url,
    allowWrites: false,
    revealPii: false,
    transport: 'http',
    logLevel: 'info',
    requestTimeoutMs: 30000,
    writeTools: new Set(WRITE_TOOL_NAMES),
    http: {
      port,
      host: '127.0.0.1',
      authToken: BEARER,
      allowedOrigins: [],
      oauth: { issuer, resourceUrl, audience: AUDIENCE },
    },
  };
  server = await startHttpServer(config);
}, 120_000);

afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()));
  await server?.close();
  await api?.close();
  await keycloak?.stop();
}, 60_000);

describe('OAuth resource server with real Keycloak', () => {
  it.each(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'])(
    'serves protected resource metadata at %s',
    async (path) => {
      const res = await fetch(`http://127.0.0.1:${server.port}${path}`);
      expect(res.status).toBe(200);
      const body: { resource: string; authorization_servers: string[] } = await res.json();
      expect(body.resource).toBe(resourceUrl);
      expect(body.authorization_servers).toEqual([issuer]);
    },
  );

  it('accepts a user token issued by Keycloak with the configured audience', async () => {
    const client = await connect(await userToken());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('get_invoice');
  });

  it('rejects a token without the configured audience as invalid_token', async () => {
    const res = await post(await serviceToken());
    expect(res.status).toBe(401);
    const challenge = res.headers.get('www-authenticate') ?? '';
    expect(challenge).toContain(
      `resource_metadata="http://127.0.0.1:${server.port}/.well-known/oauth-protected-resource/mcp"`,
    );
    expect(challenge).toContain('error="invalid_token"');
  });

  it('still accepts the static bearer token', async () => {
    const client = await connect(BEARER);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('get_invoice');
  });

  it('answers 401 with resource_metadata when no token is sent', async () => {
    const res = await post();
    expect(res.status).toBe(401);
    const challenge = res.headers.get('www-authenticate') ?? '';
    expect(challenge).toContain('resource_metadata="');
    expect(challenge).not.toContain('invalid_token');
  });
});
