import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { present } from '../../src/tools/result.ts';
import { invoice, startFakeInioApi, type FakeInioApi } from './fake-inio-api.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REALM_FILE = fileURLToPath(new URL('./keycloak-realm.json', import.meta.url));
const REALM = 'inio-test-api';
const CLIENT_ID = 'mcp-it';
const SECRET = 'mcp-it-test-secret';

let keycloak: StartedTestContainer;
let api: FakeInioApi;
let issuer: string;
const spawned: Client[] = [];
const stderrs: string[] = [];

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
  // localhost (not 127.0.0.1 or a docker host name): config allows http only for localhost.
  issuer = `http://localhost:${keycloak.getMappedPort(8080)}/realms/${REALM}`;
}, 120_000);

afterAll(async () => {
  await Promise.all(spawned.map((c) => c.close()));
  await api?.close();
  await keycloak?.stop();
}, 60_000);

async function spawnServer(env: Partial<Record<string, string>> = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/index.js'],
    cwd: ROOT,
    env: {
      PATH: process.env.PATH ?? '',
      INIO_CLIENT_ID: CLIENT_ID,
      INIO_CLIENT_SECRET: SECRET,
      INIO_AUTH_URL: issuer,
      INIO_URL: api.url,
      INIO_LOG_LEVEL: 'debug',
      ...env,
    },
    stderr: 'pipe',
  });
  const index = stderrs.push('') - 1;
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderrs[index] += chunk.toString('utf8');
  });
  const client = new Client({ name: 'integration-test', version: '0.0.0' });
  spawned.push(client);
  await client.connect(transport);
  const call = async (args: Record<string, string>) => {
    const result = await client.callTool({ name: 'get_invoice', arguments: args });
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content).toHaveLength(1);
    return { isError: result.isError === true, text: content[0]?.text ?? '' };
  };
  return { call, stderr: () => stderrs[index] ?? '' };
}

const Jwt = z.object({ iss: z.string(), azp: z.string() });
const LogLine = z.object({ msg: z.string().optional() });

function jwtPayload(authorization: string | undefined) {
  const part = (authorization ?? '').replace(/^Bearer /, '').split('.')[1] ?? '';
  return Jwt.parse(JSON.parse(Buffer.from(part, 'base64url').toString('utf8')));
}

function lines(stderr: string): string[] {
  return stderr.split('\n').filter((l) => l.length > 0);
}

async function closedPort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const address = srv.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  return address.port;
}

const EXPECTED = present(invoice, false);

describe('built server over stdio with real Keycloak and fake Inio API', () => {
  it('returns the redacted invoice by id', async () => {
    const { call } = await spawnServer();
    const result = await call({ id: String(invoice.id) });
    expect(result).toEqual({ isError: false, text: EXPECTED });
    expect(z.object({ IBAN: z.unknown() }).parse(JSON.parse(result.text)).IBAN).toBe('[redacted]');
  });

  it('returns the redacted invoice by number', async () => {
    const { call } = await spawnServer();
    const result = await call({ number: String(invoice.invoiceNo) });
    expect(result).toEqual({ isError: false, text: EXPECTED });
  });

  it('sends the fake API a Bearer JWT issued by the realm for the mcp-it client', async () => {
    const before = api.requests.length;
    const { call } = await spawnServer();
    await call({ id: String(invoice.id) });
    const sent = api.requests.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    const payload = jwtPayload(sent[0]?.authorization);
    expect(payload.iss.endsWith(`/realms/${REALM}`)).toBe(true);
    expect(payload.azp).toBe(CLIENT_ID);
  });

  it('accepts INIO_AUTH_URL as the full token endpoint', async () => {
    const { call } = await spawnServer({
      INIO_AUTH_URL: `${issuer}/protocol/openid-connect/token`,
    });
    expect(await call({ id: String(invoice.id) })).toEqual({ isError: false, text: EXPECTED });
  });

  it('accepts INIO_AUTH_URL as the realm issuer', async () => {
    const { call } = await spawnServer({ INIO_AUTH_URL: issuer });
    expect(await call({ id: String(invoice.id) })).toEqual({ isError: false, text: EXPECTED });
  });

  it('reuses the cached token across calls (one token request)', async () => {
    const { call, stderr } = await spawnServer();
    await call({ id: String(invoice.id) });
    await call({ number: String(invoice.invoiceNo) });
    const msgs = lines(stderr()).map((l) => LogLine.parse(JSON.parse(l)).msg);
    expect(msgs.filter((m) => m === 'token fetched')).toHaveLength(1);
    expect(msgs.filter((m) => m === 'token cache hit')).toHaveLength(1);
  });

  it('reports wrong client credentials as an authentication error', async () => {
    const { call } = await spawnServer({ INIO_CLIENT_SECRET: 'wrong-secret' });
    expect(await call({ id: String(invoice.id) })).toEqual({
      isError: true,
      text: 'Authentication failed (HTTP 401: unauthorized_client). Check INIO_CLIENT_ID and INIO_CLIENT_SECRET.',
    });
  });

  it('maps an API 404 to NOT_FOUND with the correlation id', async () => {
    const { call } = await spawnServer();
    expect(await call({ number: 'nope-1' })).toEqual({
      isError: true,
      text: 'NOT_FOUND: Invoice with number nope-1 could not be found (correlationId it-404)',
    });
  });

  it('reports an unreachable API as a network error', async () => {
    const { call } = await spawnServer({
      INIO_URL: `http://127.0.0.1:${await closedPort()}/v1`,
    });
    expect(await call({ id: String(invoice.id) })).toEqual({
      isError: true,
      text: 'NETWORK_ERROR: Cannot reach the Inio API (INIO_URL).',
    });
  });

  // Runs last: inspects stderr of every server spawned above.
  it('writes only JSON lines to stderr and never the client secret or an issued token', () => {
    const tokens = api.requests
      .map((r) => r.authorization?.replace(/^Bearer /, '') ?? '')
      .filter((t) => t.length > 0);
    expect(tokens.length).toBeGreaterThan(0);
    const all = stderrs.join('\n');
    expect(lines(all).length).toBeGreaterThan(0);
    for (const line of lines(all)) expect(() => JSON.parse(line) as unknown).not.toThrow();
    expect(all).not.toContain(SECRET);
    for (const token of tokens) {
      expect(all).not.toContain(token);
      expect(all).not.toContain(token.split('.')[2]);
    }
  });
});
