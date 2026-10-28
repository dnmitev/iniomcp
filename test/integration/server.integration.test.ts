import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { present } from '../../src/tools/result.ts';
import {
  customer,
  invoice,
  pauses,
  RATE_ALWAYS,
  RATE_ONCE,
  retryAttempts,
  serviceLine,
  startFakeInioApi,
  type FakeInioApi,
} from './fake-inio-api.ts';

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
  const call = async (args: Record<string, unknown>, name = 'get_invoice') => {
    const result = await client.callTool({ name, arguments: args });
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

const EXPECTED = present(omit(invoice, 'workflowsSettings'), false);

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((k) => [k, source[k]]));
}

function omit(source: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([k]) => k !== key));
}

const CUSTOMER_ID = String(customer.id);
const PAUSE_ID = String(pauses[0]?.id);
const INVOICE_KEYS = [
  'id',
  'invoiceNo',
  'customerNo',
  'invoiceDate',
  'dueDate',
  'currency',
  'totalAmount',
  'remainingAmount',
  'status',
  'stage',
  'paymentStatus',
];
const CUSTOMER_KEYS = [
  'id',
  'customerNo',
  'customerName',
  'customerType',
  'serviceLineName',
  'directDebit',
  'orgNr',
  'createdAt',
];
const PAUSE_WITHOUT_WORKFLOW = omit(pauses[0] ?? {}, 'temporalWorkflowId');

/** Requests the fake API saw since `before`, as "path?query" strings. */
function urlsSince(before: number): string[] {
  return api.requests.slice(before).map((r) => r.url);
}

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

  it('list_customers returns summary items only', async () => {
    const { call } = await spawnServer();
    const result = await call({}, 'list_customers');
    expect(result).toEqual({
      isError: false,
      text: present(
        { items: [pick(customer, CUSTOMER_KEYS)], total: 1, limit: 25, offset: 0 },
        false,
      ),
    });
    expect(result.text).not.toContain('workflowsSettings');
    expect(result.text).not.toContain('billing@customer.example');
  });

  it('get_customer by id has no workflowsSettings anywhere by default', async () => {
    const { call } = await spawnServer();
    const result = await call({ id: CUSTOMER_ID }, 'get_customer');
    expect(result).toEqual({
      isError: false,
      text: present(
        {
          customer: omit(customer, 'workflowsSettings'),
          serviceLine: omit(serviceLine, 'workflowsSettings'),
          effectivePause: { isPaused: false },
        },
        false,
      ),
    });
    expect(result.text).not.toContain('workflowsSettings');
    // Raw fixture PII, checked independently of present().
    const address = z
      .object({ zipCode: z.string(), addressLine1: z.string() })
      .parse(customer.customerAddress);
    for (const raw of [
      String(customer.mobilePhoneNo),
      String(customer.distributionEmailAddress),
      address.zipCode,
      address.addressLine1,
    ]) {
      expect(result.text).not.toContain(raw);
    }
  });

  it('get_customer by number includes workflowsSettings on request', async () => {
    const { call } = await spawnServer();
    const result = await call(
      { number: String(customer.customerNo), includeWorkflowSettings: true },
      'get_customer',
    );
    expect(result).toEqual({
      isError: false,
      text: present({ customer, serviceLine, effectivePause: { isPaused: false } }, false),
    });
    expect(result.text.split('"workflowsSettings"')).toHaveLength(3);
  });

  it('list_customer_pauses drops temporalWorkflowId and redacts createdBy', async () => {
    const { call } = await spawnServer();
    const result = await call({ customerId: CUSTOMER_ID }, 'list_customer_pauses');
    expect(result).toEqual({
      isError: false,
      text: present({ pauses: [PAUSE_WITHOUT_WORKFLOW] }, false),
    });
    expect(result.text).not.toContain('temporalWorkflowId');
    expect(result.text).not.toContain('agent@inio.example');
    expect(result.text).toContain('[redacted-email]');
  });

  it('get_customer_pause returns the pause without temporalWorkflowId', async () => {
    const { call } = await spawnServer();
    const result = await call({ customerId: CUSTOMER_ID, pauseId: PAUSE_ID }, 'get_customer_pause');
    expect(result).toEqual({ isError: false, text: present(PAUSE_WITHOUT_WORKFLOW, false) });
    expect(result.text).not.toContain('temporalWorkflowId');
  });

  it('list_invoices returns summaries and sends a single status twice', async () => {
    const before = api.requests.length;
    const { call } = await spawnServer();
    const result = await call({ status: ['open'] }, 'list_invoices');
    expect(result).toEqual({
      isError: false,
      text: present(
        { items: [pick(invoice, INVOICE_KEYS)], total: 1, limit: 25, offset: 0 },
        false,
      ),
    });
    expect(urlsSince(before)).toEqual(['/v1/invoices?limit=25&offset=0&status=open&status=open']);
  });

  it('get_invoice withInherited by number makes the by-number lookup, then with-inherited', async () => {
    const before = api.requests.length;
    const { call } = await spawnServer();
    const result = await call(
      { number: String(invoice.invoiceNo), withInherited: true },
      'get_invoice',
    );
    expect(result.isError).toBe(false);
    expect(result.text).not.toContain('workflowsSettings');
    expect(urlsSince(before)).toEqual([
      `/v1/invoices/by-number/${encodeURIComponent(String(invoice.invoiceNo))}`,
      `/v1/invoices/${String(invoice.id)}/with-inherited`,
    ]);
  });

  it('get_invoice_retry_attempts maps the misspelled count and drops totalItems', async () => {
    const before = api.requests.length;
    const { call } = await spawnServer();
    const result = await call({ number: String(invoice.invoiceNo) }, 'get_invoice_retry_attempts');
    expect(result).toEqual({
      isError: false,
      text: JSON.stringify({
        attempts: retryAttempts.data,
        failedPaymentCount: 1,
        successfulAttemptsCount: 2,
        directDebitEligible: true,
      }),
    });
    expect(urlsSince(before)).toEqual([
      `/v1/invoices/by-number/${encodeURIComponent(String(invoice.invoiceNo))}/retry-attempts?limit=10`,
    ]);
  });

  it('succeeds after one 429 with Retry-After: 0', async () => {
    api.resetRateLimit();
    const before = api.requests.length;
    const { call } = await spawnServer();
    const result = await call({ number: RATE_ONCE });
    expect(result).toEqual({ isError: false, text: EXPECTED });
    expect(urlsSince(before)).toEqual([
      `/v1/invoices/by-number/${RATE_ONCE}`,
      `/v1/invoices/by-number/${RATE_ONCE}`,
    ]);
  });

  it('reports RATE_LIMITED when the API keeps answering 429', async () => {
    const before = api.requests.length;
    const { call } = await spawnServer();
    const result = await call({ number: RATE_ALWAYS });
    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      'RATE_LIMITED: The Inio API rate limit was reached. Try again in 1 s.',
    );
    expect(urlsSince(before)).toHaveLength(2);
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
