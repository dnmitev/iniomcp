import { afterEach, describe, expect, it } from 'vitest';
import { registerUpdateCustomerPause } from '../../src/tools/update-customer-pause.ts';
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
  scope: 'both',
  startAt: '2026-12-01',
  endAt: '2027-01-15',
  status: 'scheduled',
  reason: 'Extended',
  createdBy: 'inio-mcp',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-02T00:00:00Z',
};
const API_PAUSE = { ...PAUSE, temporalWorkflowId: 'wf-secret-123' };
const BASE = { customerId: CID, pauseId: PID, reason: 'Extended' };
const PATH = `/customers/${CID}/pauses/${PID}`;

const { setup, close } = makeHarness(registerUpdateCustomerPause, 'update_customer_pause');
afterEach(close);

const updated = () => Promise.resolve(API_PAUSE);

describe('update_customer_pause registration', () => {
  it('lists the tool with title Update customer pause', async () => {
    const { client } = await setup({ patch: updated });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['update_customer_pause']);
    expect(tools[0]?.title).toBe('Update customer pause');
  });

  it('is annotated as a non-read-only, destructive, non-idempotent, open-world tool', async () => {
    const { client } = await setup({ patch: updated });
    const { tools } = await client.listTools();
    expect(tools[0]?.annotations).toMatchObject(WRITE_ANNOTATIONS);
  });

  it('advertises a strict schema; customerId, pauseId and reason are required', async () => {
    const { client } = await setup({ patch: updated });
    const { tools } = await client.listTools();
    const schema = tools[0]?.inputSchema;
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([
      'customerId',
      'endAt',
      'pauseId',
      'reason',
      'scope',
      'startAt',
    ]);
    expect([...(schema?.required ?? [])].sort()).toEqual(['customerId', 'pauseId', 'reason']);
    expect(schema).toMatchObject({
      additionalProperties: false,
      properties: {
        customerId: { type: 'string', format: 'uuid' },
        pauseId: { type: 'string', format: 'uuid' },
        scope: { enum: ['reminders', 'dcTransfers', 'both'] },
      },
    });
  });
});

describe('update_customer_pause request', () => {
  it('patches only the provided keys plus reason', async () => {
    const { inio, call } = await setup({ patch: updated });
    await call({ ...BASE, endAt: '2027-01-15' });
    expect(inio.patch).toHaveBeenCalledTimes(1);
    expect(inio.patch).toHaveBeenCalledWith(PATH, { endAt: '2027-01-15', reason: 'Extended' });
  });

  it('sends endAt null to make the pause indefinite', async () => {
    const { inio, call } = await setup({ patch: updated });
    await call({ ...BASE, endAt: null });
    expect(inio.patch).toHaveBeenCalledWith(PATH, { endAt: null, reason: 'Extended' });
  });

  it('sends startAt, endAt and scope together', async () => {
    const { inio, call } = await setup({ patch: updated });
    await call({ ...BASE, startAt: '2026-12-01', endAt: '2027-01-15', scope: 'both' });
    expect(inio.patch).toHaveBeenCalledWith(PATH, {
      startAt: '2026-12-01',
      endAt: '2027-01-15',
      scope: 'both',
      reason: 'Extended',
    });
  });

  it('sends scope alone', async () => {
    const { inio, call } = await setup({ patch: updated });
    await call({ ...BASE, scope: 'dcTransfers' });
    expect(inio.patch).toHaveBeenCalledWith(PATH, { scope: 'dcTransfers', reason: 'Extended' });
  });

  it('sends startAt alone', async () => {
    const { inio, call } = await setup({ patch: updated });
    await call({ ...BASE, startAt: '2026-12-05' });
    expect(inio.patch).toHaveBeenCalledWith(PATH, { startAt: '2026-12-05', reason: 'Extended' });
  });

  it.each(GOOD_DATES)('accepts the endAt %s', async (endAt) => {
    const { call } = await setup({ patch: updated });
    expect((await call({ ...BASE, endAt })).isError).not.toBe(true);
  });
});

describe('update_customer_pause input validation', () => {
  it.each([
    ['nothing to change', BASE, 'Provide at least one of startAt, endAt or scope.'],
    ['a missing reason', { customerId: CID, pauseId: PID, endAt: '2027-01-15' }, 'reason'],
    ['an empty reason', { ...BASE, reason: '', endAt: '2027-01-15' }, 'reason'],
    [
      'a reason over 255 characters',
      { ...BASE, reason: 'x'.repeat(256), endAt: '2027-01-15' },
      'reason',
    ],
    ['a non-uuid customerId', { ...BASE, customerId: 'c-1', endAt: '2027-01-15' }, 'customerId'],
    ['a non-uuid pauseId', { ...BASE, pauseId: '../x', endAt: '2027-01-15' }, 'pauseId'],
    ['an unknown scope', { ...BASE, scope: 'payments' }, 'scope'],
    ['an unknown key', { ...BASE, endAt: '2027-01-15', foo: 1 }, 'Unrecognized key: "foo"'],
    [
      'endAt equal to startAt',
      { ...BASE, startAt: '2026-12-01', endAt: '2026-12-01' },
      'endAt must be after startAt.',
    ],
    [
      'endAt before startAt',
      { ...BASE, startAt: '2026-12-02', endAt: '2026-12-01' },
      'endAt must be after startAt.',
    ],
    ['a null startAt', { ...BASE, startAt: null }, 'startAt'],
  ])('rejects %s without calling the API', async (_label, args, fragment) => {
    const { inio, call } = await setup({ patch: updated });
    const result = await call(args);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Input validation error: /);
    expect(textOf(result)).toContain(fragment);
    expect(inio.patch).not.toHaveBeenCalled();
  });

  it('accepts endAt null together with startAt, since null means indefinite', async () => {
    const { inio, call } = await setup({ patch: updated });
    const result = await call({ ...BASE, startAt: '2026-12-01', endAt: null });
    expect(result.isError).not.toBe(true);
    expect(inio.patch).toHaveBeenCalledWith(PATH, {
      startAt: '2026-12-01',
      endAt: null,
      reason: 'Extended',
    });
  });

  it.each(BAD_DATES)('rejects the startAt %j', async (startAt) => {
    const { inio, call } = await setup({ patch: updated });
    const result = await call({ ...BASE, startAt });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('startAt');
    expect(inio.patch).not.toHaveBeenCalled();
  });

  it.each(BAD_DATES)('rejects the endAt %j', async (endAt) => {
    const { inio, call } = await setup({ patch: updated });
    const result = await call({ ...BASE, endAt });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('endAt');
    expect(inio.patch).not.toHaveBeenCalled();
  });
});

describe('update_customer_pause output', () => {
  it('returns the updated pause without temporalWorkflowId', async () => {
    const { call } = await setup({ patch: updated });
    const result = await call({ ...BASE, endAt: '2027-01-15' });
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toBe(JSON.stringify(PAUSE));
    expect(textOf(result)).not.toContain('wf-secret-123');
  });

  it('redacts an email in createdBy', async () => {
    const pause = { ...API_PAUSE, createdBy: 'jane@home.example' };
    const { call } = await setup({ patch: () => Promise.resolve(pause) });
    const text = textOf(await call({ ...BASE, endAt: '2027-01-15' }));
    expect(text).toContain('[redacted-email]');
    expect(text).not.toContain('jane@home.example');
  });
});

describe('update_customer_pause errors', () => {
  it.each([
    ['null', null],
    ['an array', [API_PAUSE]],
    ['a string', 'Success'],
  ])('rejects %s as an unexpected pause payload', async (_label, payload) => {
    const { call } = await setup({ patch: () => Promise.resolve(payload) });
    const result = await call({ ...BASE, endAt: '2027-01-15' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('UPSTREAM_ERROR: Unexpected pause payload from the Inio API.');
  });

  it('returns API errors with their field errors', async () => {
    const { call } = await setup({
      patch: () =>
        Promise.reject(
          new InioApiError(400, 'VALIDATION_ERROR', 'Pause is active', 'c-8', [
            { fieldName: 'startAt', message: 'Cannot change an active pause' },
          ]),
        ),
    });
    expect(textOf(await call({ ...BASE, startAt: '2026-12-02' }))).toBe(
      'VALIDATION_ERROR: Pause is active (correlationId c-8) Fields: startAt: Cannot change an active pause',
    );
  });

  it('returns an overlap conflict as the API error text', async () => {
    const { call } = await setup({
      patch: () => Promise.reject(new InioApiError(409, 'CONFLICT', 'Pause overlaps', 'c-9')),
    });
    expect(textOf(await call({ ...BASE, scope: 'both' }))).toBe(
      'CONFLICT: Pause overlaps (correlationId c-9)',
    );
  });
});

describe('update_customer_pause tool-call logging', () => {
  it('logs one tool call line with outcome ok', async () => {
    const { call, logger } = await setup({ patch: updated });
    const bytes = Buffer.byteLength(textOf(await call({ ...BASE, endAt: '2027-01-15' })), 'utf8');
    expect(logger.info.mock.calls).toEqual([
      [
        {
          tool: 'update_customer_pause',
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
