import { z } from 'zod';
import { afterEach, describe, expect, it } from 'vitest';
import { registerMatchCreditInvoice } from '../../src/tools/match-credit-invoice.ts';
import { InioApiError } from '../../src/inio-client.ts';
import {
  BAD_DATES,
  GOOD_DATES,
  makeHarness,
  textOf,
  WRITE_ANNOTATIONS,
} from './helpers/write-tool.ts';

const ID = '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b';
const CREDIT_ID = '99999999-aaaa-4bbb-8ccc-dddddddddddd';
// 2026-10-29 23:30 UTC: still "today" in UTC, already tomorrow in e.g. UTC+2.
const NOW = Date.UTC(2026, 9, 29, 23, 30, 0);
const ARGS = { id: ID, creditInvoiceNo: 'CN-1', amount: -10.5 };
const POST_PATH = `/invoices/${ID}/match-credit-invoice`;
const INVOICE = {
  id: ID,
  invoiceNo: 'INV-1001',
  remainingAmount: '89.50',
  paymentStatus: 'partiallyPaid',
  IBAN: 'SE0000000000000000000',
  distributionEmailAddress: 'billing@customer.example',
};

const { setup, close } = makeHarness((server, deps) => {
  registerMatchCreditInvoice(server, { ...deps, now: () => NOW });
}, 'match_credit_invoice');
afterEach(close);

const impl = () => ({
  post: () => Promise.resolve(CREDIT_ID),
  get: () => Promise.resolve(INVOICE),
});

describe('match_credit_invoice registration', () => {
  it('lists the tool with title Match credit invoice', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['match_credit_invoice']);
    expect(tools[0]?.title).toBe('Match credit invoice');
  });

  it('is annotated as a non-read-only, destructive, non-idempotent, open-world tool', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    expect(tools[0]?.annotations).toMatchObject(WRITE_ANNOTATIONS);
  });

  it('says it cannot be undone with these tools', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    expect(tools[0]?.description ?? '').toContain('cannot be undone with these tools');
  });

  it('advertises a strict schema', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    const schema = tools[0]?.inputSchema;
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([
      'additionalInformation',
      'amount',
      'creditInvoiceNo',
      'id',
      'number',
      'paidDate',
    ]);
    expect([...(schema?.required ?? [])].sort()).toEqual(['amount', 'creditInvoiceNo']);
    expect(schema).toMatchObject({
      additionalProperties: false,
      properties: {
        id: { type: 'string', format: 'uuid' },
        creditInvoiceNo: { type: 'string', minLength: 1, maxLength: 50 },
        additionalInformation: { type: 'string', maxLength: 100 },
        amount: { type: 'number' },
      },
    });
  });
});

type Prop = { description?: string; items?: { properties?: Record<string, Prop> } };
const Props: z.ZodType<Record<string, Prop>> = z.record(
  z.string(),
  z.looseObject({
    description: z.string().optional(),
    items: z
      .looseObject({
        properties: z
          .record(z.string(), z.looseObject({ description: z.string().optional() }))
          .optional(),
      })
      .optional(),
  }),
);
const descOf = (p?: Prop) => p?.description ?? '';

describe('match_credit_invoice property descriptions', () => {
  it('describes every property with key safety phrases', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    const props = Props.parse(tools[0]?.inputSchema.properties);
    for (const p of Object.values(props)) expect(descOf(p).length).toBeGreaterThan(0);
    expect(descOf(props.amount)).toContain('negative');
    expect(descOf(props.paidDate)).toContain('UTC');
    expect(descOf(props.paidDate)).toContain('additionalInformation');
    expect(descOf(props.additionalInformation)).toContain('paidDate');
  });
});

describe('match_credit_invoice request', () => {
  it('posts to /invoices/<id>/match-credit-invoice, then reads the invoice back by id', async () => {
    const { inio, call } = await setup(impl());
    await call(ARGS);
    expect(inio.post).toHaveBeenCalledTimes(1);
    expect(inio.post.mock.calls[0]).toStrictEqual([
      POST_PATH,
      { creditInvoiceNo: 'CN-1', amount: -10.5 },
    ]);
    expect(inio.get).toHaveBeenCalledTimes(1);
    expect(inio.get).toHaveBeenCalledWith(`/invoices/${ID}`);
  });

  it('uses the encoded by-number path for both calls', async () => {
    const { inio, call } = await setup(impl());
    await call({ number: 'INV 1/2', creditInvoiceNo: 'CN-1', amount: -1 });
    expect(inio.post.mock.calls[0]?.[0]).toBe(
      '/invoices/by-number/INV%201%2F2/match-credit-invoice',
    );
    expect(inio.get).toHaveBeenCalledWith('/invoices/by-number/INV%201%2F2');
  });

  it('writes before it reads back', async () => {
    const order: string[] = [];
    const { call } = await setup({
      post: () => {
        order.push('post');
        return Promise.resolve(CREDIT_ID);
      },
      get: () => {
        order.push('get');
        return Promise.resolve(INVOICE);
      },
    });
    await call(ARGS);
    expect(order).toEqual(['post', 'get']);
  });

  it('sends paidDate for today (UTC) without additionalInformation', async () => {
    const { inio, call } = await setup(impl());
    await call({ ...ARGS, paidDate: '2026-10-29' });
    expect(inio.post.mock.calls[0]?.[1]).toStrictEqual({
      creditInvoiceNo: 'CN-1',
      amount: -10.5,
      paidDate: '2026-10-29',
    });
  });

  it('sends paidDate in the past together with additionalInformation', async () => {
    const { inio, call } = await setup(impl());
    await call({ ...ARGS, paidDate: '2026-10-28', additionalInformation: 'Bank note' });
    expect(inio.post.mock.calls[0]?.[1]).toStrictEqual({
      creditInvoiceNo: 'CN-1',
      amount: -10.5,
      paidDate: '2026-10-28',
      additionalInformation: 'Bank note',
    });
  });

  it('sends additionalInformation without paidDate', async () => {
    const { inio, call } = await setup(impl());
    await call({ ...ARGS, additionalInformation: 'Note' });
    expect(inio.post.mock.calls[0]?.[1]).toStrictEqual({
      creditInvoiceNo: 'CN-1',
      amount: -10.5,
      additionalInformation: 'Note',
    });
  });

  it.each(GOOD_DATES)('accepts the paidDate %s', async (paidDate) => {
    const { call } = await setup(impl());
    expect((await call({ ...ARGS, paidDate, additionalInformation: 'x' })).isError).not.toBe(true);
  });

  it.each([0, -0.01, -10, -10.5, -1234.56])('accepts the amount %s', async (amount) => {
    const { call } = await setup(impl());
    expect((await call({ ...ARGS, amount })).isError).not.toBe(true);
  });

  it('accepts creditInvoiceNo of exactly 1 and 50 characters', async () => {
    const { call } = await setup(impl());
    expect((await call({ ...ARGS, creditInvoiceNo: 'x' })).isError).not.toBe(true);
    expect((await call({ ...ARGS, creditInvoiceNo: 'x'.repeat(50) })).isError).not.toBe(true);
  });

  it('accepts additionalInformation of exactly 100 characters', async () => {
    const { inio, call } = await setup(impl());
    const additionalInformation = 'x'.repeat(100);
    expect((await call({ ...ARGS, additionalInformation })).isError).not.toBe(true);
    expect(inio.post.mock.calls[0]?.[1]).toMatchObject({ additionalInformation });
  });
});

describe('match_credit_invoice input validation', () => {
  it.each([
    [
      'neither id nor number',
      { creditInvoiceNo: 'CN-1', amount: -1 },
      'Provide exactly one of id or number.',
    ],
    ['both id and number', { ...ARGS, number: 'INV-1' }, 'Provide exactly one of id or number.'],
    ['a non-uuid id', { ...ARGS, id: 'inv-1' }, 'id'],
    [
      'a number with CR/LF',
      { number: 'INV-1\r\nX: 1', creditInvoiceNo: 'CN-1', amount: -1 },
      'number',
    ],
    ['a missing creditInvoiceNo', { id: ID, amount: -1 }, 'creditInvoiceNo'],
    ['an empty creditInvoiceNo', { ...ARGS, creditInvoiceNo: '' }, 'creditInvoiceNo'],
    [
      'a creditInvoiceNo over 50 characters',
      { ...ARGS, creditInvoiceNo: 'x'.repeat(51) },
      'creditInvoiceNo',
    ],
    [
      'an additionalInformation over 100 characters',
      { ...ARGS, additionalInformation: 'x'.repeat(101) },
      'additionalInformation',
    ],
    [
      'an empty additionalInformation',
      { ...ARGS, additionalInformation: '' },
      'additionalInformation',
    ],
    ['a missing amount', { id: ID, creditInvoiceNo: 'CN-1' }, 'amount'],
    ['a string amount', { ...ARGS, amount: '-1' }, 'amount'],
    ['an unknown key', { ...ARGS, foo: 1 }, 'Unrecognized key: "foo"'],
  ])('rejects %s without calling the API', async (_label, args, fragment) => {
    const { inio, call } = await setup(impl());
    const result = await call(args);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Input validation error: /);
    expect(textOf(result)).toContain(fragment);
    expect(inio.post).not.toHaveBeenCalled();
    expect(inio.get).not.toHaveBeenCalled();
  });

  it('rejects a positive amount locally with a clear message', async () => {
    const { inio, call } = await setup(impl());
    const result = await call({ ...ARGS, amount: 0.01 });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('amount must be 0 or negative');
    expect(inio.post).not.toHaveBeenCalled();
  });

  it('rejects an amount with more than 2 decimals locally', async () => {
    const { inio, call } = await setup(impl());
    const result = await call({ ...ARGS, amount: -10.001 });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('amount must have at most 2 decimals');
    expect(inio.post).not.toHaveBeenCalled();
  });

  it('rejects a paidDate before today (UTC) without additionalInformation', async () => {
    const { inio, call } = await setup(impl());
    const result = await call({ ...ARGS, paidDate: '2026-10-28' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(
      'additionalInformation is required when paidDate is in the past',
    );
    expect(inio.post).not.toHaveBeenCalled();
  });

  it('allows a future paidDate without additionalInformation', async () => {
    const { call } = await setup(impl());
    expect((await call({ ...ARGS, paidDate: '2026-10-30' })).isError).not.toBe(true);
  });

  it.each(BAD_DATES)('rejects the paidDate %j', async (paidDate) => {
    const { inio, call } = await setup(impl());
    const result = await call({ ...ARGS, paidDate, additionalInformation: 'x' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('paidDate');
    expect(inio.post).not.toHaveBeenCalled();
  });

  it.each(['..', '.'])('rejects the number %j as an invalid path segment', async (number) => {
    const { inio, call } = await setup(impl());
    const result = await call({ number, creditInvoiceNo: 'CN-1', amount: -1 });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Invalid path segment');
    expect(inio.post).not.toHaveBeenCalled();
  });
});

describe('match_credit_invoice output', () => {
  it('reports the match with the read-back remaining amount and payment status', async () => {
    const { call } = await setup(impl());
    const result = await call(ARGS);
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toBe(
      JSON.stringify({
        matched: true,
        invoice: ID,
        creditInvoiceNo: 'CN-1',
        amount: -10.5,
        creditInvoiceId: CREDIT_ID,
        remainingAmount: '89.50',
        paymentStatus: 'partiallyPaid',
      }),
    );
  });

  it('reads a numeric remainingAmount back instead of the readBack note', async () => {
    const { call } = await setup({
      post: () => Promise.resolve(CREDIT_ID),
      get: () => Promise.resolve({ ...INVOICE, remainingAmount: 100 }),
    });
    const body = JSON.parse(textOf(await call(ARGS)));
    expect(body).toMatchObject({ remainingAmount: 100, paymentStatus: 'partiallyPaid' });
    expect(body).not.toHaveProperty('readBack');
  });

  it('names the invoice by the number it was given', async () => {
    const { call } = await setup(impl());
    const result = await call({ number: 'INV-1001', creditInvoiceNo: 'CN-1', amount: -10.5 });
    expect(JSON.parse(textOf(result))).toMatchObject({ matched: true, invoice: 'INV-1001' });
  });

  it('keeps an amount of 0 in the result', async () => {
    const { call } = await setup(impl());
    expect(JSON.parse(textOf(await call({ ...ARGS, amount: 0 })))).toMatchObject({ amount: 0 });
  });

  it('never includes other invoice fields or PII', async () => {
    const { call } = await setup(impl());
    const text = textOf(await call(ARGS));
    for (const leak of ['IBAN', 'customer.example']) expect(text).not.toContain(leak);
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
      'an empty object',
      () => Promise.resolve({}),
      'UPSTREAM_ERROR: Unexpected invoice payload from the Inio API.',
    ],
    [
      'null',
      () => Promise.resolve(null),
      'UPSTREAM_ERROR: Unexpected invoice payload from the Inio API.',
    ],
  ])('still reports the match when the read-back fails with %s', async (_label, get, text) => {
    const { call } = await setup({
      post: () => Promise.resolve(CREDIT_ID),
      get,
    });
    const result = await call(ARGS);
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toStrictEqual({
      matched: true,
      invoice: ID,
      creditInvoiceNo: 'CN-1',
      amount: -10.5,
      creditInvoiceId: CREDIT_ID,
      readBack: `Could not read the invoice back: ${text}`,
    });
  });
});

describe('match_credit_invoice response handling', () => {
  it.each([
    ['an object', { creditInvoiceId: CREDIT_ID }],
    ['null', null],
    ['a number', 42],
  ])('fails with an upstream error when the API returns %s instead of an id', async (_l, body) => {
    const { inio, call } = await setup({
      post: () => Promise.resolve(body),
      get: () => Promise.resolve(INVOICE),
    });
    const result = await call(ARGS);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('UPSTREAM_ERROR: Unexpected credit invoice id from the Inio API.');
    expect(inio.get).not.toHaveBeenCalled();
  });
});

describe('match_credit_invoice errors', () => {
  it('returns a business-rule rejection as the API error text and does not read back', async () => {
    const { inio, call } = await setup({
      post: () => Promise.reject(new InioApiError(400, 'BAD_REQUEST', 'Customers differ', 'c-4')),
      get: () => Promise.resolve(INVOICE),
    });
    const result = await call(ARGS);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('BAD_REQUEST: Customers differ (correlationId c-4)');
    expect(inio.get).not.toHaveBeenCalled();
  });

  it('returns field errors', async () => {
    const { call } = await setup({
      post: () =>
        Promise.reject(
          new InioApiError(400, 'VALIDATION_ERROR', 'Bad input', 'c-5', [
            { fieldName: 'amount', message: 'Exceeds the remaining amount' },
          ]),
        ),
    });
    expect(textOf(await call(ARGS))).toBe(
      'VALIDATION_ERROR: Bad input (correlationId c-5) Fields: amount: Exceeds the remaining amount',
    );
  });

  it('returns the uncertain-outcome timeout text as an error and does not read back', async () => {
    const message =
      'The Inio API did not respond within 30 s. The change may or may not have been applied; check before retrying.';
    const { inio, call } = await setup({
      post: () => Promise.reject(new InioApiError(0, 'TIMEOUT', message)),
    });
    const result = await call(ARGS);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(`TIMEOUT: ${message}`);
    expect(inio.get).not.toHaveBeenCalled();
  });
});

describe('match_credit_invoice tool-call logging', () => {
  it('logs one tool call line with outcome ok and no input values', async () => {
    const { call, logger } = await setup(impl());
    const bytes = Buffer.byteLength(
      textOf(await call({ ...ARGS, additionalInformation: 'secret-note' })),
      'utf8',
    );
    expect(logger.info.mock.calls).toEqual([
      [
        {
          tool: 'match_credit_invoice',
          durationMs: expect.any(Number),
          outcome: 'ok',
          responseBytes: bytes,
          approxTokens: Math.ceil(bytes / 4),
        },
        'tool call',
      ],
    ]);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('secret-note');
  });
});
