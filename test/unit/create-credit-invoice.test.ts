import { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerCreateCreditInvoice } from '../../src/tools/create-credit-invoice.ts';
import { createInioClient, InioApiError } from '../../src/inio-client.ts';
import {
  BAD_DATES,
  GOOD_DATES,
  makeHarness,
  textOf,
  WRITE_ANNOTATIONS,
} from './helpers/write-tool.ts';

const ID = '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b';
const ITEM_A = '11111111-2222-4333-8444-555555555555';
const ITEM_B = '66666666-7777-4888-9999-000000000000';
// 2026-10-29 23:30 UTC: still "today" in UTC, already tomorrow in e.g. UTC+2.
const NOW = Date.UTC(2026, 9, 29, 23, 30, 0);
const ITEMS = [{ debitItemId: ITEM_A, unitPrice: -10.5, quantity: 2 }];
const ARGS = { id: ID, creditInvoiceNo: 'CN-1', items: ITEMS };
const POST_PATH = `/invoices/${ID}/credit-invoice`;
const CREATED = {
  id: '99999999-aaaa-4bbb-8ccc-dddddddddddd',
  invoiceNo: 'CN-1',
  paymentReference: '1234567',
  creditInvoiceItems: [
    {
      id: 'row-1',
      debitItemId: ITEM_A,
      unitPrice: -10.5,
      quantity: 2,
      description: null,
      IBAN: 'SE0000000000000000000',
      distributionEmailAddress: 'billing@customer.example',
    },
  ],
};

const { setup, close } = makeHarness((server, deps) => {
  registerCreateCreditInvoice(server, { ...deps, now: () => NOW });
}, 'create_credit_invoice');
afterEach(close);

const impl = () => ({ post: () => Promise.resolve(CREATED) });

describe('create_credit_invoice registration', () => {
  it('lists the tool with title Create credit invoice', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['create_credit_invoice']);
    expect(tools[0]?.title).toBe('Create credit invoice');
  });

  it('is annotated as a non-read-only, destructive, non-idempotent, open-world tool', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    expect(tools[0]?.annotations).toMatchObject(WRITE_ANNOTATIONS);
  });

  it.each([
    'get_invoice',
    'debitItemId',
    'negative',
    'unless distributionEnabled is true',
    'posted against the invoice',
    'cannot be undone with these tools',
  ])('description mentions %j', async (fragment) => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    expect(tools[0]?.description ?? '').toContain(fragment);
  });

  it('advertises a strict schema with distributionEnabled and isReverseTaxation defaulting to false', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    const schema = tools[0]?.inputSchema;
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([
      'additionalInformation',
      'creditInvoiceNo',
      'description',
      'distributionEnabled',
      'distributionMethod',
      'id',
      'isReverseTaxation',
      'items',
      'number',
      'paidDate',
      'paymentReference',
    ]);
    expect([...(schema?.required ?? [])].sort()).toEqual(['creditInvoiceNo', 'items']);
    expect(schema).toMatchObject({
      additionalProperties: false,
      properties: {
        id: { type: 'string', format: 'uuid' },
        creditInvoiceNo: { type: 'string', minLength: 1, maxLength: 50 },
        description: { type: 'string', maxLength: 100 },
        additionalInformation: { type: 'string', minLength: 1, maxLength: 100 },
        paymentReference: { type: 'string', minLength: 1, maxLength: 20 },
        distributionEnabled: { type: 'boolean', default: false },
        isReverseTaxation: { type: 'boolean', default: false },
        distributionMethod: { enum: ['sms', 'email', 'paper', 'edi'] },
        items: { type: 'array', minItems: 1, maxItems: 100 },
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

describe('create_credit_invoice property descriptions', () => {
  it('describes every property, including item properties, with key safety phrases', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    const props = Props.parse(tools[0]?.inputSchema.properties);
    const item = props.items?.items?.properties ?? {};
    expect(Object.keys(item).sort()).toEqual(['debitItemId', 'quantity', 'unitPrice']);
    for (const p of [...Object.values(props), ...Object.values(item)]) {
      expect(descOf(p).length).toBeGreaterThan(0);
    }
    expect(descOf(props.distributionEnabled)).toContain('end customer');
    expect(descOf(item.unitPrice)).toContain('negative');
    expect(descOf(props.paidDate)).toContain('UTC');
    expect(descOf(props.paidDate)).toContain('additionalInformation');
    expect(descOf(props.additionalInformation)).toContain('paidDate');
  });
});

describe('create_credit_invoice request', () => {
  it('posts to /invoices/<id>/credit-invoice with defaults and an empty distributionMethod', async () => {
    const { inio, call } = await setup(impl());
    await call(ARGS);
    expect(inio.post).toHaveBeenCalledTimes(1);
    expect(inio.post.mock.calls[0]).toStrictEqual([
      POST_PATH,
      {
        invoiceNo: 'CN-1',
        invoiceItems: ITEMS,
        isReverseTaxation: false,
        distributionEnabled: false,
        distributionMethod: '',
      },
    ]);
  });

  it('posts to the encoded by-number path without a lookup', async () => {
    const { inio, call } = await setup(impl());
    await call({ number: 'INV 1/2', creditInvoiceNo: 'CN-1', items: ITEMS });
    expect(inio.post.mock.calls[0]?.[0]).toBe('/invoices/by-number/INV%201%2F2/credit-invoice');
    expect(inio.get).not.toHaveBeenCalled();
  });

  it('sends distribution on only when asked, with the method', async () => {
    const { inio, call } = await setup(impl());
    await call({ ...ARGS, distributionEnabled: true, distributionMethod: 'email' });
    expect(inio.post.mock.calls[0]?.[1]).toMatchObject({
      distributionEnabled: true,
      distributionMethod: 'email',
    });
  });

  it.each(['sms', 'email', 'paper', 'edi'])('accepts distributionMethod %s', async (m) => {
    const { call } = await setup(impl());
    const result = await call({ ...ARGS, distributionEnabled: true, distributionMethod: m });
    expect(result.isError).not.toBe(true);
  });

  it('sends isReverseTaxation and description when given', async () => {
    const { inio, call } = await setup(impl());
    await call({ ...ARGS, isReverseTaxation: true, description: 'Return' });
    expect(inio.post.mock.calls[0]?.[1]).toStrictEqual({
      invoiceNo: 'CN-1',
      invoiceItems: ITEMS,
      isReverseTaxation: true,
      distributionEnabled: false,
      distributionMethod: '',
      description: 'Return',
    });
  });

  it('sends paidDate for today (UTC) without additionalInformation', async () => {
    const { inio, call } = await setup(impl());
    await call({ ...ARGS, paidDate: '2026-10-29' });
    expect(inio.post.mock.calls[0]?.[1]).toMatchObject({ paidDate: '2026-10-29' });
    expect(inio.post.mock.calls[0]?.[1]).not.toHaveProperty('additionalInformation');
  });

  it('sends paidDate for a future date without additionalInformation', async () => {
    const { call } = await setup(impl());
    expect((await call({ ...ARGS, paidDate: '2026-10-30' })).isError).not.toBe(true);
  });

  it('sends paidDate in the past together with additionalInformation', async () => {
    const { inio, call } = await setup(impl());
    await call({ ...ARGS, paidDate: '2026-10-28', additionalInformation: 'Paid by bank' });
    expect(inio.post.mock.calls[0]?.[1]).toMatchObject({
      paidDate: '2026-10-28',
      additionalInformation: 'Paid by bank',
    });
  });

  it('sends additionalInformation without paidDate', async () => {
    const { inio, call } = await setup(impl());
    await call({ ...ARGS, additionalInformation: 'Note' });
    expect(inio.post.mock.calls[0]?.[1]).toMatchObject({ additionalInformation: 'Note' });
    expect(inio.post.mock.calls[0]?.[1]).not.toHaveProperty('paidDate');
  });

  it.each(GOOD_DATES)('accepts the paidDate %s', async (paidDate) => {
    const { call } = await setup(impl());
    const result = await call({ ...ARGS, paidDate, additionalInformation: 'x' });
    expect(result.isError).not.toBe(true);
  });

  it('accepts a unitPrice of 0, creditInvoiceNo of 1 and 50 characters, and a 100 character description', async () => {
    const { call } = await setup(impl());
    const item = { debitItemId: ITEM_A, unitPrice: 0, quantity: 1 };
    for (const creditInvoiceNo of ['x', 'x'.repeat(50)]) {
      const result = await call({ ...ARGS, creditInvoiceNo, items: [item] });
      expect(result.isError).not.toBe(true);
    }
    expect((await call({ ...ARGS, description: 'x'.repeat(100) })).isError).not.toBe(true);
  });

  it('sends paymentReference only when given', async () => {
    const { inio, call } = await setup(impl());
    await call(ARGS);
    expect(inio.post.mock.calls[0]?.[1]).not.toHaveProperty('paymentReference');
    await call({ ...ARGS, paymentReference: 'REF-1' });
    expect(inio.post.mock.calls[1]?.[1]).toMatchObject({ paymentReference: 'REF-1' });
  });

  it('accepts paymentReference of exactly 20 and additionalInformation of exactly 100 characters', async () => {
    const { inio, call } = await setup(impl());
    const paymentReference = 'x'.repeat(20);
    const additionalInformation = 'x'.repeat(100);
    expect((await call({ ...ARGS, paymentReference, additionalInformation })).isError).not.toBe(
      true,
    );
    expect(inio.post.mock.calls[0]?.[1]).toMatchObject({ paymentReference, additionalInformation });
  });

  it('accepts 100 items', async () => {
    const { call } = await setup(impl());
    const items = Array.from({ length: 100 }, () => ({ ...ITEMS[0] }));
    expect((await call({ ...ARGS, items })).isError).not.toBe(true);
  });
});

describe('create_credit_invoice input validation', () => {
  it.each([
    [
      'neither id nor number',
      { creditInvoiceNo: 'CN-1', items: ITEMS },
      'Provide exactly one of id or number.',
    ],
    ['both id and number', { ...ARGS, number: 'INV-1' }, 'Provide exactly one of id or number.'],
    ['a non-uuid id', { ...ARGS, id: 'inv-1' }, 'id'],
    [
      'a number with CR/LF',
      { number: 'INV-1\r\nX: 1', creditInvoiceNo: 'CN-1', items: ITEMS },
      'number',
    ],
    ['a missing creditInvoiceNo', { id: ID, items: ITEMS }, 'creditInvoiceNo'],
    ['an empty creditInvoiceNo', { ...ARGS, creditInvoiceNo: '' }, 'creditInvoiceNo'],
    [
      'a creditInvoiceNo over 50 characters',
      { ...ARGS, creditInvoiceNo: 'x'.repeat(51) },
      'creditInvoiceNo',
    ],
    ['missing items', { id: ID, creditInvoiceNo: 'CN-1' }, 'items'],
    ['no items', { ...ARGS, items: [] }, 'items'],
    [
      'more than 100 items',
      { ...ARGS, items: Array.from({ length: 101 }, () => ITEMS[0]) },
      'items',
    ],
    [
      'a non-uuid debitItemId',
      { ...ARGS, items: [{ ...ITEMS[0], debitItemId: 'row-1' }] },
      'debitItemId',
    ],
    [
      'a missing unitPrice',
      { ...ARGS, items: [{ debitItemId: ITEM_A, quantity: 1 }] },
      'unitPrice',
    ],
    ['a zero quantity', { ...ARGS, items: [{ ...ITEMS[0], quantity: 0 }] }, 'quantity'],
    ['a negative quantity', { ...ARGS, items: [{ ...ITEMS[0], quantity: -1 }] }, 'quantity'],
    [
      'a missing quantity',
      { ...ARGS, items: [{ debitItemId: ITEM_A, unitPrice: -1 }] },
      'quantity',
    ],
    [
      'an unknown key on an item',
      { ...ARGS, items: [{ ...ITEMS[0], foo: 1 }] },
      'Unrecognized key: "foo"',
    ],
    [
      'an additionalInformation over 100 characters',
      { ...ARGS, additionalInformation: 'x'.repeat(101) },
      'additionalInformation',
    ],
    [
      'a paymentReference over 20 characters',
      { ...ARGS, paymentReference: 'x'.repeat(21) },
      'paymentReference',
    ],
    ['an empty paymentReference', { ...ARGS, paymentReference: '' }, 'paymentReference'],
    [
      'an empty additionalInformation',
      { ...ARGS, additionalInformation: '' },
      'additionalInformation',
    ],
    ['a description over 100 characters', { ...ARGS, description: 'x'.repeat(101) }, 'description'],
    [
      'an unknown distributionMethod',
      { ...ARGS, distributionEnabled: true, distributionMethod: 'fax' },
      'distributionMethod',
    ],
    ['an empty distributionMethod', { ...ARGS, distributionMethod: '' }, 'distributionMethod'],
    ['an unknown key', { ...ARGS, foo: 1 }, 'Unrecognized key: "foo"'],
  ])('rejects %s without calling the API', async (_label, args, fragment) => {
    const { inio, call } = await setup(impl());
    const result = await call(args);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Input validation error: /);
    expect(textOf(result)).toContain(fragment);
    expect(inio.post).not.toHaveBeenCalled();
  });

  it('rejects a positive unitPrice locally with a clear message', async () => {
    const { inio, call } = await setup(impl());
    const result = await call({ ...ARGS, items: [{ ...ITEMS[0], unitPrice: 0.01 }] });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('unitPrice must be 0 or negative');
    expect(inio.post).not.toHaveBeenCalled();
  });

  it('rejects distributionEnabled true without a distributionMethod', async () => {
    const { inio, call } = await setup(impl());
    const result = await call({ ...ARGS, distributionEnabled: true });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(
      'distributionMethod is required when distributionEnabled is true',
    );
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

  it.each(BAD_DATES)('rejects the paidDate %j', async (paidDate) => {
    const { inio, call } = await setup(impl());
    const result = await call({ ...ARGS, paidDate, additionalInformation: 'x' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('paidDate');
    expect(inio.post).not.toHaveBeenCalled();
  });

  it.each(['..', '.'])('rejects the number %j as an invalid path segment', async (number) => {
    const { inio, call } = await setup(impl());
    const result = await call({ number, creditInvoiceNo: 'CN-1', items: ITEMS });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Invalid path segment');
    expect(inio.post).not.toHaveBeenCalled();
  });
});

describe('create_credit_invoice output', () => {
  it('returns the created credit invoice with compacted, redacted items', async () => {
    const { call } = await setup(impl());
    const result = await call(ARGS);
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toStrictEqual({
      created: true,
      id: CREATED.id,
      invoiceNo: 'CN-1',
      paymentReference: '1234567',
      items: [{ id: 'row-1', debitItemId: ITEM_A, unitPrice: -10.5, quantity: 2 }],
    });
  });

  it('lists every item', async () => {
    const { call } = await setup({
      post: () =>
        Promise.resolve({
          ...CREATED,
          creditInvoiceItems: [
            { debitItemId: ITEM_A, unitPrice: -1, quantity: 1 },
            { debitItemId: ITEM_B, unitPrice: -2, quantity: 3 },
          ],
        }),
    });
    expect(JSON.parse(textOf(await call(ARGS)))).toMatchObject({
      items: [{ debitItemId: ITEM_A }, { debitItemId: ITEM_B }],
    });
  });

  it('never includes PII from the items', async () => {
    const { call } = await setup(impl());
    const text = textOf(await call(ARGS));
    for (const leak of ['IBAN', 'customer.example']) expect(text).not.toContain(leak);
  });

  it.each([
    ['a string', 'Success'],
    ['null', null],
    ['an empty object', {}],
  ])('still reports success when the 2xx body is %s', async (_l, body) => {
    const { call } = await setup({ post: () => Promise.resolve(body) });
    const result = await call(ARGS);
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toStrictEqual({
      created: true,
      creditInvoiceNo: 'CN-1',
      note: 'The credit invoice was created, but the API answer could not be read.',
    });
  });
});

describe('create_credit_invoice errors', () => {
  it.each([200, 299])(
    'still reports success with a note for an InioApiError with status %s',
    async (status) => {
      const { call } = await setup({
        post: () =>
          Promise.reject(new InioApiError(status, 'UPSTREAM_ERROR', 'Unexpected response')),
      });
      const result = await call(ARGS);
      expect(result.isError).not.toBe(true);
      expect(JSON.parse(textOf(result))).toStrictEqual({
        created: true,
        creditInvoiceNo: 'CN-1',
        note: 'The credit invoice was created, but the API answer could not be read.',
      });
    },
  );

  it('treats an InioApiError with status 300 as a plain error, without a note', async () => {
    const { call } = await setup({
      post: () => Promise.reject(new InioApiError(300, 'UPSTREAM_ERROR', 'Multiple choices')),
    });
    const result = await call(ARGS);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('UPSTREAM_ERROR: Multiple choices');
  });

  it.each([
    [
      'a duplicate invoice number',
      new InioApiError(409, 'CONFLICT', 'Invoice number already exists', 'c-9'),
      'CONFLICT: Invoice number already exists (correlationId c-9)',
    ],
    [
      'a debt collection rejection',
      new InioApiError(400, 'BAD_REQUEST', 'Invoice is in debt collection', 'c-4'),
      'BAD_REQUEST: Invoice is in debt collection (correlationId c-4)',
    ],
    [
      'the uncertain-outcome timeout',
      new InioApiError(
        0,
        'TIMEOUT',
        'The Inio API did not respond within 30 s. The change may or may not have been applied; check before retrying.',
      ),
      'TIMEOUT: The Inio API did not respond within 30 s. The change may or may not have been applied; check before retrying.',
    ],
  ])('returns %s as the error text', async (_label, error, text) => {
    const { call } = await setup({ post: () => Promise.reject(error) });
    const result = await call(ARGS);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(text);
  });

  it('returns field errors', async () => {
    const { call } = await setup({
      post: () =>
        Promise.reject(
          new InioApiError(400, 'VALIDATION_ERROR', 'Bad input', 'c-5', [
            { fieldName: 'invoiceItems.0.quantity', message: 'Exceeds the debit item quantity' },
          ]),
        ),
    });
    expect(textOf(await call(ARGS))).toBe(
      'VALIDATION_ERROR: Bad input (correlationId c-5) Fields: invoiceItems.0.quantity: Exceeds the debit item quantity',
    );
  });
});

describe('create_credit_invoice tool-call logging', () => {
  it('logs one tool call line with outcome ok and no input values', async () => {
    const { call, logger } = await setup(impl());
    const bytes = Buffer.byteLength(
      textOf(await call({ ...ARGS, description: 'secret-description' })),
      'utf8',
    );
    expect(logger.info.mock.calls).toEqual([
      [
        {
          tool: 'create_credit_invoice',
          durationMs: expect.any(Number),
          outcome: 'ok',
          responseBytes: bytes,
          approxTokens: Math.ceil(bytes / 4),
        },
        'tool call',
      ],
    ]);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('secret-description');
  });
});

describe('create_credit_invoice through the real client', () => {
  const NOTE = 'The credit invoice was created, but the API answer could not be read.';
  const run = async (res: Response) => {
    const real = createInioClient({
      apiUrl: 'https://api.example/v1',
      tokens: { getToken: () => Promise.resolve('tok'), invalidate: () => undefined },
      fetch: vi.fn<typeof globalThis.fetch>(() => Promise.resolve(res)),
      logger: { debug: () => undefined, warn: () => undefined },
      sleep: () => Promise.resolve(),
    });
    const { call } = await setup({ post: (path, body, options) => real.post(path, body, options) });
    return call(ARGS);
  };

  it('reports success with a note when a 201 body is not JSON', async () => {
    const result = await run(new Response('<html>created</html>', { status: 201 }));
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toEqual({
      created: true,
      creditInvoiceNo: 'CN-1',
      note: NOTE,
    });
  });

  it('reports success with a note when a 201 JSON body lacks the result envelope', async () => {
    const result = await run(
      new Response(JSON.stringify({ id: 'x' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toEqual({
      created: true,
      creditInvoiceNo: 'CN-1',
      note: NOTE,
    });
  });

  it('still fails on a 400 error envelope', async () => {
    const result = await run(
      new Response(
        JSON.stringify({
          success: false,
          status: 400,
          code: 'VALIDATION_ERROR',
          message: 'Bad input',
          correlationId: 'c-9',
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('VALIDATION_ERROR: Bad input (correlationId c-9)');
  });
});
