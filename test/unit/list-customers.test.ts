import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { registerListCustomers } from '../../src/tools/list-customers.ts';
import { InioApiError, type InioClient } from '../../src/inio-client.ts';

const CID = '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b';
const SLID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const SUMMARY = {
  id: CID,
  customerNo: 'C-1',
  customerName: 'Acme AB',
  customerType: 'Company',
  serviceLineName: 'Standard',
  directDebit: false,
  orgNr: '556677-8899',
  createdAt: '2026-01-02T03:04:05Z',
};

/** A full API customer: the summary fields plus detail and PII the tool must drop. */
const API_CUSTOMER = {
  ...SUMMARY,
  updatedAt: '2026-02-02T00:00:00Z',
  serviceLineId: SLID,
  SSN: '19800101-1234',
  email: 'ap@acme.example',
  invoiceEmail: 'billing@acme.example',
  phone: '+46701234567',
  addressLine1: '1 Main St',
  zipCode: '11122',
  city: 'Stockholm',
  iban: 'SE1234567890',
  notes: 'call cfo@acme.example',
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
  registerListCustomers(server, { client: inio, revealPii, logger });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  mcpClient = client;
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const call = (args: Record<string, unknown>) =>
    client.callTool({ name: 'list_customers', arguments: args });
  return { inio, call, client, logger };
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  expect(content).toHaveLength(1);
  expect(content[0]?.type).toBe('text');
  return content[0]?.text ?? '';
}

const okList = () => Promise.resolve(listPayload([API_CUSTOMER]));

describe('list_customers registration', () => {
  it('lists the tool as list_customers', async () => {
    const { client } = await setup(okList);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['list_customers']);
  });

  it('marks the tool read-only and open-world', async () => {
    const { client } = await setup(okList);
    const { tools } = await client.listTools();
    expect(tools[0]?.annotations?.readOnlyHint).toBe(true);
    expect(tools[0]?.annotations?.openWorldHint).toBe(true);
  });

  it('describes summaries and points to get_customer for details', async () => {
    const { client } = await setup(okList);
    const { tools } = await client.listTools();
    const description = tools[0]?.description ?? '';
    expect(description).toMatch(/summar/i);
    expect(description).toContain('get_customer');
  });

  it('advertises a strict input schema with the filter, sort and paging keys', async () => {
    const { client } = await setup(okList);
    const { tools } = await client.listTools();
    const schema = tools[0]?.inputSchema;
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([
      'customerNo',
      'directDebit',
      'limit',
      'offset',
      'order',
      'serviceLineId',
      'sort',
    ]);
    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        customerNo: { type: 'string', minLength: 1, maxLength: 50 },
        directDebit: { type: 'boolean' },
        serviceLineId: { type: 'string', format: 'uuid' },
        sort: { enum: ['customerName', 'customerNo', 'createdAt', 'updatedAt'] },
        order: { enum: ['asc', 'desc'] },
        limit: { default: 25 },
        offset: { default: 0 },
      },
    });
  });
});

describe('list_customers query', () => {
  it('sends only limit and offset defaults when no filters are given', async () => {
    const { inio, call } = await setup(okList);
    await call({});
    expect(inio.get).toHaveBeenCalledTimes(1);
    expect(inio.get).toHaveBeenCalledWith('/customers', { query: { limit: 25, offset: 0 } });
  });

  it('sends the given limit and offset', async () => {
    const { inio, call } = await setup(okList);
    await call({ limit: 5, offset: 10 });
    expect(inio.get).toHaveBeenCalledWith('/customers', { query: { limit: 5, offset: 10 } });
  });

  it('sends customerNo, directDebit and serviceLineId when given', async () => {
    const { inio, call } = await setup(okList);
    await call({ customerNo: 'C-1', directDebit: true, serviceLineId: SLID });
    expect(inio.get).toHaveBeenCalledWith('/customers', {
      query: { limit: 25, offset: 0, customerNo: 'C-1', directDebit: true, serviceLineId: SLID },
    });
  });

  it('sends directDebit false as a boolean', async () => {
    const { inio, call } = await setup(okList);
    await call({ directDebit: false });
    expect(inio.get).toHaveBeenCalledWith('/customers', {
      query: { limit: 25, offset: 0, directDebit: false },
    });
  });

  it('sends order asc by default when sort is given', async () => {
    const { inio, call } = await setup(okList);
    await call({ sort: 'customerName' });
    expect(inio.get).toHaveBeenCalledWith('/customers', {
      query: { limit: 25, offset: 0, sort: 'customerName', order: 'asc' },
    });
  });

  it('sends the given order with sort', async () => {
    const { inio, call } = await setup(okList);
    await call({ sort: 'createdAt', order: 'desc' });
    expect(inio.get).toHaveBeenCalledWith('/customers', {
      query: { limit: 25, offset: 0, sort: 'createdAt', order: 'desc' },
    });
  });

  it.each(['customerName', 'customerNo', 'createdAt', 'updatedAt'])(
    'accepts sort %s',
    async (sort) => {
      const { inio, call } = await setup(okList);
      const result = await call({ sort });
      expect(result.isError).not.toBe(true);
      expect(inio.get).toHaveBeenCalledWith('/customers', {
        query: { limit: 25, offset: 0, sort, order: 'asc' },
      });
    },
  );

  it.each([
    ['letters, digits, dot, dash, slash, underscore and space', 'C-1/2 a.b_c'],
    ['non-ASCII letters, plus and hash', 'Kund-æøå+#1'],
    ['an ampersand', 'A&B'],
    ['query-like characters', 'C-1&limit=100?x'],
    ['exactly 50 characters', 'x'.repeat(50)],
    ['exactly 1 character', '7'],
  ])('accepts a customerNo with %s', async (_label, customerNo) => {
    const { inio, call } = await setup(okList);
    const result = await call({ customerNo });
    expect(result.isError).not.toBe(true);
    expect(inio.get).toHaveBeenCalledWith('/customers', {
      query: { limit: 25, offset: 0, customerNo },
    });
  });
});

describe('list_customers input validation', () => {
  it.each([
    ['order without sort', { order: 'desc' }, 'order requires sort.'],
    ['an unknown sort value', { sort: 'SSN' }, 'sort'],
    ['an unknown order value', { sort: 'customerNo', order: 'up' }, 'order'],
    ['an unknown key', { foo: 1 }, 'Unrecognized key: "foo"'],
    ['a page key', { page: 2 }, 'Unrecognized key: "page"'],
    ['an empty customerNo', { customerNo: '' }, 'customerNo'],
    ['a customerNo over 50 characters', { customerNo: 'x'.repeat(51) }, 'customerNo'],
    ['a customerNo with CR/LF', { customerNo: 'C-1\r\nX-Injected: 1' }, 'customerNo'],
    ['a customerNo with a control character', { customerNo: 'C\u00001' }, 'customerNo'],
    ['a customerNo with a lone LF', { customerNo: 'C-1\nX' }, 'customerNo'],
    ['a customerNo with a tab', { customerNo: 'C\t1' }, 'customerNo'],
    ['a customerNo with DEL', { customerNo: 'C\u007f1' }, 'customerNo'],
    ['a non-boolean directDebit', { directDebit: 'true' }, 'directDebit'],
    ['a non-uuid serviceLineId', { serviceLineId: 'sl-1' }, 'serviceLineId'],
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

describe('list_customers output', () => {
  it('returns each item reduced to the eight summary fields, redacted, with paging fields', async () => {
    const { call } = await setup(() => Promise.resolve(listPayload([API_CUSTOMER], 1)));
    const result = await call({});
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toStrictEqual({
      items: [SUMMARY],
      total: 1,
      limit: 25,
      offset: 0,
    });
  });

  it.each([false, true])(
    'never includes detail or PII fields from the API item (revealPii %s)',
    async (revealPii) => {
      const { call } = await setup(() => Promise.resolve(listPayload([API_CUSTOMER])), revealPii);
      const text = textOf(await call({}));
      for (const leak of [
        'SSN',
        '19800101-1234',
        'acme.example',
        '+46701234567',
        '1 Main St',
        '11122',
        'SE1234567890',
        'notes',
        'updatedAt',
        SLID,
      ]) {
        expect(text).not.toContain(leak);
      }
    },
  );

  it('keeps directDebit false and drops empty summary fields', async () => {
    const item = { ...SUMMARY, customerType: null, orgNr: '', serviceLineName: undefined };
    const { call } = await setup(() => Promise.resolve(listPayload([item])));
    const parsed: unknown = JSON.parse(textOf(await call({})));
    expect(parsed).toStrictEqual({
      items: [
        {
          id: CID,
          customerNo: 'C-1',
          customerName: 'Acme AB',
          directDebit: false,
          createdAt: SUMMARY.createdAt,
        },
      ],
      total: 1,
      limit: 25,
      offset: 0,
    });
  });

  it('redacts an email inside a summary field', async () => {
    const item = { ...SUMMARY, customerName: 'Jane jane@home.example' };
    const { call } = await setup(() => Promise.resolve(listPayload([item])));
    const text = textOf(await call({}));
    expect(text).toContain('"customerName":"Jane [redacted-email]"');
    expect(text).not.toContain('jane@home.example');
  });

  it('keeps summary fields unredacted when revealPii is true', async () => {
    const item = { ...SUMMARY, customerName: 'Jane jane@home.example' };
    const { call } = await setup(() => Promise.resolve(listPayload([item])), true);
    expect(textOf(await call({}))).toContain('"customerName":"Jane jane@home.example"');
  });

  it('returns nextOffset when more customers remain', async () => {
    const { call } = await setup(() =>
      Promise.resolve(listPayload([API_CUSTOMER, API_CUSTOMER], 5, 2, 0)),
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
    const { call } = await setup(() => Promise.resolve(listPayload([API_CUSTOMER], 3, 2, 2)));
    expect(JSON.parse(textOf(await call({ limit: 2, offset: 2 })))).not.toHaveProperty(
      'nextOffset',
    );
  });

  it('returns an empty items array when there are no customers', async () => {
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

describe('list_customers errors', () => {
  it.each([
    ['null', null],
    ['an array', [API_CUSTOMER]],
    ['a payload without data', { total: 1, limit: 25, offset: 0 }],
    ['a payload without total', { data: [API_CUSTOMER], limit: 25, offset: 0 }],
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

describe('list_customers tool-call logging', () => {
  it('logs one tool call line with tool list_customers and outcome ok', async () => {
    const { call, logger } = await setup(okList);
    const result = await call({});
    const bytes = Buffer.byteLength(textOf(result), 'utf8');
    expect(logger.info.mock.calls).toEqual([
      [
        {
          tool: 'list_customers',
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
      [expect.objectContaining({ tool: 'list_customers', outcome: 'error' }), 'tool call'],
    ]);
  });

  it('does not log customer content or PII', async () => {
    const { call, logger } = await setup(okList);
    await call({ customerNo: 'C-1' });
    const logged = JSON.stringify(logger.info.mock.calls);
    expect(logged).not.toContain('Acme');
    expect(logged).not.toContain('19800101-1234');
    expect(logged).not.toContain('C-1');
  });
});
