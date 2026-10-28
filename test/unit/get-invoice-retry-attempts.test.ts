import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { registerGetInvoiceRetryAttempts } from '../../src/tools/get-invoice-retry-attempts.ts';
import { InioApiError, type InioClient } from '../../src/inio-client.ts';

const ID = '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b';

const PAYLOAD = {
  data: [
    { timestamp: '2026-03-02T10:00:00Z', errorMessage: 'Insufficient funds', retryReason: 'nsf' },
    { timestamp: '2026-03-01T10:00:00Z', retryReason: 'scheduled' },
  ],
  totalItems: 2,
  failedPaymentCount: 2,
  successfullAtemptsCount: 1,
  directDebitEligible: true,
};

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
  registerGetInvoiceRetryAttempts(server, { client: inio, revealPii, logger });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  mcpClient = client;
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const call = (args: Record<string, unknown>) =>
    client.callTool({ name: 'get_invoice_retry_attempts', arguments: args });
  return { inio, call, client, logger };
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  expect(content).toHaveLength(1);
  expect(content[0]?.type).toBe('text');
  return content[0]?.text ?? '';
}

const okPayload = () => Promise.resolve(PAYLOAD);

describe('get_invoice_retry_attempts registration', () => {
  it('lists the tool as get_invoice_retry_attempts', async () => {
    const { client } = await setup(okPayload);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['get_invoice_retry_attempts']);
  });

  it('has the title "Get invoice retry attempts"', async () => {
    const { client } = await setup(okPayload);
    const { tools } = await client.listTools();
    expect(tools[0]?.title).toBe('Get invoice retry attempts');
  });

  it('marks the tool read-only and open-world', async () => {
    const { client } = await setup(okPayload);
    const { tools } = await client.listTools();
    expect(tools[0]?.annotations?.readOnlyHint).toBe(true);
    expect(tools[0]?.annotations?.openWorldHint).toBe(true);
  });

  it('advertises a strict schema with id, number and limit (default 10, 1-50)', async () => {
    const { client } = await setup(okPayload);
    const { tools } = await client.listTools();
    const schema = tools[0]?.inputSchema;
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual(['id', 'limit', 'number']);
    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', format: 'uuid' },
        number: { type: 'string', minLength: 1, maxLength: 100 },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
    });
  });
});

describe('get_invoice_retry_attempts routing', () => {
  it('fetches by id with the default limit 10', async () => {
    const { inio, call } = await setup(okPayload);
    await call({ id: ID });
    expect(inio.get).toHaveBeenCalledTimes(1);
    expect(inio.get).toHaveBeenCalledWith(`/invoices/${ID}/retry-attempts`, {
      query: { limit: 10 },
    });
  });

  it('fetches by encoded number with the given limit', async () => {
    const { inio, call } = await setup(okPayload);
    await call({ number: 'INV 1/2', limit: 3 });
    expect(inio.get).toHaveBeenCalledWith('/invoices/by-number/INV%201%2F2/retry-attempts', {
      query: { limit: 3 },
    });
  });

  it.each([1, 50])('accepts limit %s', async (limit) => {
    const { inio, call } = await setup(okPayload);
    const result = await call({ id: ID, limit });
    expect(result.isError).not.toBe(true);
    expect(inio.get).toHaveBeenCalledWith(`/invoices/${ID}/retry-attempts`, { query: { limit } });
  });

  it.each([
    ['a number of exactly 100 characters', 'x'.repeat(100)],
    ['a number of exactly 1 character', '7'],
  ])('accepts %s', async (_label, number) => {
    const { call } = await setup(okPayload);
    expect((await call({ number })).isError).not.toBe(true);
  });
});

describe('get_invoice_retry_attempts input validation', () => {
  it.each([
    ['neither id nor number', {}, 'Provide exactly one of id or number.'],
    ['both id and number', { id: ID, number: 'INV-1' }, 'Provide exactly one of id or number.'],
    ['a non-uuid id', { id: 'inv-1' }, 'id'],
    ['an empty number', { number: '' }, 'number'],
    ['a number over 100 characters', { number: 'x'.repeat(101) }, 'number'],
    ['a number with CR/LF', { number: 'INV-1\r\nX: 1' }, 'number'],
    ['a number with a NUL', { number: 'INV\u00001' }, 'number'],
    ['a number with a tab', { number: 'INV\t1' }, 'number'],
    ['a number with DEL', { number: 'INV\u007f1' }, 'number'],
    ['limit 0', { id: ID, limit: 0 }, 'limit'],
    ['limit 51', { id: ID, limit: 51 }, 'limit'],
    ['a fractional limit', { id: ID, limit: 2.5 }, 'limit'],
    ['a page key', { id: ID, page: 2 }, 'Unrecognized key: "page"'],
    ['an unknown key', { id: ID, foo: 1 }, 'Unrecognized key: "foo"'],
  ])('rejects %s without calling the API', async (_label, args, fragment) => {
    const { inio, call } = await setup(okPayload);
    const result = await call(args);
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toMatch(/^Input validation error: /);
    expect(text).toContain(fragment);
    expect(inio.get).not.toHaveBeenCalled();
  });
});

describe('get_invoice_retry_attempts output', () => {
  it('maps the API payload, renames the misspelled count and drops totalItems', async () => {
    const { call } = await setup(okPayload);
    const result = await call({ id: ID });
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toBe(
      JSON.stringify({
        attempts: PAYLOAD.data,
        failedPaymentCount: 2,
        successfulAttemptsCount: 1,
        directDebitEligible: true,
      }),
    );
    expect(textOf(result)).not.toContain('totalItems');
    expect(textOf(result)).not.toContain('successfullAtemptsCount');
  });

  it('keeps an empty attempts list and zero or false values for an ineligible invoice', async () => {
    const { call } = await setup(() =>
      Promise.resolve({
        data: [],
        totalItems: 0,
        failedPaymentCount: 0,
        successfullAtemptsCount: 0,
        directDebitEligible: false,
      }),
    );
    expect(textOf(await call({ id: ID }))).toBe(
      '{"attempts":[],"failedPaymentCount":0,"successfulAttemptsCount":0,"directDebitEligible":false}',
    );
  });

  it('redacts an email inside an errorMessage', async () => {
    const data = [{ timestamp: 't', errorMessage: 'bounced jane@home.example', retryReason: 'r' }];
    const { call } = await setup(() => Promise.resolve({ ...PAYLOAD, data }));
    const text = textOf(await call({ id: ID }));
    expect(text).toContain('bounced [redacted-email]');
    expect(text).not.toContain('jane@home.example');
  });

  it('keeps the errorMessage email when revealPii is true', async () => {
    const data = [{ timestamp: 't', errorMessage: 'bounced jane@home.example', retryReason: 'r' }];
    const { call } = await setup(() => Promise.resolve({ ...PAYLOAD, data }), true);
    expect(textOf(await call({ id: ID }))).toContain('bounced jane@home.example');
  });

  it('drops empty attempt fields', async () => {
    const data = [{ timestamp: 't', errorMessage: '', retryReason: null }];
    const { call } = await setup(() => Promise.resolve({ ...PAYLOAD, data }));
    expect(JSON.parse(textOf(await call({ id: ID }))).attempts).toStrictEqual([{ timestamp: 't' }]);
  });

  it('does not return structuredContent', async () => {
    const { call } = await setup(okPayload);
    expect((await call({ id: ID })).structuredContent).toBeUndefined();
  });
});

describe('get_invoice_retry_attempts errors', () => {
  it.each([
    ['null', null],
    ['an array', [PAYLOAD]],
    ['a payload without data', { ...PAYLOAD, data: undefined }],
    ['a payload with non-array data', { ...PAYLOAD, data: {} }],
  ])('rejects %s as an unexpected retry attempts payload', async (_label, payload) => {
    const { call } = await setup(() => Promise.resolve(payload));
    const result = await call({ id: ID });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'UPSTREAM_ERROR: Unexpected retry attempts payload from the Inio API.',
    );
  });

  it('formats an InioApiError with its correlation id', async () => {
    const { call } = await setup(() =>
      Promise.reject(new InioApiError(404, 'NOT_FOUND', 'No such invoice', 'c-7')),
    );
    const result = await call({ id: ID });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('NOT_FOUND: No such invoice (correlationId c-7)');
  });
});

describe('get_invoice_retry_attempts tool-call logging', () => {
  it('logs one tool call line with outcome ok', async () => {
    const { call, logger } = await setup(okPayload);
    const bytes = Buffer.byteLength(textOf(await call({ id: ID })), 'utf8');
    expect(logger.info.mock.calls).toEqual([
      [
        {
          tool: 'get_invoice_retry_attempts',
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
      Promise.reject(new InioApiError(500, 'INTERNAL', 'Boom')),
    );
    await call({ id: ID });
    expect(logger.info.mock.calls).toEqual([
      [
        expect.objectContaining({ tool: 'get_invoice_retry_attempts', outcome: 'error' }),
        'tool call',
      ],
    ]);
  });

  it('does not log error messages or invoice numbers', async () => {
    const { call, logger } = await setup(okPayload);
    await call({ number: 'INV-SECRET' });
    const logged = JSON.stringify(logger.info.mock.calls);
    expect(logged).not.toContain('INV-SECRET');
    expect(logged).not.toContain('Insufficient funds');
  });
});
