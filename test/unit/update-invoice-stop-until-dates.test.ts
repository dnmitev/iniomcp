import { afterEach, describe, expect, it } from 'vitest';
import { registerUpdateInvoiceStopUntilDates } from '../../src/tools/update-invoice-stop-until-dates.ts';
import { InioApiError } from '../../src/inio-client.ts';
import {
  BAD_DATES,
  GOOD_DATES,
  makeHarness,
  textOf,
  WRITE_ANNOTATIONS,
  expectAcceptedNote,
} from './helpers/write-tool.ts';

const ID = '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b';
const INVOICE = {
  id: ID,
  invoiceNo: 'INV-1001',
  IBAN: 'SE0000000000000000000',
  metadata: {
    vatCurrency: 'SEK',
    invoicing1StopUntilDate: '2026-12-01',
    invoicing2StopUntilDate: null,
    collection1StopUntilDate: '2027-01-10',
    lastEscalationDate: '2026-10-01',
  },
};
const POST_PATH = `/invoices/${ID}/update-stop-until-dates`;
const INVOICING = ['invoicing1', 'invoicing2', 'invoicing3', 'invoicing4'];
const COLLECTION = ['collection1', 'collection2', 'collection3', 'collection4', 'collection5'];

const { setup, close } = makeHarness(
  registerUpdateInvoiceStopUntilDates,
  'update_invoice_stop_until_dates',
);
afterEach(close);

const impl = () => ({
  post: () => Promise.resolve('Success'),
  get: () => Promise.resolve(INVOICE),
});

describe('update_invoice_stop_until_dates registration', () => {
  it('lists the tool with title Update invoice stop-until dates', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['update_invoice_stop_until_dates']);
    expect(tools[0]?.title).toBe('Update invoice stop-until dates');
  });

  it('is annotated as a non-read-only, destructive, non-idempotent, open-world tool', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    expect(tools[0]?.annotations).toMatchObject(WRITE_ANNOTATIONS);
  });

  it('advertises a strict schema with id, number, reason and the nine step dates', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    const schema = tools[0]?.inputSchema;
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual(
      ['id', 'number', 'reason', ...INVOICING, ...COLLECTION].sort(),
    );
    expect([...(schema?.required ?? [])]).toEqual(['reason']);
    expect(schema).toMatchObject({
      additionalProperties: false,
      properties: { reason: { type: 'string', minLength: 1, maxLength: 255 } },
    });
  });
});

describe('update_invoice_stop_until_dates request', () => {
  it('posts only the provided steps in metadata with the reason, then reads back by id', async () => {
    const { inio, call } = await setup(impl());
    await call({ id: ID, reason: 'Dispute', invoicing1: '2026-12-01', collection2: '2027-01-10' });
    expect(inio.post).toHaveBeenCalledTimes(1);
    expect(inio.post).toHaveBeenCalledWith(POST_PATH, {
      metadata: { invoicing1StopUntilDate: '2026-12-01', collection2StopUntilDate: '2027-01-10' },
      escalationStopReason: 'Dispute',
    });
    expect(inio.get).toHaveBeenCalledTimes(1);
    expect(inio.get).toHaveBeenCalledWith(`/invoices/${ID}`);
  });

  it('passes exactly the metadata and reason to post, with no undefined keys', async () => {
    const { inio, call } = await setup(impl());
    await call({ id: ID, reason: 'Dispute', invoicing2: '2026-12-01' });
    expect(inio.post.mock.calls[0]?.[1]).toStrictEqual({
      metadata: { invoicing2StopUntilDate: '2026-12-01' },
      escalationStopReason: 'Dispute',
    });
  });

  it('sends null to clear a step', async () => {
    const { inio, call } = await setup(impl());
    await call({ id: ID, reason: 'Resolved', invoicing3: null });
    expect(inio.post).toHaveBeenCalledWith(POST_PATH, {
      metadata: { invoicing3StopUntilDate: null },
      escalationStopReason: 'Resolved',
    });
  });

  it.each([...INVOICING, ...COLLECTION])('maps %s to <step>StopUntilDate', async (step) => {
    const { inio, call } = await setup(impl());
    await call({ id: ID, reason: 'r', [step]: '2026-12-01' });
    expect(inio.post).toHaveBeenCalledWith(POST_PATH, {
      metadata: { [`${step}StopUntilDate`]: '2026-12-01' },
      escalationStopReason: 'r',
    });
  });

  it('posts to the encoded by-number path and reads back by number', async () => {
    const { inio, call } = await setup(impl());
    await call({ number: 'INV 1/2', reason: 'r', invoicing1: '2026-12-01' });
    expect(inio.post).toHaveBeenCalledWith(
      '/invoices/by-number/INV%201%2F2/update-stop-until-dates',
      { metadata: { invoicing1StopUntilDate: '2026-12-01' }, escalationStopReason: 'r' },
    );
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
    await call({ id: ID, reason: 'r', invoicing1: '2026-12-01' });
    expect(order).toEqual(['post', 'get']);
  });

  it('accepts reasons of exactly 1 and 255 characters', async () => {
    const { call } = await setup(impl());
    expect((await call({ id: ID, reason: 'x', invoicing1: '2026-12-01' })).isError).not.toBe(true);
    expect(
      (await call({ id: ID, reason: 'x'.repeat(255), invoicing1: '2026-12-01' })).isError,
    ).not.toBe(true);
  });

  it.each(GOOD_DATES)('accepts the date %s', async (date) => {
    const { call } = await setup(impl());
    expect((await call({ id: ID, reason: 'r', invoicing1: date })).isError).not.toBe(true);
  });
});

describe('update_invoice_stop_until_dates input validation', () => {
  const ok = { id: ID, reason: 'r', invoicing1: '2026-12-01' };
  it.each([
    [
      'neither id nor number',
      { reason: 'r', invoicing1: '2026-12-01' },
      'Provide exactly one of id or number.',
    ],
    ['both id and number', { ...ok, number: 'INV-1' }, 'Provide exactly one of id or number.'],
    ['no stop-until date', { id: ID, reason: 'r' }, 'Provide at least one stop-until date.'],
    ['a non-uuid id', { ...ok, id: 'inv-1' }, 'id'],
    ['an empty number', { number: '', reason: 'r', invoicing1: '2026-12-01' }, 'number'],
    [
      'a number with CR/LF',
      { number: 'INV-1\r\nX: 1', reason: 'r', invoicing1: '2026-12-01' },
      'number',
    ],
    [
      'a number over 100 characters',
      { number: 'x'.repeat(101), reason: 'r', invoicing1: '2026-12-01' },
      'number',
    ],
    ['a missing reason', { id: ID, invoicing1: '2026-12-01' }, 'reason'],
    ['an empty reason', { ...ok, reason: '' }, 'reason'],
    ['a reason over 255 characters', { ...ok, reason: 'x'.repeat(256) }, 'reason'],
    ['an unknown step', { ...ok, invoicing5: '2026-12-01' }, 'Unrecognized key: "invoicing5"'],
    ['collection6', { ...ok, collection6: '2026-12-01' }, 'Unrecognized key: "collection6"'],
    ['a raw metadata key', { ...ok, invoicing2StopUntilDate: '2026-12-01' }, 'Unrecognized key'],
    ['an unknown key', { ...ok, foo: 1 }, 'Unrecognized key: "foo"'],
  ])('rejects %s without calling the API', async (_label, args, fragment) => {
    const { inio, call } = await setup(impl());
    const result = await call(args);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Input validation error: /);
    expect(textOf(result)).toContain(fragment);
    expect(inio.post).not.toHaveBeenCalled();
    expect(inio.get).not.toHaveBeenCalled();
  });

  it.each(BAD_DATES)('rejects the date %j', async (date) => {
    const { inio, call } = await setup(impl());
    const result = await call({ id: ID, reason: 'r', collection1: date });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('collection1');
    expect(inio.post).not.toHaveBeenCalled();
  });

  it('accepts a request that only clears dates', async () => {
    const { call } = await setup(impl());
    expect((await call({ id: ID, reason: 'r', collection1: null })).isError).not.toBe(true);
  });
});

describe('update_invoice_stop_until_dates output', () => {
  const REQUEST = { id: ID, reason: 'r', invoicing1: '2026-12-01' };

  it('reports success with the invoice number and the stop-until dates read back, nothing else', async () => {
    const { call } = await setup(impl());
    const result = await call(REQUEST);
    expect(result.isError).not.toBe(true);
    const parsed: unknown = JSON.parse(textOf(result));
    expect(parsed).toStrictEqual({
      updated: true,
      invoice: ID,
      invoiceNo: 'INV-1001',
      stopUntilDates: {
        invoicing1StopUntilDate: '2026-12-01',
        collection1StopUntilDate: '2027-01-10',
      },
    });
    const text = textOf(result);
    for (const leak of ['IBAN', 'vatCurrency', 'lastEscalationDate']) {
      expect(text).not.toContain(leak);
    }
  });

  it('names the invoice by the number it was given', async () => {
    const { call } = await setup(impl());
    const result = await call({ number: 'INV-1001', reason: 'r', invoicing1: '2026-12-01' });
    expect(JSON.parse(textOf(result))).toMatchObject({ updated: true, invoice: 'INV-1001' });
  });

  it('omits stopUntilDates when no stop-until date is set after the change', async () => {
    const { call } = await setup({
      post: () => Promise.resolve('Success'),
      get: () => Promise.resolve({ ...INVOICE, metadata: { vatCurrency: 'SEK' } }),
    });
    expect(textOf(await call({ id: ID, reason: 'r', invoicing1: null }))).toBe(
      JSON.stringify({ updated: true, invoice: ID, invoiceNo: 'INV-1001' }),
    );
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
      readBack: `Could not read the invoice back: ${text}`,
    });
  });
});

describe('update_invoice_stop_until_dates errors', () => {
  it('returns a blocked feature as the API error text and does not read back', async () => {
    const { inio, call } = await setup({
      post: () =>
        Promise.reject(
          new InioApiError(403, 'FORBIDDEN', 'Feature MANUAL_STOP_UNTIL_FLAG is off', 'c-1'),
        ),
      get: () => Promise.resolve(INVOICE),
    });
    const result = await call({ id: ID, reason: 'r', invoicing1: '2026-12-01' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'FORBIDDEN: Feature MANUAL_STOP_UNTIL_FLAG is off (correlationId c-1)',
    );
    expect(inio.get).not.toHaveBeenCalled();
  });

  it('reports FEATURE_DISABLED for a 404 without an API error envelope', async () => {
    const { inio, call } = await setup({
      post: () =>
        Promise.reject(
          new InioApiError(
            404,
            'UPSTREAM_ERROR',
            'Unexpected response from the Inio API (HTTP 404).',
          ),
        ),
      get: () => Promise.resolve(INVOICE),
    });
    const result = await call({ id: ID, reason: 'r', invoicing1: '2026-12-01' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'FEATURE_DISABLED: Stop-until dates are not enabled for this tenant.',
    );
    expect(inio.get).not.toHaveBeenCalled();
  });

  it('keeps the normal NOT_FOUND text for a 404 with an API error envelope', async () => {
    const { call } = await setup({
      post: () => Promise.reject(new InioApiError(404, 'NOT_FOUND', 'Invoice not found', 'c-1')),
    });
    const result = await call({ id: ID, reason: 'r', invoicing1: '2026-12-01' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('NOT_FOUND: Invoice not found (correlationId c-1)');
  });

  it.each([
    [500, 'UPSTREAM_ERROR', 'Unexpected response from the Inio API (HTTP 500).'],
    [403, 'UPSTREAM_ERROR', 'Unexpected response from the Inio API (HTTP 403).'],
    [404, 'SOMETHING_ELSE', 'Odd'],
  ])('keeps the normal error text for status %i with code %s', async (status, code, message) => {
    const { call } = await setup({
      post: () => Promise.reject(new InioApiError(status, code, message)),
    });
    const result = await call({ id: ID, reason: 'r', invoicing1: '2026-12-01' });
    expect(textOf(result)).toBe(`${code}: ${message}`);
  });

  it('returns field errors', async () => {
    const { call } = await setup({
      post: () =>
        Promise.reject(
          new InioApiError(400, 'VALIDATION_ERROR', 'Bad input', 'c-2', [
            { fieldName: 'metadata.invoicing1StopUntilDate', message: 'Must be in the future' },
          ]),
        ),
    });
    expect(textOf(await call({ id: ID, reason: 'r', invoicing1: '2020-01-01' }))).toBe(
      'VALIDATION_ERROR: Bad input (correlationId c-2) Fields: metadata.invoicing1StopUntilDate: Must be in the future',
    );
  });

  it('returns the uncertain-outcome timeout text verbatim', async () => {
    const message =
      'The Inio API did not respond within 30 s. The change may or may not have been applied; check before retrying.';
    const { call } = await setup({
      post: () => Promise.reject(new InioApiError(0, 'TIMEOUT', message)),
    });
    expect(textOf(await call({ id: ID, reason: 'r', invoicing1: '2026-12-01' }))).toBe(
      `TIMEOUT: ${message}`,
    );
  });
});

describe('update_invoice_stop_until_dates tool-call logging', () => {
  it('logs one tool call line with outcome ok and no reason text', async () => {
    const { call, logger } = await setup(impl());
    const bytes = Buffer.byteLength(
      textOf(await call({ id: ID, reason: 'secret-reason', invoicing1: '2026-12-01' })),
      'utf8',
    );
    expect(logger.info.mock.calls).toEqual([
      [
        {
          tool: 'update_invoice_stop_until_dates',
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

describe('update_invoice_stop_until_dates accepted write with an unreadable answer', () => {
  it.each([200, 201, 299])(
    'reports success with a note when the client cannot read a %i answer',
    async (status) => {
      const err = new InioApiError(status, 'UPSTREAM_ERROR', 'Unexpected response');
      const { call } = await setup({ ...impl(), post: () => Promise.reject(err) });
      expectAcceptedNote(await call({ id: ID, reason: 'Dispute', invoicing1: '2026-12-01' }));
    },
  );

  it('still reports a non-2xx client error as an error', async () => {
    const err = new InioApiError(400, 'BAD_REQUEST', 'Nope', 'c-1');
    const { call } = await setup({ ...impl(), post: () => Promise.reject(err) });
    const result = await call({ id: ID, reason: 'Dispute', invoicing1: '2026-12-01' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('BAD_REQUEST: Nope (correlationId c-1)');
  });
});
