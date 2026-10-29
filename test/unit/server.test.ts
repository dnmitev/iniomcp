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
  requestTimeoutMs: 30000,
};

const INVOICE = { id: ID, number: 'INV-1', total: 10, IBAN: 'BG80BNBG96611020345678' };
const CUSTOMER = { id: ID, customerNo: 'C-1', customerName: 'Acme', SSN: '19800101-1234' };
const TOOLS = [
  'get_customer',
  'get_customer_pause',
  'get_invoice',
  'get_invoice_retry_attempts',
  'list_customer_pauses',
  'list_customers',
  'list_invoices',
];

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
    if (url === `${API_URL}/customers?limit=25&offset=0`) {
      const page = { data: [CUSTOMER], total: 1, limit: 25, offset: 0 };
      return Promise.resolve(json({ success: true, status: 200, result: page }));
    }
    if (url === `${API_URL}/invoices?limit=25&offset=0`) {
      const page = { data: [{ ...INVOICE, invoiceNo: 'INV-1' }], total: 1, limit: 25, offset: 0 };
      return Promise.resolve(json({ success: true, status: 200, result: page }));
    }
    if (url === `${API_URL}/customers/${ID}`) {
      const result = { externalCustomer: CUSTOMER, serviceLine: null, effectivePause: null };
      return Promise.resolve(json({ success: true, status: 200, result }));
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

  it('lists exactly the get_customer, get_invoice, get_invoice_retry_attempts, pause tools, list_customers and list_invoices', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);
  });

  it('advertises each tool with its title, description and input descriptions', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const meta = Object.fromEntries(
      tools.map((t) => [
        t.name,
        {
          title: t.title,
          description: t.description,
          inputs: Object.fromEntries(
            Object.entries(t.inputSchema.properties ?? {}).map(([k, v]) => [
              k,
              z.object({ description: z.string().optional() }).parse(v).description,
            ]),
          ),
        },
      ]),
    );
    expect(meta).toStrictEqual({
      get_invoice: {
        title: 'Get invoice',
        description:
          'Fetch one invoice by UUID (id) or invoice number (number); pass exactly one. Personal data is redacted unless the server runs with INIO_REVEAL_PII=true.',
        inputs: {
          id: 'Invoice UUID',
          number: 'Business invoice number, e.g. INV-1001',
          withInherited:
            'Include inherited values (IBAN, bank, effective pause). With number this makes two API calls.',
          includeWorkflowSettings:
            'Include workflowsSettings: how and when each stage (setup, invoicing1-4, paid, credit) is distributed (email, SMS, paper), escalation fees and timing, and which stages are enabled. Leave false unless the question is about these.',
        },
      },
      get_invoice_retry_attempts: {
        title: 'Get invoice retry attempts',
        description:
          'Direct-debit retry attempts for one invoice, by UUID (id) or invoice number (number), newest first. Returns attempts plus failed and successful counts and whether the invoice is eligible for direct debit.',
        inputs: {
          id: 'Invoice UUID',
          number: 'Business invoice number, e.g. INV-1001',
          limit: 'Maximum attempts to return, 1-50',
        },
      },
      get_customer: {
        title: 'Get customer',
        description:
          'Fetch one customer with its service line and any active pause, by UUID (id) or customer number (number); pass exactly one. Personal data is redacted unless the server runs with INIO_REVEAL_PII=true.',
        inputs: {
          id: 'Customer UUID',
          number: 'Business customer number, e.g. C-1001',
          includeWorkflowSettings:
            'Include workflowsSettings: how and when each stage (setup, invoicing1-4, paid, credit) is distributed (email, SMS, paper), escalation fees and timing, and which stages are enabled. Leave false unless the question is about these.',
        },
      },
      list_invoices: {
        title: 'List invoices',
        description:
          'List invoice summaries, filtered by invoiceNo, customerId or customerNo (not both), status or paymentStatus, with sort and limit/offset paging. Use get_invoice for full details. Personal data is redacted unless the server runs with INIO_REVEAL_PII=true.',
        inputs: {
          invoiceNo: 'Exact invoice number, e.g. INV-1001',
          customerId: 'Customer UUID; not together with customerNo',
          customerNo: 'Exact customer number, e.g. C-1001; not together with customerId',
          status: 'Invoice status filter, any of open, paused, cancelled, closed',
          paymentStatus:
            'Payment status filter, any of notPaid, paid, overPaid, partiallyPaid, capitalPaid',
          sort: 'Sort field (invoiceNo, invoiceDate, dueDate, totalAmount, remainingAmount, createdAt or updatedAt)',
          order: 'Sort order; requires sort, default asc',
          limit: 'Page size, 1-100',
          offset: 'Number of items to skip',
        },
      },
      get_customer_pause: {
        title: 'Get customer pause',
        description:
          'Fetch one customer pause by customer UUID and pause UUID. Personal data is redacted unless the server runs with INIO_REVEAL_PII=true.',
        inputs: { customerId: 'Customer UUID', pauseId: 'Pause UUID' },
      },
      list_customer_pauses: {
        title: 'List customer pauses',
        description:
          'List pauses for one customer by customer UUID (get_customer returns it), optionally filtered by status. Returns all matching pauses ordered by start time. Personal data is redacted unless the server runs with INIO_REVEAL_PII=true.',
        inputs: {
          customerId: 'Customer UUID',
          status: 'Pause status filter: scheduled, active, completed or cancelled',
        },
      },
      list_customers: {
        title: 'List customers',
        description:
          'List customer summaries, filtered by customerNo, directDebit or serviceLineId, with sort and limit/offset paging. Use get_customer for full details. Personal data is redacted unless the server runs with INIO_REVEAL_PII=true.',
        inputs: {
          customerNo: 'Exact customer number, e.g. C-1001',
          directDebit: 'Only customers with (true) or without direct debit',
          serviceLineId: 'Service line UUID',
          sort: 'Sort field (customerName, customerNo, createdAt or updatedAt)',
          order: 'Sort order; requires sort, default asc',
          limit: 'Page size, 1-100',
          offset: 'Number of items to skip',
        },
      },
    });
  });

  it('wires list_customers to GET /customers with default paging and redaction', async () => {
    const { client, fetch } = await connect();
    const result = await client.callTool({ name: 'list_customers', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({
          items: [{ id: ID, customerNo: 'C-1', customerName: 'Acme' }],
          total: 1,
          limit: 25,
          offset: 0,
        }),
      },
    ]);
    expect(urlOf(fetch.mock.calls[1]?.[0] ?? '')).toBe(`${API_URL}/customers?limit=25&offset=0`);
  });

  it('wires list_invoices to GET /invoices with default paging and the summary shape', async () => {
    const { client, fetch } = await connect();
    const result = await client.callTool({ name: 'list_invoices', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({
          items: [{ id: ID, invoiceNo: 'INV-1' }],
          total: 1,
          limit: 25,
          offset: 0,
        }),
      },
    ]);
    expect(urlOf(fetch.mock.calls[1]?.[0] ?? '')).toBe(`${API_URL}/invoices?limit=25&offset=0`);
  });

  it('wires get_customer to GET /customers/<id> with redaction from config', async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: 'get_customer', arguments: { id: ID } });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify({ customer: { ...CUSTOMER, SSN: '[redacted]' } }) },
    ]);
  });

  it('passes revealPii from config to get_customer', async () => {
    const { client } = await connect({ ...CONFIG, revealPii: true });
    const result = await client.callTool({ name: 'get_customer', arguments: { id: ID } });
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify({ customer: CUSTOMER }) },
    ]);
  });

  it('logs list_customers and get_customer calls through the injected logger', async () => {
    const { client, logger } = await connect();
    await client.callTool({ name: 'list_customers', arguments: {} });
    await client.callTool({ name: 'get_customer', arguments: { id: ID } });
    const tools = logger.info.mock.calls
      .filter(([, msg]) => msg === 'tool call')
      .map(([obj]) => obj);
    expect(tools).toEqual([
      expect.objectContaining({ tool: 'list_customers', outcome: 'ok' }),
      expect.objectContaining({ tool: 'get_customer', outcome: 'ok' }),
    ]);
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

describe('write gate', () => {
  const WRITE_TOOLS = [
    'cancel_customer_pause',
    'create_customer_pause',
    'update_customer_pause',
    'update_invoice_due_date',
    'update_invoice_stop_until_dates',
  ];

  it('lists exactly the 7 read tools when allowWrites is false', async () => {
    const { client } = await connect({ ...CONFIG, allowWrites: false });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);
  });

  it('lists exactly the 7 read tools when allowWrites is not set', async () => {
    const unset = { ...CONFIG };
    Reflect.deleteProperty(unset, 'allowWrites');
    const { client } = await connect(unset);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);
  });

  it('lists the 5 write tools besides the 7 read tools when allowWrites is true', async () => {
    const { client } = await connect({ ...CONFIG, allowWrites: true });
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(12);
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOLS, ...WRITE_TOOLS].sort());
  });

  it.each(WRITE_TOOLS)(
    'annotates %s as a non-read-only, destructive, non-idempotent tool',
    async (name) => {
      const { client } = await connect({ ...CONFIG, allowWrites: true });
      const { tools } = await client.listTools();
      expect(tools.find((t) => t.name === name)?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      });
    },
  );

  it('advertises each write tool with its title, description and input descriptions', async () => {
    const { client } = await connect({ ...CONFIG, allowWrites: true });
    const { tools } = await client.listTools();
    const meta = Object.fromEntries(
      tools
        .filter((t) => WRITE_TOOLS.includes(t.name))
        .map((t) => [
          t.name,
          {
            title: t.title,
            description: t.description,
            inputs: Object.fromEntries(
              Object.entries(t.inputSchema.properties ?? {}).map(([k, v]) => [
                k,
                z.object({ description: z.string().optional() }).parse(v).description,
              ]),
            ),
          },
        ]),
    );
    const stopInputs = Object.fromEntries(
      [
        ...['invoicing1', 'invoicing2', 'invoicing3', 'invoicing4'],
        ...['collection1', 'collection2', 'collection3', 'collection4', 'collection5'],
      ].map((step) => [step, `Stop-until date for ${step}, YYYY-MM-DD, or null to clear`]),
    );
    expect(meta).toStrictEqual({
      create_customer_pause: {
        title: 'Create customer pause',
        description:
          'Create a pause for one customer that suspends reminders, debt-collection transfers or both (scope) from startAt, which must be tomorrow or later (UTC), until endAt; leave endAt out for an indefinite pause. Overlapping pauses of the same scope are rejected. Returns the created pause. Personal data is redacted unless the server runs with INIO_REVEAL_PII=true.',
        inputs: {
          customerId: 'Customer UUID',
          scope: 'What to pause: reminders, dcTransfers (debt-collection transfers) or both',
          startAt: 'First day of the pause, YYYY-MM-DD, tomorrow or later (UTC)',
          endAt: 'Last day of the pause, YYYY-MM-DD, after startAt; omit for an indefinite pause',
          reason: 'Why the pause is created, 1-255 characters',
        },
      },
      update_customer_pause: {
        title: 'Update customer pause',
        description:
          'Change a customer pause: scheduled pauses can change startAt, endAt and scope; active pauses can change only endAt (null makes it indefinite). Completed or cancelled pauses cannot be changed. Changes that overlap another pause of the same scope are rejected. Returns the updated pause. Personal data is redacted unless the server runs with INIO_REVEAL_PII=true.',
        inputs: {
          customerId: 'Customer UUID',
          pauseId: 'Pause UUID',
          startAt: 'New first day, YYYY-MM-DD (scheduled pauses only)',
          endAt: 'New last day, YYYY-MM-DD, or null for an indefinite pause',
          scope: 'New scope: reminders, dcTransfers or both (scheduled pauses only)',
          reason: 'Why the pause is changed, 1-255 characters',
        },
      },
      cancel_customer_pause: {
        title: 'Cancel customer pause',
        description:
          'Cancel a scheduled or active customer pause. This cannot be undone with these tools; create a new pause instead. Returns the cancelled pause. Personal data is redacted unless the server runs with INIO_REVEAL_PII=true.',
        inputs: {
          customerId: 'Customer UUID',
          pauseId: 'Pause UUID',
          reason: 'Why the pause is cancelled, 1-255 characters',
        },
      },
      update_invoice_due_date: {
        title: 'Postpone invoice due date',
        description:
          'Postpone an invoice due date, by UUID (id) or invoice number (number); pass exactly one. The new date must be later than the current due date and after today, so this cannot be undone with these tools. Rejected for closed, cancelled or paid invoices, invoices in debt collection, invoices that have already escalated, invoices whose first or second reminder waiting period has passed, or with an outstanding fee. Triggers the client webhook invoiceDueDatePostponed. Returns whether it was updated, plus the invoice number, due date, stage and status read back after the change. Personal data is redacted unless the server runs with INIO_REVEAL_PII=true.',
        inputs: {
          id: 'Invoice UUID',
          number: 'Business invoice number, e.g. INV-1001',
          dueDate: 'New due date, YYYY-MM-DD, later than the current due date',
          reason: 'Why the due date is postponed, 1-100 characters',
        },
      },
      update_invoice_stop_until_dates: {
        title: 'Update invoice stop-until dates',
        description:
          'Set or clear (null) the dates until which reminders (invoicing1-4) and debt-collection steps (collection1-5) are held back for an invoice, by UUID (id) or invoice number (number); pass exactly one. Needs the stop-until feature enabled for the tenant. Dates must be in the future and on or after the due date; steps that have already passed are ignored. The invoice must be open or paused, unpaid and not in debt collection. Returns whether it was updated, plus the invoice number and stop-until dates read back after the change. Personal data is redacted unless the server runs with INIO_REVEAL_PII=true.',
        inputs: {
          id: 'Invoice UUID',
          number: 'Business invoice number, e.g. INV-1001',
          reason: 'Why escalation is held back, 1-255 characters',
          ...stopInputs,
        },
      },
    });
  });

  it('keeps every read tool read-only when writes are enabled', async () => {
    const { client } = await connect({ ...CONFIG, allowWrites: true });
    const { tools } = await client.listTools();
    for (const tool of tools.filter((t) => TOOLS.includes(t.name))) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
  });
});

describe('createServer request timeout wiring', () => {
  /** Rejects with a TimeoutError, but only when a real AbortSignal was passed. */
  function timingOutFetch(hangOn: (url: string) => boolean) {
    return vi.fn<typeof globalThis.fetch>((input, init) => {
      const url = urlOf(input);
      if (url === AUTH_URL && !hangOn(url)) {
        return Promise.resolve(json({ access_token: TOKEN, expires_in: 300 }));
      }
      if (!(init?.signal instanceof AbortSignal)) {
        return Promise.reject(new Error('no signal passed'));
      }
      return Promise.reject(new DOMException('timeout', 'TimeoutError'));
    });
  }

  async function callInvoice(config: Config, fetch: typeof globalThis.fetch) {
    const server = createServer(config, { fetch, logger: fakeLogger() });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    mcpClient = client;
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name: 'get_invoice', arguments: { id: ID } });
    const content = z.array(z.object({ text: z.string() })).parse(result.content);
    return { isError: result.isError === true, text: content[0]?.text };
  }

  it('uses config.requestTimeoutMs for API requests', async () => {
    const fetch = timingOutFetch((url) => url !== AUTH_URL);
    const result = await callInvoice({ ...CONFIG, requestTimeoutMs: 1500 }, fetch);
    expect(result).toEqual({
      isError: true,
      text: 'TIMEOUT: The Inio API did not respond within 2 s.',
    });
  });

  it('uses config.requestTimeoutMs for token requests', async () => {
    const fetch = timingOutFetch((url) => url === AUTH_URL);
    const result = await callInvoice({ ...CONFIG, requestTimeoutMs: 90000 }, fetch);
    expect(result).toEqual({
      isError: true,
      text: 'The Inio auth server did not respond within 90 s (INIO_AUTH_URL).',
    });
  });
});

const SPAWN_TIMEOUT = 15_000;

describe('stdio entry point (spawned process)', () => {
  it(
    'serves the read tools over stdio and logs a JSON startup line to stderr',
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
      expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);

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
    'exits 1 with the not-supported message and nothing on stdout for MCP_TRANSPORT=http',
    () => {
      const res = spawnSync(process.execPath, ['src/index.ts'], {
        cwd: ROOT,
        env: {
          PATH: process.env.PATH ?? '',
          INIO_CLIENT_ID: 'x',
          INIO_CLIENT_SECRET: SECRET,
          INIO_AUTH_URL: 'https://auth.example/realms/r',
          INIO_URL: 'https://api.example/v1',
          MCP_TRANSPORT: 'http',
        },
        encoding: 'utf8',
        timeout: SPAWN_TIMEOUT,
        input: '',
      });
      expect(res.status).toBe(1);
      expect(res.stderr).toContain(
        'MCP_TRANSPORT=http is not supported yet; only stdio is available.',
      );
      expect(res.stderr).not.toContain(SECRET);
      expect(res.stdout).toBe('');
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
