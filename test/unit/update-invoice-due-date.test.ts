import { afterEach, describe, expect, it } from 'vitest';
import { registerUpdateInvoiceDueDate } from '../../src/tools/update-invoice-due-date.ts';
import { InioApiError } from '../../src/inio-client.ts';
import {
  BAD_DATES,
  GOOD_DATES,
  makeHarness,
  textOf,
  WRITE_ANNOTATIONS,
} from './helpers/write-tool.ts';

const ID = '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b';
const INVOICE = {
  id: ID,
  invoiceNo: 'INV-1001',
  dueDate: '2026-12-15',
  stage: 'Invoiced',
  status: 'open',
  IBAN: 'SE0000000000000000000',
  distributionEmailAddress: 'billing@customer.example',
  totalAmount: '100.00',
};

const { setup, close } = makeHarness(registerUpdateInvoiceDueDate, 'update_invoice_due_date');
afterEach(close);

const impl = () => ({
  post: () => Promise.resolve('Success'),
  get: () => Promise.resolve(INVOICE),
});

describe('update_invoice_due_date registration', () => {
  it('lists the tool with title Postpone invoice due date', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['update_invoice_due_date']);
    expect(tools[0]?.title).toBe('Postpone invoice due date');
  });

  it('is annotated as a non-read-only, destructive, non-idempotent, open-world tool', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    expect(tools[0]?.annotations).toMatchObject(WRITE_ANNOTATIONS);
  });

  it('says it cannot be undone and the date must be later than the current due date', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    const description = tools[0]?.description ?? '';
    expect(description).toContain('cannot be undone');
    expect(description).toContain('later than the current due date');
  });

  it('advertises a strict schema with id, number, dueDate and reason (1-100)', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    const schema = tools[0]?.inputSchema;
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([
      'dueDate',
      'id',
      'number',
      'reason',
    ]);
    expect([...(schema?.required ?? [])].sort()).toEqual(['dueDate', 'reason']);
    expect(schema).toMatchObject({
      additionalProperties: false,
      properties: {
        id: { type: 'string', format: 'uuid' },
        number: { type: 'string', minLength: 1, maxLength: 100 },
        reason: { type: 'string', minLength: 1, maxLength: 100 },
      },
    });
  });
});

describe('update_invoice_due_date request', () => {
  it('posts to /invoices/<id>/update-due-date, then reads the invoice back by id', async () => {
    const { inio, call } = await setup(impl());
    await call({ id: ID, dueDate: '2026-12-15', reason: 'Customer request' });
    expect(inio.post).toHaveBeenCalledTimes(1);
    expect(inio.post).toHaveBeenCalledWith(`/invoices/${ID}/update-due-date`, {
      dueDate: '2026-12-15',
      updateReason: 'Customer request',
    });
    expect(inio.get).toHaveBeenCalledTimes(1);
    expect(inio.get).toHaveBeenCalledWith(`/invoices/${ID}`);
  });

  it('posts to the encoded by-number path, then reads back by number', async () => {
    const { inio, call } = await setup(impl());
    await call({ number: 'INV 1/2', dueDate: '2026-12-15', reason: 'r' });
    expect(inio.post).toHaveBeenCalledWith('/invoices/by-number/INV%201%2F2/update-due-date', {
      dueDate: '2026-12-15',
      updateReason: 'r',
    });
    expect(inio.get).toHaveBeenCalledWith('/invoices/by-number/INV%201%2F2');
  });

  it('writes before it reads back', async () => {
    const order: string[] = [];
    const { call } = await setup({
      post: () => {
        order.push('post');
        return Promise.resolve('Success');
      },
      get: () => {
        order.push('get');
        return Promise.resolve(INVOICE);
      },
    });
    await call({ id: ID, dueDate: '2026-12-15', reason: 'r' });
    expect(order).toEqual(['post', 'get']);
  });

  it.each(GOOD_DATES)('accepts the dueDate %s', async (dueDate) => {
    const { call } = await setup(impl());
    expect((await call({ id: ID, dueDate, reason: 'r' })).isError).not.toBe(true);
  });

  it('accepts reasons of exactly 1 and 100 characters', async () => {
    const { call } = await setup(impl());
    expect((await call({ id: ID, dueDate: '2026-12-15', reason: 'x' })).isError).not.toBe(true);
    expect(
      (await call({ id: ID, dueDate: '2026-12-15', reason: 'x'.repeat(100) })).isError,
    ).not.toBe(true);
  });

  it('accepts a number of exactly 100 characters', async () => {
    const { call } = await setup(impl());
    const result = await call({ number: 'x'.repeat(100), dueDate: '2026-12-15', reason: 'r' });
    expect(result.isError).not.toBe(true);
  });
});

describe('update_invoice_due_date input validation', () => {
  const ok = { id: ID, dueDate: '2026-12-15', reason: 'r' };
  it.each([
    [
      'neither id nor number',
      { dueDate: '2026-12-15', reason: 'r' },
      'Provide exactly one of id or number.',
    ],
    ['both id and number', { ...ok, number: 'INV-1' }, 'Provide exactly one of id or number.'],
    ['a non-uuid id', { ...ok, id: 'inv-1' }, 'id'],
    ['an empty number', { number: '', dueDate: '2026-12-15', reason: 'r' }, 'number'],
    [
      'a number over 100 characters',
      { number: 'x'.repeat(101), dueDate: '2026-12-15', reason: 'r' },
      'number',
    ],
    [
      'a number with CR/LF',
      { number: 'INV-1\r\nX: 1', dueDate: '2026-12-15', reason: 'r' },
      'number',
    ],
    ['a number with a NUL', { number: 'INV\u00001', dueDate: '2026-12-15', reason: 'r' }, 'number'],
    ['a number with a tab', { number: 'INV\t1', dueDate: '2026-12-15', reason: 'r' }, 'number'],
    ['a missing dueDate', { id: ID, reason: 'r' }, 'dueDate'],
    ['a missing reason', { id: ID, dueDate: '2026-12-15' }, 'reason'],
    ['an empty reason', { ...ok, reason: '' }, 'reason'],
    ['a reason over 100 characters', { ...ok, reason: 'x'.repeat(101) }, 'reason'],
    ['an unknown key', { ...ok, foo: 1 }, 'Unrecognized key: "foo"'],
    ['a null dueDate', { ...ok, dueDate: null }, 'dueDate'],
  ])('rejects %s without calling the API', async (_label, args, fragment) => {
    const { inio, call } = await setup(impl());
    const result = await call(args);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Input validation error: /);
    expect(textOf(result)).toContain(fragment);
    expect(inio.post).not.toHaveBeenCalled();
    expect(inio.get).not.toHaveBeenCalled();
  });

  it.each(BAD_DATES)('rejects the dueDate %j', async (dueDate) => {
    const { inio, call } = await setup(impl());
    const result = await call({ ...ok, dueDate });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('dueDate');
    expect(inio.post).not.toHaveBeenCalled();
  });

  it.each(['..', '.'])('rejects the number %j as an invalid path segment', async (number) => {
    const { inio, call } = await setup(impl());
    const result = await call({ number, dueDate: '2026-12-15', reason: 'r' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Invalid path segment');
    expect(inio.post).not.toHaveBeenCalled();
  });
});

describe('update_invoice_due_date output', () => {
  const REQUEST = { id: ID, dueDate: '2026-12-15', reason: 'r' };

  it('reports success with the requested date and the read-back invoice fields', async () => {
    const { call } = await setup(impl());
    const result = await call(REQUEST);
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toBe(
      JSON.stringify({
        updated: true,
        invoice: ID,
        requestedDueDate: '2026-12-15',
        invoiceNo: 'INV-1001',
        dueDate: '2026-12-15',
        stage: 'Invoiced',
        status: 'open',
      }),
    );
  });

  it('names the invoice by the number it was given', async () => {
    const { call } = await setup(impl());
    const result = await call({ number: 'INV-1001', dueDate: '2026-12-15', reason: 'r' });
    expect(JSON.parse(textOf(result))).toMatchObject({ updated: true, invoice: 'INV-1001' });
  });

  it('shows the due date from the read-back next to the requested one', async () => {
    const { call } = await setup({
      post: () => Promise.resolve('Success'),
      get: () => Promise.resolve({ ...INVOICE, dueDate: '2027-01-02' }),
    });
    expect(JSON.parse(textOf(await call(REQUEST)))).toMatchObject({
      requestedDueDate: '2026-12-15',
      dueDate: '2027-01-02',
    });
  });

  it('drops empty read-back fields', async () => {
    const { call } = await setup({
      post: () => Promise.resolve('Success'),
      get: () => Promise.resolve({ ...INVOICE, stage: null }),
    });
    const parsed: unknown = JSON.parse(textOf(await call(REQUEST)));
    expect(parsed).toStrictEqual({
      updated: true,
      invoice: ID,
      requestedDueDate: '2026-12-15',
      invoiceNo: 'INV-1001',
      dueDate: '2026-12-15',
      status: 'open',
    });
  });

  it('never includes other invoice fields or PII', async () => {
    const { call } = await setup(impl());
    const text = textOf(await call(REQUEST));
    for (const leak of ['IBAN', 'customer.example', 'totalAmount'])
      expect(text).not.toContain(leak);
  });

  it.each([
    [
      'a NOT_FOUND error',
      () => Promise.reject(new InioApiError(404, 'NOT_FOUND', 'Gone', 'c-7')),
      'NOT_FOUND: Gone (correlationId c-7)',
    ],
    [
      'a timeout',
      () =>
        Promise.reject(new InioApiError(0, 'TIMEOUT', 'The Inio API did not respond within 30 s.')),
      'TIMEOUT: The Inio API did not respond within 30 s.',
    ],
    [
      'a network error',
      () =>
        Promise.reject(
          new InioApiError(0, 'NETWORK_ERROR', 'Cannot reach the Inio API (INIO_URL).'),
        ),
      'NETWORK_ERROR: Cannot reach the Inio API (INIO_URL).',
    ],
    [
      'a rate limit',
      () =>
        Promise.reject(
          new InioApiError(
            429,
            'RATE_LIMITED',
            'The Inio API rate limit was reached. Try again in 3 s.',
          ),
        ),
      'RATE_LIMITED: The Inio API rate limit was reached. Try again in 3 s.',
    ],
    [
      'an empty object',
      () => Promise.resolve({}),
      'UPSTREAM_ERROR: Unexpected invoice payload from the Inio API.',
    ],
    [
      'null',
      () => Promise.resolve(null),
      'UPSTREAM_ERROR: Unexpected invoice payload from the Inio API.',
    ],
    [
      'an array',
      () => Promise.resolve([INVOICE]),
      'UPSTREAM_ERROR: Unexpected invoice payload from the Inio API.',
    ],
  ])('still reports success when the read-back fails with %s', async (_label, get, text) => {
    const { call } = await setup({ post: () => Promise.resolve('Success'), get });
    const result = await call(REQUEST);
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toStrictEqual({
      updated: true,
      invoice: ID,
      requestedDueDate: '2026-12-15',
      readBack: `Could not read the invoice back: ${text}`,
    });
  });
});

describe('update_invoice_due_date errors', () => {
  it('returns a business-rule rejection as the API error text and does not read back', async () => {
    const { inio, call } = await setup({
      post: () =>
        Promise.reject(
          new InioApiError(400, 'BAD_REQUEST', 'Invoice is in debt collection', 'c-4'),
        ),
      get: () => Promise.resolve(INVOICE),
    });
    const result = await call({ id: ID, dueDate: '2026-12-15', reason: 'r' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('BAD_REQUEST: Invoice is in debt collection (correlationId c-4)');
    expect(inio.get).not.toHaveBeenCalled();
  });

  it('returns field errors', async () => {
    const { call } = await setup({
      post: () =>
        Promise.reject(
          new InioApiError(400, 'VALIDATION_ERROR', 'Bad input', 'c-5', [
            { fieldName: 'dueDate', message: 'Must be later than the current due date' },
          ]),
        ),
    });
    expect(textOf(await call({ id: ID, dueDate: '2026-12-15', reason: 'r' }))).toBe(
      'VALIDATION_ERROR: Bad input (correlationId c-5) Fields: dueDate: Must be later than the current due date',
    );
  });

  it('returns the uncertain-outcome timeout text as an error and does not read back', async () => {
    const message =
      'The Inio API did not respond within 30 s. The change may or may not have been applied; check before retrying.';
    const { inio, call } = await setup({
      post: () => Promise.reject(new InioApiError(0, 'TIMEOUT', message)),
    });
    const result = await call({ id: ID, dueDate: '2026-12-15', reason: 'r' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(`TIMEOUT: ${message}`);
    expect(inio.get).not.toHaveBeenCalled();
  });
});

describe('update_invoice_due_date tool-call logging', () => {
  it('logs one tool call line with outcome ok', async () => {
    const { call, logger } = await setup(impl());
    const bytes = Buffer.byteLength(
      textOf(await call({ id: ID, dueDate: '2026-12-15', reason: 'secret-reason' })),
      'utf8',
    );
    expect(logger.info.mock.calls).toEqual([
      [
        {
          tool: 'update_invoice_due_date',
          durationMs: expect.any(Number),
          outcome: 'ok',
          responseBytes: bytes,
          approxTokens: Math.ceil(bytes / 4),
        },
        'tool call',
      ],
    ]);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('secret-reason');
  });
});
