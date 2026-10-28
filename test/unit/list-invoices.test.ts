import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { registerListInvoices } from '../../src/tools/list-invoices.ts';
import { InioApiError, type InioClient } from '../../src/inio-client.ts';

const IID = '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b';
const CID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const SUMMARY = {
  id: IID,
  invoiceNo: 'INV-1',
  customerNo: 'C-1',
  invoiceDate: '2026-01-02',
  dueDate: '2026-02-01',
  currency: 'SEK',
  totalAmount: 1250.5,
  remainingAmount: 0,
  status: 'open',
  stage: 'reminder',
  paymentStatus: 'notPaid',
};

/** A full API invoice: the summary fields plus detail and PII the tool must drop. */
const API_INVOICE = {
  ...SUMMARY,
  customerId: CID,
  IBAN: 'SE1234567890',
  email: 'ap@acme.example',
  invoiceEmail: 'billing@acme.example',
  addressLine1: '1 Main St',
  zipCode: '11122',
  mobilePhoneNo: '+46701234567',
  digitalInvoiceURL: 'https://pay.example/secret-link',
  histories: [{ note: 'histnote' }],
  invoiceItems: [{ description: 'itemdesc' }],
  workflowsSettings: { flag: 'wfsetting' },
};

function listPayload(data: unknown[], total = data.length, limit = 25, offset = 0) {
  return { data, total, limit, offset };
}

type Get = InioClient['get'];

let mcpClient: Client | undefined;

afterEach(async () => {
  await mcpClient?.close();
  mcpClient = undefined;
});

async function setup(get: Get, revealPii = false) {
  const inio = { get: vi.fn<Get>(get) };
  const logger = { info: vi.fn<(obj: object, msg?: string) => void>() };
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerListInvoices(server, { client: inio, revealPii, logger });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  mcpClient = client;
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const call = (args: Record<string, unknown>) =>
    client.callTool({ name: 'list_invoices', arguments: args });
  return { inio, call, client, logger };
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  expect(content).toHaveLength(1);
  expect(content[0]?.type).toBe('text');
  return content[0]?.text ?? '';
}

const okList = () => Promise.resolve(listPayload([API_INVOICE]));

describe('list_invoices registration', () => {
  it('lists the tool as list_invoices', async () => {
    const { client } = await setup(okList);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['list_invoices']);
  });

  it('titles the tool List invoices', async () => {
    const { client } = await setup(okList);
    const { tools } = await client.listTools();
    expect(tools[0]?.title).toBe('List invoices');
  });

  it('marks the tool read-only and open-world', async () => {
    const { client } = await setup(okList);
    const { tools } = await client.listTools();
    expect(tools[0]?.annotations?.readOnlyHint).toBe(true);
    expect(tools[0]?.annotations?.openWorldHint).toBe(true);
  });

  it('describes summaries and points to get_invoice for details', async () => {
    const { client } = await setup(okList);
    const { tools } = await client.listTools();
    const description = tools[0]?.description ?? '';
    expect(description).toMatch(/summar/i);
    expect(description).toContain('get_invoice');
  });

  it('advertises a strict input schema with the filter, sort and paging keys', async () => {
    const { client } = await setup(okList);
    const { tools } = await client.listTools();
    const schema = tools[0]?.inputSchema;
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([
      'customerId',
      'customerNo',
      'invoiceNo',
      'limit',
      'offset',
      'order',
      'paymentStatus',
      'sort',
      'status',
    ]);
    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        invoiceNo: { type: 'string', minLength: 1, maxLength: 100 },
        customerId: { type: 'string', format: 'uuid' },
        customerNo: { type: 'string', minLength: 1, maxLength: 50 },
        status: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          items: { enum: ['open', 'paused', 'cancelled', 'closed'] },
        },
        paymentStatus: {
          type: 'array',
          minItems: 1,
          maxItems: 5,
          items: { enum: ['notPaid', 'paid', 'overPaid', 'partiallyPaid', 'capitalPaid'] },
        },
        sort: {
          enum: [
            'invoiceNo',
            'invoiceDate',
            'dueDate',
            'totalAmount',
            'remainingAmount',
            'createdAt',
            'updatedAt',
          ],
        },
        order: { enum: ['asc', 'desc'] },
        limit: { default: 25 },
        offset: { default: 0 },
      },
    });
  });
});

describe('list_invoices query', () => {
  it('sends only limit and offset defaults when no filters are given', async () => {
    const { inio, call } = await setup(okList);
    await call({});
    expect(inio.get).toHaveBeenCalledTimes(1);
    expect(inio.get).toHaveBeenCalledWith('/invoices', { query: { limit: 25, offset: 0 } });
  });

  it('sends the given limit and offset', async () => {
    const { inio, call } = await setup(okList);
    await call({ limit: 5, offset: 10 });
    expect(inio.get).toHaveBeenCalledWith('/invoices', { query: { limit: 5, offset: 10 } });
  });

  it('sends invoiceNo when given', async () => {
    const { inio, call } = await setup(okList);
    await call({ invoiceNo: 'INV-1' });
    expect(inio.get).toHaveBeenCalledWith('/invoices', {
      query: { limit: 25, offset: 0, invoiceNo: 'INV-1' },
    });
  });

  it('sends customerId when given', async () => {
    const { inio, call } = await setup(okList);
    await call({ customerId: CID });
    expect(inio.get).toHaveBeenCalledWith('/invoices', {
      query: { limit: 25, offset: 0, customerId: CID },
    });
  });

  it('sends customerNo when given', async () => {
    const { inio, call } = await setup(okList);
    await call({ customerNo: 'C-1' });
    expect(inio.get).toHaveBeenCalledWith('/invoices', {
      query: { limit: 25, offset: 0, customerNo: 'C-1' },
    });
  });

  it('sends several status values as given', async () => {
    const { inio, call } = await setup(okList);
    await call({ status: ['cancelled', 'closed'] });
    expect(inio.get).toHaveBeenCalledWith('/invoices', {
      query: { limit: 25, offset: 0, status: ['cancelled', 'closed'] },
    });
  });

  it('sends a single status value twice to avoid the upstream 500', async () => {
    const { inio, call } = await setup(okList);
    await call({ status: ['open'] });
    expect(inio.get).toHaveBeenCalledWith('/invoices', {
      query: { limit: 25, offset: 0, status: ['open', 'open'] },
    });
  });

  it('sends a single paymentStatus value once', async () => {
    const { inio, call } = await setup(okList);
    await call({ paymentStatus: ['paid'] });
    expect(inio.get).toHaveBeenCalledWith('/invoices', {
      query: { limit: 25, offset: 0, paymentStatus: ['paid'] },
    });
  });

  it('sends several paymentStatus values as given', async () => {
    const { inio, call } = await setup(okList);
    await call({ paymentStatus: ['notPaid', 'partiallyPaid'] });
    expect(inio.get).toHaveBeenCalledWith('/invoices', {
      query: { limit: 25, offset: 0, paymentStatus: ['notPaid', 'partiallyPaid'] },
    });
  });

  it('sends order asc by default when sort is given', async () => {
    const { inio, call } = await setup(okList);
    await call({ sort: 'dueDate' });
    expect(inio.get).toHaveBeenCalledWith('/invoices', {
      query: { limit: 25, offset: 0, sort: 'dueDate', order: 'asc' },
    });
  });

  it('sends the given order with sort', async () => {
    const { inio, call } = await setup(okList);
    await call({ sort: 'totalAmount', order: 'desc' });
    expect(inio.get).toHaveBeenCalledWith('/invoices', {
      query: { limit: 25, offset: 0, sort: 'totalAmount', order: 'desc' },
    });
  });

  it.each([
    'invoiceNo',
    'invoiceDate',
    'dueDate',
    'totalAmount',
    'remainingAmount',
    'createdAt',
    'updatedAt',
  ])('accepts sort %s', async (sort) => {
    const { inio, call } = await setup(okList);
    const result = await call({ sort });
    expect(result.isError).not.toBe(true);
    expect(inio.get).toHaveBeenCalledWith('/invoices', {
      query: { limit: 25, offset: 0, sort, order: 'asc' },
    });
  });

  it.each(['open', 'paused', 'cancelled', 'closed'])('accepts status %s', async (status) => {
    const { call } = await setup(okList);
    expect((await call({ status: [status] })).isError).not.toBe(true);
  });

  it.each(['notPaid', 'paid', 'overPaid', 'partiallyPaid', 'capitalPaid'])(
    'accepts paymentStatus %s',
    async (paymentStatus) => {
      const { call } = await setup(okList);
      expect((await call({ paymentStatus: [paymentStatus] })).isError).not.toBe(true);
    },
  );

  it('accepts all four statuses and all five payment statuses', async () => {
    const { inio, call } = await setup(okList);
    const status = ['open', 'paused', 'cancelled', 'closed'];
    const paymentStatus = ['notPaid', 'paid', 'overPaid', 'partiallyPaid', 'capitalPaid'];
    const result = await call({ status, paymentStatus });
    expect(result.isError).not.toBe(true);
    expect(inio.get).toHaveBeenCalledWith('/invoices', {
      query: { limit: 25, offset: 0, status, paymentStatus },
    });
  });

  it.each([
    ['an ampersand', 'A&B'],
    ['query-like characters', 'INV-1&limit=100?x'],
    ['non-ASCII letters', 'Faktura-æøå+#1'],
    ['exactly 100 characters', 'x'.repeat(100)],
    ['exactly 1 character', '7'],
  ])('accepts an invoiceNo with %s', async (_label, invoiceNo) => {
    const { inio, call } = await setup(okList);
    const result = await call({ invoiceNo });
    expect(result.isError).not.toBe(true);
    expect(inio.get).toHaveBeenCalledWith('/invoices', {
      query: { limit: 25, offset: 0, invoiceNo },
    });
  });

  it.each([
    ['exactly 50 characters', 'x'.repeat(50)],
    ['exactly 1 character', '7'],
  ])('accepts a customerNo with %s', async (_label, customerNo) => {
    const { call } = await setup(okList);
    expect((await call({ customerNo })).isError).not.toBe(true);
  });
});

describe('list_invoices input validation', () => {
  it.each([
    ['order without sort', { order: 'desc' }, 'order requires sort.'],
    [
      'customerId together with customerNo',
      { customerId: CID, customerNo: 'C-1' },
      'Provide at most one of customerId or customerNo.',
    ],
    ['an unknown sort value', { sort: 'IBAN' }, 'sort'],
    ['an unknown order value', { sort: 'dueDate', order: 'up' }, 'order'],
    ['an unknown key', { foo: 1 }, 'Unrecognized key: "foo"'],
    ['a page key', { page: 2 }, 'Unrecognized key: "page"'],
    ['a stage key', { stage: ['x'] }, 'Unrecognized key: "stage"'],
    ['an empty invoiceNo', { invoiceNo: '' }, 'invoiceNo'],
    ['an invoiceNo over 100 characters', { invoiceNo: 'x'.repeat(101) }, 'invoiceNo'],
    ['an invoiceNo with CR/LF', { invoiceNo: 'INV-1\r\nX-Injected: 1' }, 'invoiceNo'],
    ['an invoiceNo with a NUL', { invoiceNo: 'INV\u00001' }, 'invoiceNo'],
    ['an invoiceNo with a tab', { invoiceNo: 'INV\t1' }, 'invoiceNo'],
    ['an invoiceNo with DEL', { invoiceNo: 'INV\u007f1' }, 'invoiceNo'],
    ['an empty customerNo', { customerNo: '' }, 'customerNo'],
    ['a customerNo over 50 characters', { customerNo: 'x'.repeat(51) }, 'customerNo'],
    ['a customerNo with CR/LF', { customerNo: 'C-1\r\nX-Injected: 1' }, 'customerNo'],
    ['a customerNo with a tab', { customerNo: 'C\t1' }, 'customerNo'],
    ['a non-uuid customerId', { customerId: 'c-1' }, 'customerId'],
    ['an empty status array', { status: [] }, 'status'],
    ['five statuses', { status: ['open', 'paused', 'cancelled', 'closed', 'open'] }, 'status'],
    ['an unknown status', { status: ['bogus'] }, 'status'],
    ['a scalar status', { status: 'open' }, 'status'],
    ['an empty paymentStatus array', { paymentStatus: [] }, 'paymentStatus'],
    [
      'six paymentStatus values',
      { paymentStatus: ['paid', 'paid', 'paid', 'paid', 'paid', 'paid'] },
      'paymentStatus',
    ],
    ['an unknown paymentStatus', { paymentStatus: ['bogus'] }, 'paymentStatus'],
    ['limit 0', { limit: 0 }, 'limit'],
    ['limit 101', { limit: 101 }, 'limit'],
    ['a negative offset', { offset: -1 }, 'offset'],
  ])('rejects %s without calling the API', async (_label, args, fragment) => {
    const { inio, call } = await setup(okList);
    const result = await call(args);
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toMatch(/^Input validation error: /);
    expect(text).toContain(fragment);
    expect(inio.get).not.toHaveBeenCalled();
  });
});

describe('list_invoices output', () => {
  it('returns each item reduced to the eleven summary fields, in order, with paging fields', async () => {
    const { call } = await setup(() => Promise.resolve(listPayload([API_INVOICE], 1)));
    const result = await call({});
    expect(result.isError).not.toBe(true);
    // String compare pins the key order as well as the values.
    expect(textOf(result)).toBe(
      JSON.stringify({ items: [SUMMARY], total: 1, limit: 25, offset: 0 }),
    );
  });

  it.each([false, true])(
    'never includes detail or PII fields from the API item (revealPii %s)',
    async (revealPii) => {
      const { call } = await setup(() => Promise.resolve(listPayload([API_INVOICE])), revealPii);
      const text = textOf(await call({}));
      for (const leak of [
        'IBAN',
        'SE1234567890',
        'acme.example',
        '1 Main St',
        'addressLine1',
        '11122',
        'zipCode',
        '+46701234567',
        'mobilePhoneNo',
        'digitalInvoiceURL',
        'secret-link',
        'histories',
        'histnote',
        'invoiceItems',
        'itemdesc',
        'workflowsSettings',
        'wfsetting',
        CID,
      ]) {
        expect(text).not.toContain(leak);
      }
    },
  );

  it('keeps zero amounts and drops empty summary fields', async () => {
    const item = { ...SUMMARY, stage: null, currency: '', dueDate: undefined };
    const { call } = await setup(() => Promise.resolve(listPayload([item])));
    const parsed: unknown = JSON.parse(textOf(await call({})));
    expect(parsed).toStrictEqual({
      items: [
        {
          id: IID,
          invoiceNo: 'INV-1',
          customerNo: 'C-1',
          invoiceDate: '2026-01-02',
          totalAmount: 1250.5,
          remainingAmount: 0,
          status: 'open',
          paymentStatus: 'notPaid',
        },
      ],
      total: 1,
      limit: 25,
      offset: 0,
    });
  });

  it('redacts an email inside a summary field', async () => {
    const item = { ...SUMMARY, customerNo: 'Jane jane@home.example' };
    const { call } = await setup(() => Promise.resolve(listPayload([item])));
    const text = textOf(await call({}));
    expect(text).toContain('"customerNo":"Jane [redacted-email]"');
    expect(text).not.toContain('jane@home.example');
  });

  it('keeps summary fields unredacted when revealPii is true', async () => {
    const item = { ...SUMMARY, customerNo: 'Jane jane@home.example' };
    const { call } = await setup(() => Promise.resolve(listPayload([item])), true);
    expect(textOf(await call({}))).toContain('"customerNo":"Jane jane@home.example"');
  });

  it('returns nextOffset when more invoices remain', async () => {
    const { call } = await setup(() =>
      Promise.resolve(listPayload([API_INVOICE, API_INVOICE], 5, 2, 0)),
    );
    expect(JSON.parse(textOf(await call({ limit: 2 })))).toStrictEqual({
      items: [SUMMARY, SUMMARY],
      total: 5,
      limit: 2,
      offset: 0,
      nextOffset: 2,
    });
  });

  it('omits nextOffset on the last page', async () => {
    const { call } = await setup(() => Promise.resolve(listPayload([API_INVOICE], 3, 2, 2)));
    expect(JSON.parse(textOf(await call({ limit: 2, offset: 2 })))).not.toHaveProperty(
      'nextOffset',
    );
  });

  it('returns an empty items array when there are no invoices', async () => {
    const { call } = await setup(() => Promise.resolve(listPayload([], 0)));
    const result = await call({});
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toBe('{"items":[],"total":0,"limit":25,"offset":0}');
  });

  it('does not return structuredContent', async () => {
    const { call } = await setup(okList);
    expect((await call({})).structuredContent).toBeUndefined();
  });
});

describe('list_invoices errors', () => {
  it.each([
    ['null', null],
    ['an array', [API_INVOICE]],
    ['a payload without data', { total: 1, limit: 25, offset: 0 }],
    ['a payload without total', { data: [API_INVOICE], limit: 25, offset: 0 }],
  ])('rejects %s as an unexpected list payload', async (_label, payload) => {
    const { call } = await setup(() => Promise.resolve(payload));
    const result = await call({});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('UPSTREAM_ERROR: Unexpected list payload from the Inio API.');
  });

  it('formats an InioApiError with its correlation id', async () => {
    const { call } = await setup(() =>
      Promise.reject(new InioApiError(500, 'INTERNAL', 'Boom', 'c-7')),
    );
    const result = await call({});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('INTERNAL: Boom (correlationId c-7)');
  });

  it('formats a network error without a correlation id', async () => {
    const { call } = await setup(() =>
      Promise.reject(new InioApiError(0, 'NETWORK_ERROR', 'Cannot reach the Inio API (INIO_URL).')),
    );
    const result = await call({});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('NETWORK_ERROR: Cannot reach the Inio API (INIO_URL).');
  });
});

describe('list_invoices tool-call logging', () => {
  it('logs one tool call line with tool list_invoices and outcome ok', async () => {
    const { call, logger } = await setup(okList);
    const result = await call({});
    const bytes = Buffer.byteLength(textOf(result), 'utf8');
    expect(logger.info.mock.calls).toEqual([
      [
        {
          tool: 'list_invoices',
          durationMs: expect.any(Number),
          outcome: 'ok',
          responseBytes: bytes,
          approxTokens: Math.ceil(bytes / 4),
        },
        'tool call',
      ],
    ]);
  });

  it('logs outcome error when the API call fails', async () => {
    const { call, logger } = await setup(() =>
      Promise.reject(new InioApiError(404, 'NOT_FOUND', 'nope')),
    );
    await call({});
    expect(logger.info.mock.calls).toEqual([
      [expect.objectContaining({ tool: 'list_invoices', outcome: 'error' }), 'tool call'],
    ]);
  });

  it('does not log invoice content or filter values', async () => {
    const { call, logger } = await setup(okList);
    await call({ invoiceNo: 'INV-1', customerNo: 'C-1' });
    const logged = JSON.stringify(logger.info.mock.calls);
    expect(logged).not.toContain('INV-1');
    expect(logged).not.toContain('C-1');
    expect(logged).not.toContain('SE1234567890');
  });
});
