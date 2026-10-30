import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startHttpServer } from '../../src/http.ts';
import type { HttpConfig } from '../../src/http.ts';
import { invoice, startFakeInioApi, type FakeInioApi } from './fake-inio-api.ts';

const REALM_FILE = fileURLToPath(new URL('./keycloak-realm.json', import.meta.url));
const REALM = 'inio-test-api';
const BEARER = 'http-it-bearer-0123456789-abcdefghijklmnopqrstuvwxyz';

let keycloak: StartedTestContainer;
let api: FakeInioApi;
let server: { port: number; close(): Promise<void> };
const clients: Client[] = [];

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
  const config: HttpConfig = {
    clientId: 'mcp-it',
    clientSecret: 'mcp-it-test-secret',
    authUrl: `http://localhost:${keycloak.getMappedPort(8080)}/realms/${REALM}/protocol/openid-connect/token`,
    apiUrl: api.url,
    allowWrites: false,
    revealPii: false,
    transport: 'http',
    logLevel: 'info',
    requestTimeoutMs: 30000,
    http: { port: 0, host: '127.0.0.1', authToken: BEARER, allowedOrigins: [] },
  };
  server = await startHttpServer(config);
}, 120_000);

afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()));
  await server?.close();
  await api?.close();
  await keycloak?.stop();
}, 60_000);

const url = () => `http://127.0.0.1:${server.port}/mcp`;

describe('HTTP transport with real Keycloak and fake Inio API', () => {
  it('lists tools and calls get_invoice with the bearer token', async () => {
    const client = new Client({ name: 'http-it', version: '0.0.0' });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url()), {
        requestInit: { headers: { authorization: `Bearer ${BEARER}` } },
      }),
    );
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('get_invoice');
    const result = await client.callTool({
      name: 'get_invoice',
      arguments: { id: String(invoice.id) },
    });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.content)).toContain(String(invoice.invoiceNo));
  });

  it('returns 401 without a token', async () => {
    const res = await fetch(url(), { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a foreign Origin with a valid token', async () => {
    const res = await fetch(url(), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${BEARER}`,
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });
});
