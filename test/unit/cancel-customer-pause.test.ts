import { afterEach, describe, expect, it } from 'vitest';
import { registerCancelCustomerPause } from '../../src/tools/cancel-customer-pause.ts';
import { InioApiError } from '../../src/inio-client.ts';
import {
  makeHarness,
  textOf,
  WRITE_ANNOTATIONS,
  expectAcceptedNote,
} from './helpers/write-tool.ts';

const CID = '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b';
const PID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const PAUSE = {
  id: PID,
  customerId: CID,
  scope: 'reminders',
  startAt: '2026-12-01',
  status: 'cancelled',
  reason: 'No longer needed',
  createdBy: 'inio-mcp',
};
const API_PAUSE = { ...PAUSE, temporalWorkflowId: 'wf-secret-123' };
const ARGS = { customerId: CID, pauseId: PID, reason: 'No longer needed' };

const { setup, close } = makeHarness(registerCancelCustomerPause, 'cancel_customer_pause');
afterEach(close);

const cancelled = () => Promise.resolve(API_PAUSE);

describe('cancel_customer_pause registration', () => {
  it('lists the tool with title Cancel customer pause', async () => {
    const { client } = await setup({ post: cancelled });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['cancel_customer_pause']);
    expect(tools[0]?.title).toBe('Cancel customer pause');
  });

  it('is annotated as a non-read-only, destructive, non-idempotent, open-world tool', async () => {
    const { client } = await setup({ post: cancelled });
    const { tools } = await client.listTools();
    expect(tools[0]?.annotations).toMatchObject(WRITE_ANNOTATIONS);
  });

  it('says in its description that the change cannot be undone', async () => {
    const { client } = await setup({ post: cancelled });
    const { tools } = await client.listTools();
    expect(tools[0]?.description ?? '').toContain('cannot be undone');
  });

  it('advertises a strict schema with customerId, pauseId and reason, all required', async () => {
    const { client } = await setup({ post: cancelled });
    const { tools } = await client.listTools();
    const schema = tools[0]?.inputSchema;
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([
      'customerId',
      'pauseId',
      'reason',
    ]);
    expect([...(schema?.required ?? [])].sort()).toEqual(['customerId', 'pauseId', 'reason']);
    expect(schema).toMatchObject({
      additionalProperties: false,
      properties: { reason: { type: 'string', minLength: 1, maxLength: 255 } },
    });
  });
});

describe('cancel_customer_pause request', () => {
  it('posts the reason to /customers/<cid>/pauses/<pid>/cancel', async () => {
    const { inio, call } = await setup({ post: cancelled });
    await call(ARGS);
    expect(inio.post).toHaveBeenCalledTimes(1);
    expect(inio.post).toHaveBeenCalledWith(`/customers/${CID}/pauses/${PID}/cancel`, {
      reason: 'No longer needed',
    });
  });

  it('accepts reasons of exactly 1 and 255 characters', async () => {
    const { call } = await setup({ post: cancelled });
    expect((await call({ ...ARGS, reason: 'x' })).isError).not.toBe(true);
    expect((await call({ ...ARGS, reason: 'x'.repeat(255) })).isError).not.toBe(true);
  });
});

describe('cancel_customer_pause input validation', () => {
  it.each([
    ['a missing reason', { customerId: CID, pauseId: PID }, 'reason'],
    ['an empty reason', { ...ARGS, reason: '' }, 'reason'],
    ['a reason over 255 characters', { ...ARGS, reason: 'x'.repeat(256) }, 'reason'],
    ['a missing pauseId', { customerId: CID, reason: 'r' }, 'pauseId'],
    ['a non-uuid pauseId', { ...ARGS, pauseId: '../x' }, 'pauseId'],
    ['a non-uuid customerId', { ...ARGS, customerId: 'c-1' }, 'customerId'],
    ['an unknown key', { ...ARGS, foo: 1 }, 'Unrecognized key: "foo"'],
  ])('rejects %s without calling the API', async (_label, args, fragment) => {
    const { inio, call } = await setup({ post: cancelled });
    const result = await call(args);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Input validation error: /);
    expect(textOf(result)).toContain(fragment);
    expect(inio.post).not.toHaveBeenCalled();
  });
});

describe('cancel_customer_pause output and errors', () => {
  it('returns the cancelled pause without temporalWorkflowId', async () => {
    const { call } = await setup({ post: cancelled });
    const result = await call(ARGS);
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toBe(JSON.stringify(PAUSE));
    expect(textOf(result)).not.toContain('wf-secret-123');
  });

  it.each([
    ['null', null],
    ['an array', [API_PAUSE]],
    ['a string', 'Success'],
  ])('reports success with a note when the answer is %s', async (_label, payload) => {
    const { call } = await setup({ post: () => Promise.resolve(payload) });
    expectAcceptedNote(await call(ARGS));
  });

  it('returns a rejection for an already completed pause as the API error text', async () => {
    const { call } = await setup({
      post: () =>
        Promise.reject(new InioApiError(400, 'BAD_REQUEST', 'Pause cannot be cancelled', 'c-2')),
    });
    expect(textOf(await call(ARGS))).toBe(
      'BAD_REQUEST: Pause cannot be cancelled (correlationId c-2)',
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

describe('cancel_customer_pause tool-call logging', () => {
  it('logs one tool call line with outcome ok and no reason text', async () => {
    const { call, logger } = await setup({ post: cancelled });
    const bytes = Buffer.byteLength(textOf(await call(ARGS)), 'utf8');
    expect(logger.info.mock.calls).toEqual([
      [
        {
          tool: 'cancel_customer_pause',
          durationMs: expect.any(Number),
          outcome: 'ok',
          responseBytes: bytes,
          approxTokens: Math.ceil(bytes / 4),
        },
        'tool call',
      ],
    ]);
  });
});

describe('cancel_customer_pause accepted write with an unreadable answer', () => {
  it.each([200, 201, 299])(
    'reports success with a note when the client cannot read a %i answer',
    async (status) => {
      const err = new InioApiError(status, 'UPSTREAM_ERROR', 'Unexpected response');
      const { call } = await setup({ post: () => Promise.reject(err) });
      expectAcceptedNote(await call(ARGS));
    },
  );

  it('still reports a non-2xx client error as an error', async () => {
    const err = new InioApiError(400, 'BAD_REQUEST', 'Nope', 'c-1');
    const { call } = await setup({ post: () => Promise.reject(err) });
    const result = await call(ARGS);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('BAD_REQUEST: Nope (correlationId c-1)');
  });
});
