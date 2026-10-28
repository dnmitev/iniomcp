import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { registerGetCustomer } from '../../src/tools/get-customer.ts';
import { InioApiError, type InioClient } from '../../src/inio-client.ts';

const CID = '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b';
const SLID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const PAYLOAD = {
  externalCustomer: {
    id: CID,
    customerNo: 'C-1',
    customerName: 'Acme AB',
    directDebit: false,
    SSN: '19800101-1234',
    email: 'ap@acme.example',
    addressLine1: '1 Main St',
    zipCode: '11122',
    city: 'Stockholm',
    notes: null,
    tags: [],
    contact: { name: 'Jane', phone: '' },
  },
  serviceLine: { id: SLID, name: 'Standard', description: '' },
  effectivePause: { reason: 'Dispute', until: '2026-12-01', comment: null },
  internalOnly: 'drop-me',
};

const CUSTOMER_REDACTED = {
  id: CID,
  customerNo: 'C-1',
  customerName: 'Acme AB',
  directDebit: false,
  SSN: '[redacted]',
  email: '[redacted]',
  addressLine1: '[redacted]',
  zipCode: '[redacted]',
  city: 'Stockholm',
  contact: { name: 'Jane' },
};

const SERVICE_LINE = { id: SLID, name: 'Standard' };
const PAUSE = { reason: 'Dispute', until: '2026-12-01' };

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
  registerGetCustomer(server, { client: inio, revealPii, logger });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  mcpClient = client;
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const call = (args: Record<string, unknown>) =>
    client.callTool({ name: 'get_customer', arguments: args });
  return { inio, call, client, logger };
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  expect(content).toHaveLength(1);
  expect(content[0]?.type).toBe('text');
  return content[0]?.text ?? '';
}

const okCustomer = () => Promise.resolve(PAYLOAD);

describe('get_customer registration', () => {
  it('lists the tool as get_customer', async () => {
    const { client } = await setup(okCustomer);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['get_customer']);
  });

  it('marks the tool read-only and open-world', async () => {
    const { client } = await setup(okCustomer);
    const { tools } = await client.listTools();
    expect(tools[0]?.annotations?.readOnlyHint).toBe(true);
    expect(tools[0]?.annotations?.openWorldHint).toBe(true);
  });

  it('says personal data is redacted', async () => {
    const { client } = await setup(okCustomer);
    const { tools } = await client.listTools();
    expect(tools[0]?.description ?? '').toMatch(/redacted/i);
  });

  it('advertises a strict input schema with id and number', async () => {
    const { client } = await setup(okCustomer);
    const { tools } = await client.listTools();
    const schema = tools[0]?.inputSchema;
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual(['id', 'number']);
    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', format: 'uuid' },
        number: { type: 'string', minLength: 1, maxLength: 50 },
      },
    });
  });
});

describe('get_customer routing', () => {
  it('fetches by id from /customers/<id>', async () => {
    const { inio, call } = await setup(okCustomer);
    await call({ id: CID });
    expect(inio.get).toHaveBeenCalledTimes(1);
    expect(inio.get).toHaveBeenCalledWith(`/customers/${CID}`);
  });

  it('fetches by number from /customers/by-number/<encoded number>', async () => {
    const { inio, call } = await setup(okCustomer);
    await call({ number: 'C 1/2' });
    expect(inio.get).toHaveBeenCalledTimes(1);
    expect(inio.get).toHaveBeenCalledWith('/customers/by-number/C%201%2F2');
  });

  it.each([
    ['exactly 50 characters', 'x'.repeat(50)],
    ['exactly 1 character', '7'],
    ['dot, dash and underscore', 'C-1.a_b'],
  ])('accepts a number with %s', async (_label, number) => {
    const { inio, call } = await setup(okCustomer);
    const result = await call({ number });
    expect(result.isError).not.toBe(true);
    expect(inio.get).toHaveBeenCalledWith(`/customers/by-number/${number}`);
  });
  it.each([
    ['Kund-æøå+#1', '/customers/by-number/Kund-%C3%A6%C3%B8%C3%A5%2B%231'],
    ['A&B', '/customers/by-number/A%26B'],
    ['C-1?x=1', '/customers/by-number/C-1%3Fx%3D1'],
  ])('accepts the number %j and encodes it as a path segment', async (number, path) => {
    const { inio, call } = await setup(okCustomer);
    const result = await call({ number });
    expect(result.isError).not.toBe(true);
    expect(inio.get).toHaveBeenCalledWith(path);
  });
});

describe('get_customer input validation', () => {
  it.each([
    ['both id and number', { id: CID, number: 'C-1' }, 'Provide exactly one of id or number.'],
    ['neither id nor number', {}, 'Provide exactly one of id or number.'],
    ['a non-uuid id', { id: 'not-a-uuid' }, 'id: Invalid UUID'],
    ['an extra key', { id: CID, extra: 1 }, 'Unrecognized key: "extra"'],
    ['an empty number', { number: '' }, 'number'],
    ['a number over 50 characters', { number: 'x'.repeat(51) }, 'number'],
    ['a number with CR/LF', { number: 'C-1\r\nX' }, 'number'],
    ['a number with a control character', { number: 'C\u00001' }, 'number'],
    ['a number with a lone LF', { number: 'C-1\nX' }, 'number'],
    ['a number with a tab', { number: 'C\t1' }, 'number'],
    ['a number with DEL', { number: 'C\u007f1' }, 'number'],
    ['a non-string number', { number: 42 }, 'number'],
  ])('rejects %s without calling the API', async (_label, args, fragment) => {
    const { inio, call } = await setup(okCustomer);
    const result = await call(args);
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toMatch(/^Input validation error: /);
    expect(text).toContain(fragment);
    expect(inio.get).not.toHaveBeenCalled();
  });

  it.each(['..', '.'])('rejects the number %j as an invalid path segment', async (number) => {
    const { inio, call } = await setup(okCustomer);
    const result = await call({ number });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Invalid path segment');
    expect(inio.get).not.toHaveBeenCalled();
  });
});

describe('get_customer output', () => {
  it('returns { customer, serviceLine, effectivePause } compacted and redacted', async () => {
    const { call } = await setup(okCustomer);
    const result = await call({ id: CID });
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toBe(
      JSON.stringify({
        customer: CUSTOMER_REDACTED,
        serviceLine: SERVICE_LINE,
        effectivePause: PAUSE,
      }),
    );
  });

  it('renames externalCustomer to customer and drops other payload keys', async () => {
    const { call } = await setup(okCustomer);
    const text = textOf(await call({ id: CID }));
    expect(text).not.toContain('externalCustomer');
    expect(text).not.toContain('internalOnly');
    expect(text).not.toContain('drop-me');
  });

  it('drops a null effectivePause and serviceLine', async () => {
    const { call } = await setup(() =>
      Promise.resolve({ ...PAYLOAD, serviceLine: null, effectivePause: null }),
    );
    expect(textOf(await call({ id: CID }))).toBe(JSON.stringify({ customer: CUSTOMER_REDACTED }));
  });

  it('does not show "[redacted]" for a null SSN', async () => {
    const { call } = await setup(() =>
      Promise.resolve({ ...PAYLOAD, externalCustomer: { id: CID, SSN: null } }),
    );
    expect(textOf(await call({ id: CID }))).toBe(
      JSON.stringify({ customer: { id: CID }, serviceLine: SERVICE_LINE, effectivePause: PAUSE }),
    );
  });

  it('never returns raw SSN, email, zip code or address when revealPii is false', async () => {
    const { call } = await setup(okCustomer);
    const text = textOf(await call({ id: CID }));
    for (const leak of ['19800101-1234', 'ap@acme.example', '11122', '1 Main St']) {
      expect(text).not.toContain(leak);
    }
  });

  it('keeps PII when revealPii is true', async () => {
    const { call } = await setup(okCustomer, true);
    const result = await call({ id: CID });
    expect(JSON.parse(textOf(result))).toStrictEqual({
      customer: {
        id: CID,
        customerNo: 'C-1',
        customerName: 'Acme AB',
        directDebit: false,
        SSN: '19800101-1234',
        email: 'ap@acme.example',
        addressLine1: '1 Main St',
        zipCode: '11122',
        city: 'Stockholm',
        contact: { name: 'Jane' },
      },
      serviceLine: SERVICE_LINE,
      effectivePause: PAUSE,
    });
  });

  it('does not return structuredContent', async () => {
    const { call } = await setup(okCustomer);
    expect((await call({ id: CID })).structuredContent).toBeUndefined();
  });
});

describe('get_customer errors', () => {
  it('formats an InioApiError with its correlation id', async () => {
    const { call } = await setup(() =>
      Promise.reject(
        new InioApiError(404, 'NOT_FOUND', 'Customer with number X could not be found', 'c-1'),
      ),
    );
    const result = await call({ number: 'X' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'NOT_FOUND: Customer with number X could not be found (correlationId c-1)',
    );
  });

  it('formats a network error without a correlation id', async () => {
    const { call } = await setup(() =>
      Promise.reject(new InioApiError(0, 'NETWORK_ERROR', 'Cannot reach the Inio API (INIO_URL).')),
    );
    const result = await call({ id: CID });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('NETWORK_ERROR: Cannot reach the Inio API (INIO_URL).');
  });

  it('returns an auth failure message verbatim', async () => {
    const message =
      'Authentication failed (HTTP 401: invalid_client). Check INIO_CLIENT_ID and INIO_CLIENT_SECRET.';
    const { call } = await setup(() => Promise.reject(new Error(message)));
    const result = await call({ id: CID });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(message);
  });

  it.each([
    ['null', null],
    ['a string', 'oops'],
    ['a number', 42],
    ['undefined', undefined],
    ['an array', [PAYLOAD]],
    ['an object without externalCustomer', { serviceLine: SERVICE_LINE }],
    ['a null externalCustomer', { ...PAYLOAD, externalCustomer: null }],
  ])('rejects %s as an unexpected customer payload', async (_label, payload) => {
    const { call } = await setup(() => Promise.resolve(payload));
    const result = await call({ id: CID });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('UPSTREAM_ERROR: Unexpected customer payload from the Inio API.');
  });
});

describe('get_customer tool-call logging', () => {
  it('logs one tool call line with tool get_customer and outcome ok', async () => {
    const { call, logger } = await setup(okCustomer);
    const result = await call({ id: CID });
    const bytes = Buffer.byteLength(textOf(result), 'utf8');
    expect(logger.info.mock.calls).toEqual([
      [
        {
          tool: 'get_customer',
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
    await call({ id: CID });
    expect(logger.info.mock.calls).toEqual([
      [expect.objectContaining({ tool: 'get_customer', outcome: 'error' }), 'tool call'],
    ]);
  });

  it('does not log customer content or PII', async () => {
    const { call, logger } = await setup(okCustomer);
    await call({ id: CID });
    const logged = JSON.stringify(logger.info.mock.calls);
    expect(logged).not.toContain('Acme');
    expect(logged).not.toContain('19800101-1234');
  });
});
