import { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerCreatePayment } from '../../src/tools/create-payment.ts';
import { createInioClient, InioApiError } from '../../src/inio-client.ts';
import {
  makeHarness,
  textOf,
  GOOD_DATES,
  BAD_DATES,
  WRITE_ANNOTATIONS,
} from './helpers/write-tool.ts';

const CLIENT_ID = 'client-7f3a9c';
const PAYMENT_ID = 'pay-0001-aaaa';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** Unsigned JWT-shaped token: the tool only decodes the payload. */
const jwt = (claims: Record<string, unknown>) =>
  `${b64({ alg: 'none' })}.${b64(claims)}.sig-secret`;
const TOKEN = jwt({ sub: 'svc', inio_client_id: CLIENT_ID });

const ARGS = { number: 'INV-1001', transactionType: 'direct_payment', amount: 10.5 };
const INVOICE = {
  id: '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b',
  invoiceNo: 'INV-1001',
  remainingAmount: '89.50',
  paymentStatus: 'partiallyPaid',
  IBAN: 'SE0000000000000000000',
  distributionEmailAddress: 'billing@customer.example',
};
const NOTE =
  'The payment was recorded, but the API answer could not be read. Do not retry; check the invoice first.';

let token = TOKEN;
const { setup, close } = makeHarness((server, deps) => {
  registerCreatePayment(server, {
    ...deps,
    tokens: { getToken: () => Promise.resolve(token) },
  });
}, 'create_payment');
afterEach(async () => {
  token = TOKEN;
  await close();
});

const impl = () => ({
  post: () => Promise.resolve([PAYMENT_ID]),
  get: () => Promise.resolve(INVOICE),
});

describe('create_payment registration', () => {
  it('lists the tool with title Create payment', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['create_payment']);
    expect(tools[0]?.title).toBe('Create payment');
  });

  it('is annotated as a non-read-only, destructive, non-idempotent, open-world tool', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    expect(tools[0]?.annotations).toMatchObject(WRITE_ANNOTATIONS);
  });

  it.each([
    'records a new payment',
    'never retry',
    'get_invoice',
    'remainingAmount',
    'fullPayment',
    'remaining amount',
    'cannot be undone with these tools',
  ])('description mentions %j', async (fragment) => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    expect(tools[0]?.description ?? '').toContain(fragment);
  });

  it('advertises a strict schema without id or clientId inputs', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    const schema = tools[0]?.inputSchema;
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([
      'additionalInformation',
      'amount',
      'confirmFeeAutoRemoval',
      'fullPayment',
      'number',
      'paidDate',
      'transactionType',
    ]);
    expect([...(schema?.required ?? [])].sort()).toEqual(['number', 'transactionType']);
    expect(schema).toMatchObject({
      additionalProperties: false,
      properties: {
        number: { type: 'string', minLength: 1, maxLength: 100 },
        transactionType: {
          enum: ['direct_payment', 'good_will', 'bank', 'reminder_fee_waiver'],
        },
        additionalInformation: { type: 'string', minLength: 1, maxLength: 100 },
        confirmFeeAutoRemoval: { type: 'boolean' },
      },
    });
  });

  it('describes every property', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    const props = z
      .record(z.string(), z.looseObject({ description: z.string().min(1) }))
      .parse(tools[0]?.inputSchema.properties);
    expect(Object.keys(props)).toHaveLength(7);
    // The fee waiver must be explained so the assistant asks before enabling it.
    expect(props.confirmFeeAutoRemoval?.description).toMatch(/backdated/);
    expect(props.confirmFeeAutoRemoval?.description).toMatch(/escalation fee/);
  });
});

describe('create_payment request', () => {
  it('posts a one-element array to /payments with clientId from the token', async () => {
    const { inio, call } = await setup(impl());
    await call(ARGS);
    expect(inio.post).toHaveBeenCalledTimes(1);
    expect(inio.post.mock.calls[0]).toStrictEqual([
      '/payments',
      [
        {
          clientId: CLIENT_ID,
          invoiceNo: 'INV-1001',
          transactionType: 'direct_payment',
          amount: 10.5,
        },
      ],
    ]);
  });

  it('omits amount for fullPayment', async () => {
    const { inio, call } = await setup(impl());
    await call({ number: 'INV-1001', transactionType: 'bank', fullPayment: true });
    expect(inio.post.mock.calls[0]?.[1]).toStrictEqual([
      { clientId: CLIENT_ID, invoiceNo: 'INV-1001', transactionType: 'bank' },
    ]);
  });

  it('sends a capital and fee breakdown as given', async () => {
    const { inio, call } = await setup(impl());
    await call({ ...ARGS, amount: { capital: 5, fee: 1.25 } });
    expect(inio.post.mock.calls[0]?.[1]).toMatchObject([{ amount: { capital: 5, fee: 1.25 } }]);
  });

  it('sends paidDate, additionalInformation and confirmFeeAutoRemoval when given', async () => {
    const { inio, call } = await setup(impl());
    await call({
      ...ARGS,
      paidDate: '2020-01-02',
      additionalInformation: 'Bank ref 1',
      confirmFeeAutoRemoval: true,
    });
    expect(inio.post.mock.calls[0]?.[1]).toStrictEqual([
      {
        clientId: CLIENT_ID,
        invoiceNo: 'INV-1001',
        transactionType: 'direct_payment',
        amount: 10.5,
        paidDate: '2020-01-02',
        additionalInformation: 'Bank ref 1',
        confirmFeeAutoRemoval: true,
      },
    ]);
  });

  it('sends confirmFeeAutoRemoval false when given', async () => {
    const { inio, call } = await setup(impl());
    await call({ ...ARGS, confirmFeeAutoRemoval: false });
    expect(inio.post.mock.calls[0]?.[1]).toMatchObject([{ confirmFeeAutoRemoval: false }]);
  });

  it.each(['direct_payment', 'good_will', 'bank', 'reminder_fee_waiver'])(
    'accepts the transaction type %s',
    async (transactionType) => {
      const { inio, call } = await setup(impl());
      const result = await call({ ...ARGS, transactionType });
      expect(result.isError).not.toBe(true);
      expect(inio.post.mock.calls[0]?.[1]).toMatchObject([{ transactionType }]);
    },
  );

  it.each(GOOD_DATES)('accepts the paidDate %s', async (paidDate) => {
    const { call } = await setup(impl());
    expect((await call({ ...ARGS, paidDate })).isError).not.toBe(true);
  });

  it('accepts a backdated paidDate without additionalInformation', async () => {
    const { call } = await setup(impl());
    expect((await call({ ...ARGS, paidDate: '2000-01-01' })).isError).not.toBe(true);
  });

  it.each([0.01, 10, 10.55, 1234567.89])('accepts the amount %s', async (amount) => {
    const { inio, call } = await setup(impl());
    expect((await call({ ...ARGS, amount })).isError).not.toBe(true);
    expect(inio.post.mock.calls[0]?.[1]).toMatchObject([{ amount }]);
  });

  it.each([
    [{ capital: 5 }],
    [{ fee: 5 }],
    [{ capital: 0, fee: 5 }],
    [{ capital: 5, fee: 0 }],
    [{ capital: 0.01, fee: 0.01 }],
  ])('accepts the breakdown %j for good_will', async (amount) => {
    const { call } = await setup(impl());
    expect((await call({ ...ARGS, transactionType: 'good_will', amount })).isError).not.toBe(true);
  });

  it('accepts a number of 1 and of 100 characters, and an additionalInformation of 1 and 100', async () => {
    const { call } = await setup(impl());
    for (const number of ['x', 'x'.repeat(100)]) {
      expect((await call({ ...ARGS, number })).isError).not.toBe(true);
    }
    for (const additionalInformation of ['x', 'x'.repeat(100)]) {
      expect((await call({ ...ARGS, additionalInformation })).isError).not.toBe(true);
    }
  });
});

describe('create_payment input validation', () => {
  it.each([
    [
      'neither amount nor fullPayment',
      { number: 'INV-1', transactionType: 'bank' },
      'Provide exactly one of amount or fullPayment.',
    ],
    [
      'both amount and fullPayment',
      { ...ARGS, fullPayment: true },
      'Provide exactly one of amount or fullPayment.',
    ],
    [
      'fullPayment false without amount',
      { number: 'INV-1', transactionType: 'bank', fullPayment: false },
      'fullPayment',
    ],
    [
      'a breakdown for bank',
      { ...ARGS, transactionType: 'bank', amount: { capital: 1, fee: 1 } },
      'only for direct_payment and good_will',
    ],
    [
      'a breakdown for reminder_fee_waiver',
      { ...ARGS, transactionType: 'reminder_fee_waiver', amount: { fee: 1 } },
      'only for direct_payment and good_will',
    ],
    ['an amount of 0', { ...ARGS, amount: 0 }, 'amount'],
    ['a negative amount', { ...ARGS, amount: -1 }, 'amount'],
    ['an amount with 3 decimals', { ...ARGS, amount: 10.005 }, 'at most 2 decimals'],
    ['a non-finite amount', { ...ARGS, amount: 'NaN' }, 'amount'],
    ['a string amount', { ...ARGS, amount: '10' }, 'amount'],
    [
      'a breakdown with all parts 0',
      { ...ARGS, amount: { capital: 0, fee: 0 } },
      'amount must be more than 0',
    ],
    ['an empty breakdown', { ...ARGS, amount: {} }, 'amount'],
    ['a negative capital', { ...ARGS, amount: { capital: -1, fee: 5 } }, 'capital'],
    ['a negative fee', { ...ARGS, amount: { capital: 5, fee: -1 } }, 'fee'],
    ['a capital with 3 decimals', { ...ARGS, amount: { capital: 1.001 } }, 'at most 2 decimals'],
    ['a fee with 3 decimals', { ...ARGS, amount: { fee: 1.001 } }, 'at most 2 decimals'],
    [
      'an unknown breakdown key',
      { ...ARGS, amount: { capital: 1, interest: 1 } },
      'Unrecognized key: "interest"',
    ],
    ['credit_loss', { ...ARGS, transactionType: 'credit_loss' }, 'transactionType'],
    ['cancelled', { ...ARGS, transactionType: 'cancelled' }, 'transactionType'],
    ['an unknown transactionType', { ...ARGS, transactionType: 'cash' }, 'transactionType'],
    ['a missing transactionType', { number: 'INV-1', amount: 1 }, 'transactionType'],
    ['a missing number', { transactionType: 'bank', amount: 1 }, 'number'],
    ['an empty number', { ...ARGS, number: '' }, 'number'],
    ['a number over 100 characters', { ...ARGS, number: 'x'.repeat(101) }, 'number'],
    ['a number with CR/LF', { ...ARGS, number: 'INV-1\r\nX: 1' }, 'number'],
    ['an id', { ...ARGS, id: '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b' }, 'Unrecognized key: "id"'],
    ['a clientId', { ...ARGS, clientId: 'other' }, 'Unrecognized key: "clientId"'],
    ['an unknown key', { ...ARGS, foo: 1 }, 'Unrecognized key: "foo"'],
    [
      'an empty additionalInformation',
      { ...ARGS, additionalInformation: '' },
      'additionalInformation',
    ],
    [
      'an additionalInformation over 100 characters',
      { ...ARGS, additionalInformation: 'x'.repeat(101) },
      'additionalInformation',
    ],
    [
      'a non-boolean confirmFeeAutoRemoval',
      { ...ARGS, confirmFeeAutoRemoval: 'yes' },
      'confirmFeeAutoRemoval',
    ],
  ])('rejects %s without calling the API', async (_label, args, fragment) => {
    const { inio, call } = await setup(impl());
    const result = await call(args);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Input validation error: /);
    expect(textOf(result)).toContain(fragment);
    expect(inio.post).not.toHaveBeenCalled();
    expect(inio.get).not.toHaveBeenCalled();
  });

  it.each(BAD_DATES)('rejects the paidDate %j', async (paidDate) => {
    const { inio, call } = await setup(impl());
    const result = await call({ ...ARGS, paidDate });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('paidDate');
    expect(inio.post).not.toHaveBeenCalled();
  });

  it.each(['..', '.'])('rejects the number %j as an invalid path segment', async (number) => {
    const { inio, call } = await setup(impl());
    const result = await call({ ...ARGS, number });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Invalid path segment');
    expect(inio.post).not.toHaveBeenCalled();
  });
});

describe('create_payment client id from the token', () => {
  it.each([
    ['no claim', { sub: 'svc' }],
    ['an empty claim', { inio_client_id: '' }],
    ['a non-string claim', { inio_client_id: 42 }],
  ])('fails before any POST when the token has %s', async (_l, claims) => {
    token = jwt(claims);
    const { inio, call } = await setup(impl());
    const result = await call(ARGS);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('inio_client_id');
    expect(textOf(result)).not.toContain('sig-secret');
    expect(inio.post).not.toHaveBeenCalled();
  });

  it.each([['not-a-jwt'], ['a.b.c'], ['a.!!!.c']])(
    'fails before any POST, without echoing the token, when the token is %j',
    async (bad) => {
      token = bad;
      const { inio, call } = await setup(impl());
      const result = await call(ARGS);
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('inio_client_id');
      expect(textOf(result)).not.toContain(bad);
      expect(inio.post).not.toHaveBeenCalled();
    },
  );

  it('reads the claim from each call, not once at registration', async () => {
    const { inio, call } = await setup(impl());
    await call(ARGS);
    token = jwt({ inio_client_id: 'second' });
    await call(ARGS);
    expect(inio.post.mock.calls[0]?.[1]).toMatchObject([{ clientId: CLIENT_ID }]);
    expect(inio.post.mock.calls[1]?.[1]).toMatchObject([{ clientId: 'second' }]);
  });
});

describe('create_payment output', () => {
  it('returns the payment with the invoice read back by number, redacted', async () => {
    const { inio, call } = await setup(impl());
    const result = await call(ARGS);
    expect(result.isError).not.toBe(true);
    expect(inio.get.mock.calls).toEqual([['/invoices/by-number/INV-1001']]);
    expect(JSON.parse(textOf(result))).toStrictEqual({
      paid: true,
      invoice: 'INV-1001',
      transactionType: 'direct_payment',
      amount: 10.5,
      paymentId: PAYMENT_ID,
      remainingAmount: '89.50',
      paymentStatus: 'partiallyPaid',
    });
    expect(textOf(result)).not.toContain('IBAN');
    expect(textOf(result)).not.toContain('customer.example');
  });

  it('reads the invoice back at the encoded by-number path', async () => {
    const { inio, call } = await setup(impl());
    await call({ ...ARGS, number: 'INV 1/2' });
    expect(inio.get.mock.calls[0]?.[0]).toBe('/invoices/by-number/INV%201%2F2');
  });

  it('reports fullPayment true instead of an amount', async () => {
    const { call } = await setup(impl());
    const result = await call({ number: 'INV-1001', transactionType: 'bank', fullPayment: true });
    expect(JSON.parse(textOf(result))).toStrictEqual({
      paid: true,
      invoice: 'INV-1001',
      transactionType: 'bank',
      fullPayment: true,
      paymentId: PAYMENT_ID,
      remainingAmount: '89.50',
      paymentStatus: 'partiallyPaid',
    });
  });

  it('echoes a breakdown amount', async () => {
    const { call } = await setup(impl());
    const result = await call({ ...ARGS, amount: { capital: 5, fee: 1 } });
    expect(JSON.parse(textOf(result))).toMatchObject({ amount: { capital: 5, fee: 1 } });
  });

  it('reports success with a read-back note when the read-back fails', async () => {
    const { call } = await setup({
      ...impl(),
      get: () => Promise.reject(new InioApiError(404, 'NOT_FOUND', 'No such invoice', 'c-2')),
    });
    const result = await call(ARGS);
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toStrictEqual({
      paid: true,
      invoice: 'INV-1001',
      transactionType: 'direct_payment',
      amount: 10.5,
      paymentId: PAYMENT_ID,
      readBack: 'Could not read the invoice back: NOT_FOUND: No such invoice (correlationId c-2)',
    });
  });

  it('reports success with a read-back note when the invoice payload is unusable', async () => {
    const { call } = await setup({ ...impl(), get: () => Promise.resolve({ foo: 1 }) });
    const result = await call(ARGS);
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toMatchObject({
      paid: true,
      readBack:
        'Could not read the invoice back: UPSTREAM_ERROR: Unexpected invoice payload from the Inio API.',
    });
  });

  it.each([
    ['a string', 'Success'],
    ['null', null],
    ['an empty object', {}],
    ['an empty array', []],
    ['an array of a non-string', [42]],
    ['an array of an empty string', ['']],
  ])('still reports success with a note when the 2xx body is %s', async (_l, body) => {
    const { call } = await setup({ ...impl(), post: () => Promise.resolve(body) });
    const result = await call(ARGS);
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toStrictEqual({
      paid: true,
      invoice: 'INV-1001',
      note: NOTE,
    });
  });

  it('still reports success with a note when the 2xx body is a string array of several ids', async () => {
    const { call } = await setup({ ...impl(), post: () => Promise.resolve(['a', 'b']) });
    const result = await call(ARGS);
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toStrictEqual({
      paid: true,
      invoice: 'INV-1001',
      note: NOTE,
    });
  });

  it.each([200, 299])(
    'reports success with a note for an InioApiError with status %s',
    async (status) => {
      const { call } = await setup({
        ...impl(),
        post: () =>
          Promise.reject(new InioApiError(status, 'UPSTREAM_ERROR', 'Unexpected response')),
      });
      const result = await call(ARGS);
      expect(result.isError).not.toBe(true);
      expect(JSON.parse(textOf(result))).toStrictEqual({
        paid: true,
        invoice: 'INV-1001',
        note: NOTE,
      });
    },
  );

  it('treats an InioApiError with status 300 as a plain error, without a note', async () => {
    const { call } = await setup({
      ...impl(),
      post: () => Promise.reject(new InioApiError(300, 'UPSTREAM_ERROR', 'Multiple choices')),
    });
    const result = await call(ARGS);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('UPSTREAM_ERROR: Multiple choices');
  });

  it('reports success with a note when the client throws an InioApiError with a 2xx status', async () => {
    const { inio, call } = await setup({
      ...impl(),
      post: () =>
        Promise.reject(
          new InioApiError(
            201,
            'UPSTREAM_ERROR',
            'Unexpected response from the Inio API (HTTP 201).',
          ),
        ),
    });
    const result = await call(ARGS);
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toStrictEqual({
      paid: true,
      invoice: 'INV-1001',
      note: NOTE,
    });
    expect(inio.post).toHaveBeenCalledTimes(1);
  });
});

describe('create_payment errors', () => {
  it.each([
    [
      'a validation rejection',
      new InioApiError(400, 'BAD_REQUEST', 'Amount exceeds the remaining amount', 'c-4'),
      'BAD_REQUEST: Amount exceeds the remaining amount (correlationId c-4)',
    ],
    [
      'a 499',
      new InioApiError(499, 'CLIENT_CLOSED', 'Closed request', 'c-7'),
      'CLIENT_CLOSED: Closed request (correlationId c-7)',
    ],
    [
      'an unknown invoice',
      new InioApiError(404, 'NOT_FOUND', 'Invoice not found', 'c-5'),
      'NOT_FOUND: Invoice not found (correlationId c-5)',
    ],
  ])('returns %s as the plain error text, without a retry hint', async (_l, error, text) => {
    const { call } = await setup({ ...impl(), post: () => Promise.reject(error) });
    const result = await call(ARGS);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(text);
  });

  it('returns field errors', async () => {
    const { call } = await setup({
      ...impl(),
      post: () =>
        Promise.reject(
          new InioApiError(400, 'VALIDATION_ERROR', 'Bad input', 'c-6', [
            { fieldName: '0.amount', message: 'Too large' },
          ]),
        ),
    });
    expect(textOf(await call(ARGS))).toBe(
      'VALIDATION_ERROR: Bad input (correlationId c-6) Fields: 0.amount: Too large',
    );
  });

  it.each([
    [
      'a timeout',
      new InioApiError(
        0,
        'TIMEOUT',
        'The Inio API did not respond within 30 s. The change may or may not have been applied; check before retrying.',
      ),
    ],
    [
      'a 500',
      new InioApiError(
        500,
        'INTERNAL_ERROR',
        'Server error The change may or may not have been applied; check before retrying.',
      ),
    ],
    [
      'a 502',
      new InioApiError(
        502,
        'UPSTREAM_ERROR',
        'Bad gateway The change may or may not have been applied; check before retrying.',
        'c-8',
      ),
    ],
    [
      'a 503',
      new InioApiError(
        503,
        'UNAVAILABLE',
        'Service unavailable The change may or may not have been applied; check before retrying.',
      ),
    ],
    [
      'a lost response',
      new InioApiError(
        0,
        'NETWORK_ERROR',
        'Could not reach the Inio API. The change may or may not have been applied; check before retrying.',
      ),
    ],
  ])(
    'keeps %s an error and tells the model to check remainingAmount before any retry',
    async (_l, error) => {
      const { call, inio } = await setup({ ...impl(), post: () => Promise.reject(error) });
      const result = await call(ARGS);
      expect(result.isError).toBe(true);
      const text = textOf(result);
      expect(text.startsWith(`${error.code}: ${error.message}`)).toBe(true);
      expect(text).toContain('get_invoice');
      expect(text).toContain('remainingAmount');
      expect(text.split('may or may not')).toHaveLength(2);
      expect(text.indexOf('check before retrying.')).toBeLessThan(text.indexOf('get_invoice'));
      expect(inio.post).toHaveBeenCalledTimes(1);
    },
  );
});

describe('create_payment tool-call logging', () => {
  it('logs one tool call line with outcome ok and no input values, token or client id', async () => {
    const { call, logger } = await setup(impl());
    const bytes = Buffer.byteLength(
      textOf(await call({ ...ARGS, additionalInformation: 'secret-note' })),
      'utf8',
    );
    expect(logger.info.mock.calls).toEqual([
      [
        {
          tool: 'create_payment',
          durationMs: expect.any(Number),
          outcome: 'ok',
          responseBytes: bytes,
          approxTokens: Math.ceil(bytes / 4),
        },
        'tool call',
      ],
    ]);
    const logged = JSON.stringify(logger.info.mock.calls);
    for (const leak of ['secret-note', CLIENT_ID, 'sig-secret', TOKEN]) {
      expect(logged).not.toContain(leak);
    }
  });

  it('logs outcome error and never the token when the claim is missing', async () => {
    token = jwt({ sub: 'svc' });
    const { call, logger } = await setup(impl());
    await call(ARGS);
    expect(logger.info.mock.calls[0]?.[0]).toMatchObject({
      tool: 'create_payment',
      outcome: 'error',
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('sig-secret');
  });
});

describe('create_payment through the real client', () => {
  const real = (fetchImpl: typeof globalThis.fetch) =>
    createInioClient({
      apiUrl: 'https://api.example/v1',
      tokens: { getToken: () => Promise.resolve(TOKEN), invalidate: () => undefined },
      fetch: fetchImpl,
      logger: { debug: () => undefined, warn: () => undefined },
      sleep: () => Promise.resolve(),
    });
  const run = async (fetchImpl: typeof globalThis.fetch) => {
    const client = real(fetchImpl);
    const { call } = await setup({
      post: (path, body, options) => client.post(path, body, options),
      get: () => Promise.reject(new Error('read-back not expected')),
    });
    return call(ARGS);
  };
  const respond = (res: Response) => vi.fn<typeof globalThis.fetch>(() => Promise.resolve(res));

  it('reports success with a note when a 201 body is not JSON', async () => {
    const result = await run(respond(new Response('<html>created</html>', { status: 201 })));
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toEqual({ paid: true, invoice: 'INV-1001', note: NOTE });
  });

  it('reports success with a note when a 201 JSON body lacks the result envelope', async () => {
    const result = await run(
      respond(
        new Response(JSON.stringify([PAYMENT_ID]), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toEqual({ paid: true, invoice: 'INV-1001', note: NOTE });
  });

  it('sends the POST once to /payments with the token claim in the body', async () => {
    const f = respond(new Response('ok', { status: 201 }));
    await run(f);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] ?? [];
    expect(init?.method).toBe('POST');
    expect(url).toBe('https://api.example/v1/payments');
    expect(JSON.parse(z.string().parse(init?.body))).toEqual([
      {
        clientId: CLIENT_ID,
        invoiceNo: 'INV-1001',
        transactionType: 'direct_payment',
        amount: 10.5,
      },
    ]);
  });

  it('still fails on a 400 error envelope, without a retry hint', async () => {
    const result = await run(
      respond(
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
      ),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('VALIDATION_ERROR: Bad input (correlationId c-9)');
  });

  it('keeps a timeout an error that points at get_invoice remainingAmount', async () => {
    const f = vi.fn<typeof globalThis.fetch>(() =>
      Promise.reject(new DOMException('timed out', 'TimeoutError')),
    );
    const result = await run(f);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('TIMEOUT');
    expect(textOf(result)).toContain('get_invoice');
    expect(textOf(result)).toContain('remainingAmount');
    expect(f).toHaveBeenCalledTimes(1);
  });
});
