import { afterEach, describe, expect, it } from 'vitest';
import { registerResetInvoiceStage } from '../../src/tools/reset-invoice-stage.ts';
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
const PLAN = {
  targetStage: 'invoiced',
  dueDate: '2026-12-15',
  plannedSteps: ['cancelReminders', 'setDueDate'],
  feeWaiveAmount: '50.00',
  feePaidKept: '0.00',
  willWaiveOutstandingFee: true,
  willRedistribute: false,
  willReRunSetup: true,
};
const API_PLAN = { ...PLAN, workflowId: 'wf-secret-123' };
const ARGS = { id: ID, targetStage: 'invoiced', dueDate: '2026-12-15', reason: 'Wrong amount' };
const POST_PATH = `/invoices/${ID}/reset-stage`;

const { setup, close } = makeHarness(registerResetInvoiceStage, 'reset_invoice_stage');
afterEach(close);

const impl = () => ({
  get: () => Promise.resolve({ id: ID, invoiceNo: 'INV-1001' }),
  post: () => Promise.resolve(API_PLAN),
});

describe('reset_invoice_stage registration', () => {
  it('lists the tool with title Reset invoice stage', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['reset_invoice_stage']);
    expect(tools[0]?.title).toBe('Reset invoice stage');
  });

  it('is annotated as a non-read-only, destructive, non-idempotent, open-world tool', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    expect(tools[0]?.annotations).toMatchObject(WRITE_ANNOTATIONS);
  });

  it('warns about waived fees, re-sending and irreversibility', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    const description = tools[0]?.description ?? '';
    expect(description).toContain('outstanding fees may be waived');
    expect(description).toContain('redistribute: true re-sends');
    expect(description).toContain('cannot be undone with these tools');
  });

  it('advertises a strict schema with redistribute defaulting to false', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    const schema = tools[0]?.inputSchema;
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([
      'dueDate',
      'id',
      'number',
      'reason',
      'redistribute',
      'targetStage',
    ]);
    expect([...(schema?.required ?? [])].sort()).toEqual(['reason', 'targetStage']);
    expect(schema).toMatchObject({
      additionalProperties: false,
      properties: {
        id: { type: 'string', format: 'uuid' },
        number: { type: 'string', minLength: 1, maxLength: 100 },
        targetStage: { enum: ['invoiced', 'reminded'] },
        reason: { type: 'string', minLength: 1, maxLength: 100 },
        redistribute: { type: 'boolean', default: false },
      },
    });
  });
});

describe('reset_invoice_stage request', () => {
  it('posts to /invoices/<id>/reset-stage by id without a lookup', async () => {
    const { inio, call } = await setup(impl());
    await call(ARGS);
    expect(inio.get).not.toHaveBeenCalled();
    expect(inio.post).toHaveBeenCalledTimes(1);
    expect(inio.post.mock.calls[0]).toStrictEqual([
      POST_PATH,
      {
        targetStage: 'invoiced',
        dueDate: '2026-12-15',
        reason: 'Wrong amount',
        redistribute: false,
      },
    ]);
  });

  it('omits dueDate for reminded and always sends redistribute', async () => {
    const { inio, call } = await setup(impl());
    await call({ id: ID, targetStage: 'reminded', reason: 'Back to reminder' });
    expect(inio.post.mock.calls[0]?.[1]).toStrictEqual({
      targetStage: 'reminded',
      reason: 'Back to reminder',
      redistribute: false,
    });
  });

  it('sends redistribute true when asked', async () => {
    const { inio, call } = await setup(impl());
    await call({ ...ARGS, redistribute: true });
    expect(inio.post.mock.calls[0]?.[1]).toStrictEqual({
      targetStage: 'invoiced',
      dueDate: '2026-12-15',
      reason: 'Wrong amount',
      redistribute: true,
    });
  });

  it('looks the invoice id up by number first, then posts by the returned id', async () => {
    const order: string[] = [];
    const { inio, call } = await setup({
      get: () => {
        order.push('get');
        return Promise.resolve({ id: ID, invoiceNo: 'INV 1/2' });
      },
      post: () => {
        order.push('post');
        return Promise.resolve(API_PLAN);
      },
    });
    await call({ number: 'INV 1/2', targetStage: 'reminded', reason: 'r' });
    expect(order).toEqual(['get', 'post']);
    expect(inio.get).toHaveBeenCalledWith('/invoices/by-number/INV%201%2F2');
    expect(inio.post.mock.calls[0]?.[0]).toBe(POST_PATH);
  });

  it.each(GOOD_DATES)('accepts the dueDate %s for invoiced', async (dueDate) => {
    const { call } = await setup(impl());
    expect((await call({ ...ARGS, dueDate })).isError).not.toBe(true);
  });

  it('accepts reasons of exactly 1 and 100 characters', async () => {
    const { call } = await setup(impl());
    expect((await call({ ...ARGS, reason: 'x' })).isError).not.toBe(true);
    expect((await call({ ...ARGS, reason: 'x'.repeat(100) })).isError).not.toBe(true);
  });
});

describe('reset_invoice_stage input validation', () => {
  it.each([
    [
      'neither id nor number',
      { targetStage: 'reminded', reason: 'r' },
      'Provide exactly one of id or number.',
    ],
    [
      'both id and number',
      { id: ID, number: 'INV-1', targetStage: 'reminded', reason: 'r' },
      'Provide exactly one of id or number.',
    ],
    ['a non-uuid id', { id: 'inv-1', targetStage: 'reminded', reason: 'r' }, 'id'],
    [
      'a number with CR/LF',
      { number: 'INV-1\r\nX: 1', targetStage: 'reminded', reason: 'r' },
      'number',
    ],
    ['an empty number', { number: '', targetStage: 'reminded', reason: 'r' }, 'number'],
    [
      'a number over 100 characters',
      { number: 'x'.repeat(101), targetStage: 'reminded', reason: 'r' },
      'number',
    ],
    ['a missing targetStage', { id: ID, reason: 'r' }, 'targetStage'],
    ['an unknown targetStage', { id: ID, targetStage: 'paid', reason: 'r' }, 'targetStage'],
    ['a missing reason', { id: ID, targetStage: 'reminded' }, 'reason'],
    ['an empty reason', { id: ID, targetStage: 'reminded', reason: '' }, 'reason'],
    [
      'a reason over 100 characters',
      { id: ID, targetStage: 'reminded', reason: 'x'.repeat(101) },
      'reason',
    ],
    [
      'a non-boolean redistribute',
      { id: ID, targetStage: 'reminded', reason: 'r', redistribute: 'yes' },
      'redistribute',
    ],
    [
      'a missing dueDate for invoiced',
      { id: ID, targetStage: 'invoiced', reason: 'r' },
      'dueDate is required when targetStage is invoiced.',
    ],
    [
      'a dueDate for reminded',
      { id: ID, targetStage: 'reminded', reason: 'r', dueDate: '2026-12-15' },
      'dueDate is not allowed when targetStage is reminded.',
    ],
    [
      'modifyInvoice',
      { id: ID, targetStage: 'reminded', reason: 'r', modifyInvoice: true },
      'Unrecognized key: "modifyInvoice"',
    ],
    [
      'an unknown key',
      { id: ID, targetStage: 'reminded', reason: 'r', foo: 1 },
      'Unrecognized key: "foo"',
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

  it.each(BAD_DATES.filter((d) => d !== ''))('rejects the dueDate %j', async (dueDate) => {
    const { inio, call } = await setup(impl());
    const result = await call({ ...ARGS, dueDate });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('dueDate');
    expect(inio.post).not.toHaveBeenCalled();
  });

  it.each(['..', '.'])('rejects the number %j as an invalid path segment', async (number) => {
    const { inio, call } = await setup(impl());
    const result = await call({ number, targetStage: 'reminded', reason: 'r' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Invalid path segment');
    expect(inio.post).not.toHaveBeenCalled();
  });
});

describe('reset_invoice_stage lookup failures', () => {
  const BY_NUMBER = { number: 'INV-1001', targetStage: 'reminded', reason: 'r' };

  it.each([
    ['null', null],
    ['an array', [{ id: ID }]],
    ['an object without id', { invoiceNo: 'INV-1001' }],
    ['a numeric id', { id: 5 }],
    ['an empty id', { id: '' }],
    ['a path-traversal id', { id: '../x' }],
    ['a non-uuid id', { id: 'not-a-uuid' }],
  ])('rejects a lookup response that is %s and does not post', async (_label, found) => {
    const { inio, call } = await setup({
      get: () => Promise.resolve(found),
      post: () => Promise.resolve(API_PLAN),
    });
    const result = await call(BY_NUMBER);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('UPSTREAM_ERROR: Unexpected invoice payload from the Inio API.');
    expect(inio.post).not.toHaveBeenCalled();
  });

  it('returns a failed lookup as the API error text and does not post', async () => {
    const { inio, call } = await setup({
      get: () => Promise.reject(new InioApiError(404, 'NOT_FOUND', 'No such invoice', 'c-3')),
      post: () => Promise.resolve(API_PLAN),
    });
    const result = await call(BY_NUMBER);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('NOT_FOUND: No such invoice (correlationId c-3)');
    expect(inio.post).not.toHaveBeenCalled();
  });
});

describe('reset_invoice_stage output', () => {
  it('returns the plan without workflowId', async () => {
    const { call } = await setup(impl());
    const result = await call(ARGS);
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toStrictEqual(PLAN);
    expect(textOf(result)).not.toContain('workflowId');
    expect(textOf(result)).not.toContain('wf-secret-123');
  });

  it('keeps false booleans and drops empty plan fields', async () => {
    const { call } = await setup({
      post: () =>
        Promise.resolve({
          ...API_PLAN,
          plannedSteps: [],
          feePaidKept: '',
          willRedistribute: false,
        }),
    });
    const parsed: unknown = JSON.parse(textOf(await call(ARGS)));
    const { plannedSteps: _p, feePaidKept: _f, ...rest } = PLAN;
    expect(parsed).toStrictEqual(rest);
  });

  it.each([
    ['null', null],
    ['an array', [API_PLAN]],
    ['a string', 'Success'],
  ])('reports success with a note when the plan is %s', async (_label, plan) => {
    const { call } = await setup({ post: () => Promise.resolve(plan) });
    const result = await call(ARGS);
    expectAcceptedNote(result);
  });
});

describe('reset_invoice_stage lookup is not an accepted write', () => {
  it('reports an unreadable by-number lookup as an error, without posting', async () => {
    const { inio, call } = await setup({
      get: () => Promise.reject(new InioApiError(200, 'UPSTREAM_ERROR', 'Unexpected response')),
      post: () => Promise.resolve(API_PLAN),
    });
    const result = await call({ number: 'INV-1001', targetStage: 'reminded', reason: 'r' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).not.toContain('accepted');
    expect(inio.post).not.toHaveBeenCalled();
  });
});

describe('reset_invoice_stage errors', () => {
  it('returns a business-rule rejection as the API error text', async () => {
    const { call } = await setup({
      post: () => Promise.reject(new InioApiError(400, 'BAD_REQUEST', 'Invoice is paid', 'c-4')),
    });
    const result = await call(ARGS);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('BAD_REQUEST: Invoice is paid (correlationId c-4)');
  });

  it('returns field errors', async () => {
    const { call } = await setup({
      post: () =>
        Promise.reject(
          new InioApiError(400, 'VALIDATION_ERROR', 'Bad input', 'c-5', [
            { fieldName: 'dueDate', message: 'Must be in the future' },
          ]),
        ),
    });
    expect(textOf(await call(ARGS))).toBe(
      'VALIDATION_ERROR: Bad input (correlationId c-5) Fields: dueDate: Must be in the future',
    );
  });

  it('returns the uncertain-outcome timeout text verbatim', async () => {
    const message =
      'The Inio API did not respond within 30 s. The change may or may not have been applied; check before retrying.';
    const { call } = await setup({
      post: () => Promise.reject(new InioApiError(0, 'TIMEOUT', message)),
    });
    expect(textOf(await call(ARGS))).toBe(`TIMEOUT: ${message}`);
  });
});

describe('reset_invoice_stage tool-call logging', () => {
  it('logs one tool call line with outcome ok and no reason text', async () => {
    const { call, logger } = await setup(impl());
    const bytes = Buffer.byteLength(
      textOf(await call({ ...ARGS, reason: 'secret-reason' })),
      'utf8',
    );
    expect(logger.info.mock.calls).toEqual([
      [
        {
          tool: 'reset_invoice_stage',
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

describe('reset_invoice_stage accepted write with an unreadable answer', () => {
  it.each([200, 201, 299])(
    'reports success with a note when the client cannot read a %i answer',
    async (status) => {
      const err = new InioApiError(status, 'UPSTREAM_ERROR', 'Unexpected response');
      const { call } = await setup({ ...impl(), post: () => Promise.reject(err) });
      expectAcceptedNote(await call(ARGS));
    },
  );

  it('still reports a non-2xx client error as an error', async () => {
    const err = new InioApiError(400, 'BAD_REQUEST', 'Nope', 'c-1');
    const { call } = await setup({ ...impl(), post: () => Promise.reject(err) });
    const result = await call(ARGS);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('BAD_REQUEST: Nope (correlationId c-1)');
  });
});
