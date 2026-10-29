import { afterEach, describe, expect, it } from 'vitest';
import { registerCreateCustomerPause } from '../../src/tools/create-customer-pause.ts';
import { InioApiError } from '../../src/inio-client.ts';
import {
  BAD_DATES,
  GOOD_DATES,
  makeHarness,
  textOf,
  WRITE_ANNOTATIONS,
} from './helpers/write-tool.ts';

const CID = '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b';
const PID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const PAUSE = {
  id: PID,
  customerId: CID,
  scope: 'reminders',
  startAt: '2026-12-01',
  endAt: '2026-12-31',
  status: 'scheduled',
  reason: 'Payment plan',
  createdBy: 'inio-mcp',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
};
const API_PAUSE = { ...PAUSE, temporalWorkflowId: 'wf-secret-123' };
const ARGS = {
  customerId: CID,
  scope: 'reminders',
  startAt: '2026-12-01',
  endAt: '2026-12-31',
  reason: 'Payment plan',
};

const { setup, close } = makeHarness(registerCreateCustomerPause, 'create_customer_pause');
afterEach(close);

const created = () => Promise.resolve(API_PAUSE);

describe('create_customer_pause registration', () => {
  it('lists the tool with title Create customer pause', async () => {
    const { client } = await setup({ post: created });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['create_customer_pause']);
    expect(tools[0]?.title).toBe('Create customer pause');
  });

  it('is annotated as a non-read-only, destructive, non-idempotent, open-world tool', async () => {
    const { client } = await setup({ post: created });
    const { tools } = await client.listTools();
    expect(tools[0]?.annotations).toMatchObject(WRITE_ANNOTATIONS);
  });

  it('advertises a strict schema with required customerId, scope, startAt and reason', async () => {
    const { client } = await setup({ post: created });
    const { tools } = await client.listTools();
    const schema = tools[0]?.inputSchema;
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([
      'customerId',
      'endAt',
      'reason',
      'scope',
      'startAt',
    ]);
    expect([...(schema?.required ?? [])].sort()).toEqual([
      'customerId',
      'reason',
      'scope',
      'startAt',
    ]);
    expect(schema).toMatchObject({
      additionalProperties: false,
      properties: {
        customerId: { type: 'string', format: 'uuid' },
        scope: { enum: ['reminders', 'dcTransfers', 'both'] },
        reason: { type: 'string', minLength: 1, maxLength: 255 },
      },
    });
  });
});

describe('create_customer_pause request', () => {
  it('posts scope, startAt, endAt and reason to /customers/<id>/pauses', async () => {
    const { inio, call } = await setup({ post: created });
    await call(ARGS);
    expect(inio.post).toHaveBeenCalledTimes(1);
    expect(inio.post).toHaveBeenCalledWith(`/customers/${CID}/pauses`, {
      scope: 'reminders',
      startAt: '2026-12-01',
      endAt: '2026-12-31',
      reason: 'Payment plan',
    });
  });

  it('omits endAt from the body for an indefinite pause', async () => {
    const { inio, call } = await setup({ post: created });
    const { endAt: _omit, ...args } = ARGS;
    await call(args);
    expect(inio.post).toHaveBeenCalledWith(`/customers/${CID}/pauses`, {
      scope: 'reminders',
      startAt: '2026-12-01',
      reason: 'Payment plan',
    });
  });

  it.each(['reminders', 'dcTransfers', 'both'])('accepts scope %s', async (scope) => {
    const { inio, call } = await setup({ post: created });
    expect((await call({ ...ARGS, scope })).isError).not.toBe(true);
    expect(inio.post).toHaveBeenCalledTimes(1);
  });

  it.each(GOOD_DATES)('accepts the date %s', async (startAt) => {
    const { call } = await setup({ post: created });
    expect((await call({ ...ARGS, startAt, endAt: '2030-01-01' })).isError).not.toBe(true);
  });

  it('accepts reasons of exactly 1 and 255 characters', async () => {
    const { call } = await setup({ post: created });
    expect((await call({ ...ARGS, reason: 'x' })).isError).not.toBe(true);
    expect((await call({ ...ARGS, reason: 'x'.repeat(255) })).isError).not.toBe(true);
  });
});

describe('create_customer_pause input validation', () => {
  it.each([
    ['a missing customerId', { ...ARGS, customerId: undefined }, 'customerId'],
    ['a non-uuid customerId', { ...ARGS, customerId: 'c-1' }, 'customerId'],
    ['a missing scope', { ...ARGS, scope: undefined }, 'scope'],
    ['an unknown scope', { ...ARGS, scope: 'payments' }, 'scope'],
    ['a missing startAt', { ...ARGS, startAt: undefined }, 'startAt'],
    ['a missing reason', { ...ARGS, reason: undefined }, 'reason'],
    ['an empty reason', { ...ARGS, reason: '' }, 'reason'],
    ['a reason over 255 characters', { ...ARGS, reason: 'x'.repeat(256) }, 'reason'],
    ['an unknown key', { ...ARGS, foo: 1 }, 'Unrecognized key: "foo"'],
    ['endAt equal to startAt', { ...ARGS, endAt: '2026-12-01' }, 'endAt must be after startAt.'],
    ['endAt before startAt', { ...ARGS, endAt: '2026-11-30' }, 'endAt must be after startAt.'],
    ['a null endAt', { ...ARGS, endAt: null }, 'endAt'],
  ])('rejects %s without calling the API', async (_label, args, fragment) => {
    const { inio, call } = await setup({ post: created });
    const result = await call(args);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Input validation error: /);
    expect(textOf(result)).toContain(fragment);
    expect(inio.post).not.toHaveBeenCalled();
  });

  it.each(BAD_DATES)('rejects the startAt %j', async (startAt) => {
    const { inio, call } = await setup({ post: created });
    const { endAt: _omit, ...args } = ARGS;
    const result = await call({ ...args, startAt });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('startAt');
    expect(inio.post).not.toHaveBeenCalled();
  });

  it.each(BAD_DATES)('rejects the endAt %j', async (endAt) => {
    const { inio, call } = await setup({ post: created });
    const result = await call({ ...ARGS, endAt });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('endAt');
    expect(inio.post).not.toHaveBeenCalled();
  });
});

describe('create_customer_pause output', () => {
  it('returns the created pause without temporalWorkflowId', async () => {
    const { call } = await setup({ post: created });
    const result = await call(ARGS);
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toBe(JSON.stringify(PAUSE));
    expect(textOf(result)).not.toContain('wf-secret-123');
  });

  it('redacts an email in createdBy, and keeps it with revealPii', async () => {
    const pause = { ...API_PAUSE, createdBy: 'jane@home.example' };
    const redacted = await setup({ post: () => Promise.resolve(pause) });
    const text = textOf(await redacted.call(ARGS));
    expect(text).toContain('"createdBy":"[redacted-email]"');
    expect(text).not.toContain('jane@home.example');
    const revealed = await setup({ post: () => Promise.resolve(pause) }, true);
    expect(textOf(await revealed.call(ARGS))).toContain('"createdBy":"jane@home.example"');
  });

  it('does not return structuredContent', async () => {
    const { call } = await setup({ post: created });
    expect((await call(ARGS)).structuredContent).toBeUndefined();
  });
});

describe('create_customer_pause errors', () => {
  it.each([
    ['null', null],
    ['an array', [API_PAUSE]],
    ['a string', 'Success'],
  ])('rejects %s as an unexpected pause payload', async (_label, payload) => {
    const { call } = await setup({ post: () => Promise.resolve(payload) });
    const result = await call(ARGS);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('UPSTREAM_ERROR: Unexpected pause payload from the Inio API.');
  });

  it('returns API validation errors with their field errors', async () => {
    const { call } = await setup({
      post: () =>
        Promise.reject(
          new InioApiError(400, 'VALIDATION_ERROR', 'Bad input', 'c-5', [
            { fieldName: 'startAt', message: 'Must be tomorrow or later' },
          ]),
        ),
    });
    const result = await call(ARGS);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'VALIDATION_ERROR: Bad input (correlationId c-5) Fields: startAt: Must be tomorrow or later',
    );
  });

  it('returns an overlap conflict as the API error text', async () => {
    const { call } = await setup({
      post: () => Promise.reject(new InioApiError(409, 'CONFLICT', 'Pause overlaps', 'c-6')),
    });
    expect(textOf(await call(ARGS))).toBe('CONFLICT: Pause overlaps (correlationId c-6)');
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

describe('create_customer_pause tool-call logging', () => {
  it('logs one tool call line with outcome ok and no request content', async () => {
    const { call, logger } = await setup({ post: created });
    const bytes = Buffer.byteLength(textOf(await call(ARGS)), 'utf8');
    expect(logger.info.mock.calls).toEqual([
      [
        {
          tool: 'create_customer_pause',
          durationMs: expect.any(Number),
          outcome: 'ok',
          responseBytes: bytes,
          approxTokens: Math.ceil(bytes / 4),
        },
        'tool call',
      ],
    ]);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('Payment plan');
  });

  it('logs outcome error when the API call fails', async () => {
    const { call, logger } = await setup({
      post: () => Promise.reject(new InioApiError(500, 'INTERNAL', 'Boom')),
    });
    await call(ARGS);
    expect(logger.info.mock.calls).toEqual([
      [expect.objectContaining({ tool: 'create_customer_pause', outcome: 'error' }), 'tool call'],
    ]);
  });
});
