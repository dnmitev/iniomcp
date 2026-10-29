import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { present } from '../../src/tools/result.ts';
import {
  CONFLICT_CUSTOMER_ID,
  CONFLICT_MESSAGE,
  CREATED_PAUSE_ID,
  CREDIT_INVOICE_ID,
  CREDIT_INVOICE_NO,
  CREDIT_PAYMENT_REFERENCE,
  customer,
  INHERITED_BANK,
  INHERITED_FEE_DATE,
  invoice,
  pauses,
  RATE_ALWAYS,
  RATE_ONCE,
  RESET_WORKFLOW_ID,
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
  return { call, client, stderr: () => stderrs[index] ?? '' };
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

  it('get_invoice without withInherited does not return the inherited values', async () => {
    const { call } = await spawnServer();
    const result = await call({ id: String(invoice.id) });
    expect(result.text).not.toContain('feeApplicationDate');
    expect(result.text).not.toContain(INHERITED_BANK);
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
    expect(result.text).toContain(`"feeApplicationDate":"${INHERITED_FEE_DATE}"`);
    expect(result.text).toContain(`"bankName":"${INHERITED_BANK}"`);
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

  describe('write tools', () => {
    const WRITE_TOOLS = [
      'cancel_customer_pause',
      'create_customer_pause',
      'update_customer_pause',
      'update_invoice_due_date',
      'update_invoice_stop_until_dates',
      'update_customer',
      'reset_invoice_stage',
      'create_credit_invoice',
      'match_credit_invoice',
    ];
    const READ_TOOLS = [
      'get_customer',
      'get_customer_pause',
      'get_invoice',
      'get_invoice_retry_attempts',
      'list_customer_pauses',
      'list_customers',
      'list_invoices',
    ];
    const WRITES = { INIO_ALLOW_WRITES: 'true' };
    const NO = String(invoice.invoiceNo);

    afterEach(() => {
      api.resetWrites();
    });

    function sent(before: number) {
      return api.requests
        .slice(before)
        .map(({ method, url, body, userRealName }) => ({ method, url, body, userRealName }));
    }

    const Pause = z.object({
      id: z.string(),
      status: z.string(),
      endAt: z.string().optional(),
      createdBy: z.string().optional(),
    });

    it('lists the 7 read tools only when INIO_ALLOW_WRITES is not set', async () => {
      const { client } = await spawnServer();
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(READ_TOOLS);
    });

    it('lists the 7 read tools only when INIO_ALLOW_WRITES is false', async () => {
      const { client } = await spawnServer({ INIO_ALLOW_WRITES: 'false' });
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(READ_TOOLS);
    });

    it('lists 16 tools when INIO_ALLOW_WRITES=true', async () => {
      const { client } = await spawnServer(WRITES);
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(16);
      expect(tools.map((t) => t.name).sort()).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
    });

    it('create_customer_pause posts the pause and returns it without temporalWorkflowId', async () => {
      const before = api.requests.length;
      const { call } = await spawnServer(WRITES);
      const args = {
        customerId: CUSTOMER_ID,
        scope: 'reminders',
        startAt: '2026-12-01',
        endAt: '2026-12-31',
        reason: 'Payment plan',
      };
      const result = await call(args, 'create_customer_pause');
      expect(result.isError).toBe(false);
      const { customerId: _c, ...body } = args;
      expect(sent(before)).toEqual([
        {
          method: 'POST',
          url: `/v1/customers/${CUSTOMER_ID}/pauses`,
          body: JSON.stringify(body),
          userRealName: 'inio-mcp',
        },
      ]);
      const pause = Pause.parse(JSON.parse(result.text));
      expect(pause).toMatchObject({ id: CREATED_PAUSE_ID, status: 'scheduled' });
      expect(result.text).not.toContain('temporalWorkflowId');
      expect(result.text).not.toContain('agent@inio.example');
      expect(pause.createdBy).toBe('[redacted-email]');
    });

    it('create_customer_pause shows API field errors end to end', async () => {
      const { call } = await spawnServer(WRITES);
      const result = await call(
        {
          customerId: CONFLICT_CUSTOMER_ID,
          scope: 'both',
          startAt: '2026-12-01',
          reason: 'Overlap',
        },
        'create_customer_pause',
      );
      expect(result).toEqual({
        isError: true,
        text: `CONFLICT: ${CONFLICT_MESSAGE} (correlationId it-409) Fields: startAt: Overlaps pause 2026-11-01`,
      });
    });

    it('update_customer_pause patches only the given fields and returns the pause', async () => {
      const before = api.requests.length;
      const { call } = await spawnServer(WRITES);
      const result = await call(
        { customerId: CUSTOMER_ID, pauseId: PAUSE_ID, endAt: '2027-01-15', reason: 'Extended' },
        'update_customer_pause',
      );
      expect(result.isError).toBe(false);
      expect(sent(before)).toEqual([
        {
          method: 'PATCH',
          url: `/v1/customers/${CUSTOMER_ID}/pauses/${PAUSE_ID}`,
          body: JSON.stringify({ endAt: '2027-01-15', reason: 'Extended' }),
          userRealName: 'inio-mcp',
        },
      ]);
      expect(Pause.parse(JSON.parse(result.text))).toMatchObject({
        id: PAUSE_ID,
        endAt: '2027-01-15',
      });
      expect(result.text).not.toContain('temporalWorkflowId');
    });

    it('cancel_customer_pause posts the reason and returns the cancelled pause', async () => {
      const before = api.requests.length;
      const { call } = await spawnServer(WRITES);
      const result = await call(
        { customerId: CUSTOMER_ID, pauseId: PAUSE_ID, reason: 'No longer needed' },
        'cancel_customer_pause',
      );
      expect(result.isError).toBe(false);
      expect(sent(before)).toEqual([
        {
          method: 'POST',
          url: `/v1/customers/${CUSTOMER_ID}/pauses/${PAUSE_ID}/cancel`,
          body: JSON.stringify({ reason: 'No longer needed' }),
          userRealName: 'inio-mcp',
        },
      ]);
      expect(Pause.parse(JSON.parse(result.text))).toMatchObject({
        id: PAUSE_ID,
        status: 'cancelled',
      });
    });

    it('update_invoice_due_date posts by number, reads back, and reports the new date', async () => {
      const before = api.requests.length;
      const { call } = await spawnServer(WRITES);
      const result = await call(
        { number: NO, dueDate: '2026-12-15', reason: 'Customer request' },
        'update_invoice_due_date',
      );
      expect(result).toEqual({
        isError: false,
        text: present(
          {
            updated: true,
            invoice: NO,
            requestedDueDate: '2026-12-15',
            invoiceNo: NO,
            dueDate: '2026-12-15',
            stage: invoice.stage,
            status: invoice.status,
          },
          false,
        ),
      });
      expect(sent(before)).toEqual([
        {
          method: 'POST',
          url: `/v1/invoices/by-number/${encodeURIComponent(NO)}/update-due-date`,
          body: JSON.stringify({ dueDate: '2026-12-15', updateReason: 'Customer request' }),
          userRealName: 'inio-mcp',
        },
        {
          method: 'GET',
          url: `/v1/invoices/by-number/${encodeURIComponent(NO)}`,
          body: '',
          userRealName: undefined,
        },
      ]);
    });

    it('update_invoice_stop_until_dates posts by id, reads back, and reports the dates', async () => {
      const before = api.requests.length;
      const { call } = await spawnServer(WRITES);
      const result = await call(
        { id: String(invoice.id), reason: 'Dispute', invoicing1: '2027-03-01' },
        'update_invoice_stop_until_dates',
      );
      expect(result).toEqual({
        isError: false,
        text: present(
          {
            updated: true,
            invoice: String(invoice.id),
            invoiceNo: NO,
            stopUntilDates: { invoicing1StopUntilDate: '2027-03-01' },
          },
          false,
        ),
      });
      expect(sent(before)).toEqual([
        {
          method: 'POST',
          url: `/v1/invoices/${String(invoice.id)}/update-stop-until-dates`,
          body: JSON.stringify({
            metadata: { invoicing1StopUntilDate: '2027-03-01' },
            escalationStopReason: 'Dispute',
          }),
          userRealName: 'inio-mcp',
        },
        {
          method: 'GET',
          url: `/v1/invoices/${String(invoice.id)}`,
          body: '',
          userRealName: undefined,
        },
      ]);
    });

    const INVOICE_ID = String(invoice.id);
    const ITEM_ID = '00000000-0000-4000-8000-000000000004';

    it('update_customer patches by id and returns the customer without workflowsSettings', async () => {
      const before = api.requests.length;
      const { call } = await spawnServer(WRITES);
      const result = await call(
        { id: CUSTOMER_ID, customerName: 'Renamed AB', mobilePhoneNo: null },
        'update_customer',
      );
      expect(result.isError).toBe(false);
      expect(sent(before)).toEqual([
        {
          method: 'PATCH',
          url: `/v1/customers/${CUSTOMER_ID}`,
          body: JSON.stringify({ customerName: 'Renamed AB', mobilePhoneNo: null }),
          userRealName: 'inio-mcp',
        },
      ]);
      const out = z
        .object({ id: z.string(), customerName: z.string() })
        .parse(JSON.parse(result.text));
      expect(out).toMatchObject({ id: CUSTOMER_ID, customerName: 'Renamed AB' });
      expect(result.text).not.toContain('mobilePhoneNo');
      expect(result.text).not.toContain('workflowsSettings');
    });

    it('update_customer patches by number', async () => {
      const before = api.requests.length;
      const { call } = await spawnServer(WRITES);
      const no = String(customer.customerNo);
      const result = await call({ number: no, languageCode: 'EN' }, 'update_customer');
      expect(result.isError).toBe(false);
      expect(sent(before)).toEqual([
        {
          method: 'PATCH',
          url: `/v1/customers/by-number/${encodeURIComponent(no)}`,
          body: JSON.stringify({ languageCode: 'EN' }),
          userRealName: 'inio-mcp',
        },
      ]);
      expect(JSON.parse(result.text)).toMatchObject({ customerNo: no, languageCode: 'EN' });
    });

    it('reset_invoice_stage by id posts the reset and returns the plan without workflowId', async () => {
      const before = api.requests.length;
      const { call } = await spawnServer(WRITES);
      const result = await call(
        { id: INVOICE_ID, targetStage: 'reminded', reason: 'Wrong stage' },
        'reset_invoice_stage',
      );
      expect(result.isError).toBe(false);
      expect(sent(before)).toEqual([
        {
          method: 'POST',
          url: `/v1/invoices/${INVOICE_ID}/reset-stage`,
          body: JSON.stringify({
            targetStage: 'reminded',
            reason: 'Wrong stage',
            redistribute: false,
          }),
          userRealName: 'inio-mcp',
        },
      ]);
      expect(JSON.parse(result.text)).toMatchObject({
        targetStage: 'reminded',
        willRedistribute: false,
      });
      expect(result.text).not.toContain(RESET_WORKFLOW_ID);
    });

    it('reset_invoice_stage by number looks up the id, then posts to the id route', async () => {
      const before = api.requests.length;
      const { call } = await spawnServer(WRITES);
      const result = await call(
        { number: NO, targetStage: 'invoiced', dueDate: '2099-01-31', reason: 'Wrong stage' },
        'reset_invoice_stage',
      );
      expect(result.isError).toBe(false);
      expect(sent(before)).toEqual([
        {
          method: 'GET',
          url: `/v1/invoices/by-number/${encodeURIComponent(NO)}`,
          body: '',
          userRealName: undefined,
        },
        {
          method: 'POST',
          url: `/v1/invoices/${INVOICE_ID}/reset-stage`,
          body: JSON.stringify({
            targetStage: 'invoiced',
            dueDate: '2099-01-31',
            reason: 'Wrong stage',
            redistribute: false,
          }),
          userRealName: 'inio-mcp',
        },
      ]);
      expect(JSON.parse(result.text)).toMatchObject({
        targetStage: 'invoiced',
        dueDate: '2099-01-31',
      });
    });

    it('reset_invoice_stage fails without a reset when the number lookup is 404', async () => {
      const before = api.requests.length;
      const { call } = await spawnServer(WRITES);
      const result = await call(
        { number: 'NO-SUCH', targetStage: 'reminded', reason: 'Wrong stage' },
        'reset_invoice_stage',
      );
      expect(result.isError).toBe(true);
      expect(result.text).toContain('NOT_FOUND');
      expect(sent(before).map((r) => r.method)).toEqual(['GET']);
    });

    it('create_credit_invoice posts by id and returns the new credit invoice', async () => {
      const before = api.requests.length;
      const { call } = await spawnServer(WRITES);
      const result = await call(
        {
          id: INVOICE_ID,
          creditInvoiceNo: CREDIT_INVOICE_NO,
          items: [{ debitItemId: ITEM_ID, unitPrice: -10, quantity: 2 }],
        },
        'create_credit_invoice',
      );
      expect(result.isError).toBe(false);
      expect(sent(before)).toEqual([
        {
          method: 'POST',
          url: `/v1/invoices/${INVOICE_ID}/credit-invoice`,
          body: JSON.stringify({
            invoiceNo: CREDIT_INVOICE_NO,
            invoiceItems: [{ debitItemId: ITEM_ID, unitPrice: -10, quantity: 2 }],
            isReverseTaxation: false,
            distributionEnabled: false,
            distributionMethod: '',
          }),
          userRealName: 'inio-mcp',
        },
      ]);
      expect(JSON.parse(result.text)).toEqual({
        created: true,
        id: CREDIT_INVOICE_ID,
        invoiceNo: CREDIT_INVOICE_NO,
        paymentReference: CREDIT_PAYMENT_REFERENCE,
        items: [
          {
            id: '00000000-0000-4000-8000-000000000050',
            debitItemId: ITEM_ID,
            unitPrice: -10,
            quantity: 2,
          },
        ],
      });
    });

    it('create_credit_invoice posts by number', async () => {
      const before = api.requests.length;
      const { call } = await spawnServer(WRITES);
      const result = await call(
        {
          number: NO,
          creditInvoiceNo: CREDIT_INVOICE_NO,
          items: [{ debitItemId: ITEM_ID, unitPrice: 0, quantity: 1 }],
        },
        'create_credit_invoice',
      );
      expect(result.isError).toBe(false);
      expect(sent(before).map(({ method, url }) => ({ method, url }))).toEqual([
        { method: 'POST', url: `/v1/invoices/by-number/${encodeURIComponent(NO)}/credit-invoice` },
      ]);
    });

    it('match_credit_invoice posts by id, reads back, and reports the result', async () => {
      const before = api.requests.length;
      const { call } = await spawnServer(WRITES);
      const result = await call(
        { id: INVOICE_ID, creditInvoiceNo: CREDIT_INVOICE_NO, amount: -25.5 },
        'match_credit_invoice',
      );
      expect(result).toEqual({
        isError: false,
        text: present(
          {
            matched: true,
            invoice: INVOICE_ID,
            creditInvoiceNo: CREDIT_INVOICE_NO,
            amount: -25.5,
            creditInvoiceId: CREDIT_INVOICE_ID,
            remainingAmount: invoice.remainingAmount,
            paymentStatus: invoice.paymentStatus,
          },
          false,
        ),
      });
      expect(sent(before)).toEqual([
        {
          method: 'POST',
          url: `/v1/invoices/${INVOICE_ID}/match-credit-invoice`,
          body: JSON.stringify({ creditInvoiceNo: CREDIT_INVOICE_NO, amount: -25.5 }),
          userRealName: 'inio-mcp',
        },
        { method: 'GET', url: `/v1/invoices/${INVOICE_ID}`, body: '', userRealName: undefined },
      ]);
    });

    it('match_credit_invoice posts by number', async () => {
      const before = api.requests.length;
      const { call } = await spawnServer(WRITES);
      const result = await call(
        { number: NO, creditInvoiceNo: CREDIT_INVOICE_NO, amount: -1 },
        'match_credit_invoice',
      );
      expect(result.isError).toBe(false);
      expect(sent(before).map(({ method, url }) => ({ method, url }))).toEqual([
        {
          method: 'POST',
          url: `/v1/invoices/by-number/${encodeURIComponent(NO)}/match-credit-invoice`,
        },
        { method: 'GET', url: `/v1/invoices/by-number/${encodeURIComponent(NO)}` },
      ]);
    });

    it('does not send the audit header on read requests', async () => {
      const before = api.requests.length;
      const { call } = await spawnServer(WRITES);
      await call({ id: String(invoice.id) }, 'get_invoice');
      expect(sent(before).map((r) => r.userRealName)).toEqual([undefined]);
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
