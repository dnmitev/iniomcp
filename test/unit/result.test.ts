import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { InioApiError } from '../../src/inio-client.ts';
import {
  compact,
  errorText,
  fail,
  ok,
  PageInput,
  present,
  toPage,
} from '../../src/tools/result.ts';

describe('errorText', () => {
  it('formats an InioApiError as "<code>: <message> (correlationId <id>)"', () => {
    const err = new InioApiError(404, 'NOT_FOUND', 'Customer not found', 'c-9');
    expect(errorText(err)).toBe('NOT_FOUND: Customer not found (correlationId c-9)');
  });

  it('omits the correlationId suffix when the InioApiError has none', () => {
    expect(errorText(new InioApiError(0, 'NETWORK_ERROR', 'Cannot reach'))).toBe(
      'NETWORK_ERROR: Cannot reach',
    );
  });

  it('omits the correlationId suffix when the correlationId is empty', () => {
    expect(errorText(new InioApiError(500, 'X', 'boom', ''))).toBe('X: boom');
  });

  it('redacts an email in an InioApiError message and keeps code and correlationId', () => {
    const err = new InioApiError(404, 'NOT_FOUND', 'No invoice for a.b@x.example', 'c-1');
    expect(errorText(err)).toBe('NOT_FOUND: No invoice for [redacted-email] (correlationId c-1)');
  });

  it('appends the field errors after the correlation id', () => {
    const err = new InioApiError(400, 'VALIDATION_ERROR', 'Bad input', 'c-3', [
      { fieldName: 'startAt', message: 'Must be tomorrow or later' },
      { fieldName: '0.reason', message: 'Too short' },
    ]);
    expect(errorText(err)).toBe(
      'VALIDATION_ERROR: Bad input (correlationId c-3) Fields: startAt: Must be tomorrow or later; 0.reason: Too short',
    );
  });

  it('appends a single field error without a trailing separator', () => {
    const err = new InioApiError(400, 'VALIDATION_ERROR', 'Bad input', 'c-3', [
      { fieldName: 'reason', message: 'Required' },
    ]);
    expect(errorText(err)).toBe(
      'VALIDATION_ERROR: Bad input (correlationId c-3) Fields: reason: Required',
    );
  });

  it('appends the field errors when there is no correlation id', () => {
    const err = new InioApiError(400, 'VALIDATION_ERROR', 'Bad input', undefined, [
      { fieldName: 'reason', message: 'Required' },
    ]);
    expect(errorText(err)).toBe('VALIDATION_ERROR: Bad input Fields: reason: Required');
  });

  it('redacts an email inside a field error message', () => {
    const err = new InioApiError(400, 'VALIDATION_ERROR', 'Bad input', 'c-3', [
      { fieldName: 'note', message: 'jane@home.example is not allowed' },
    ]);
    const text = errorText(err);
    expect(text).toContain('Fields: note: [redacted-email] is not allowed');
    expect(text).not.toContain('jane@home.example');
  });

  it.each([
    '0.iban',
    'SSN',
    'customerAddress.zipCode',
    'distributionEmailAddress',
    'addressLine1',
    'a.b.mobilePhoneNo',
    'IBAN',
  ])('replaces the message of the sensitive field %s with [redacted]', (fieldName) => {
    const err = new InioApiError(400, 'VALIDATION_ERROR', 'Bad input', 'c-3', [
      { fieldName, message: 'SE1234567890 is not valid' },
    ]);
    const text = errorText(err);
    expect(text).toBe(
      `VALIDATION_ERROR: Bad input (correlationId c-3) Fields: ${fieldName}: [redacted]`,
    );
    expect(text).not.toContain('SE1234567890');
  });

  it('judges a field by its last segment only', () => {
    const err = new InioApiError(400, 'VALIDATION_ERROR', 'Bad input', 'c-3', [
      { fieldName: 'iban.format', message: 'Wrong format' },
    ]);
    expect(errorText(err)).toContain('Fields: iban.format: Wrong format');
  });

  it('keeps the message of non-sensitive fields', () => {
    const err = new InioApiError(400, 'VALIDATION_ERROR', 'Bad input', 'c-3', [
      { fieldName: '0.startAt', message: 'Must be tomorrow or later' },
      { fieldName: 'iban', message: 'secret' },
    ]);
    expect(errorText(err)).toBe(
      'VALIDATION_ERROR: Bad input (correlationId c-3) Fields: 0.startAt: Must be tomorrow or later; iban: [redacted]',
    );
  });

  const manyFields = (n: number) =>
    Array.from({ length: n }, (_v, i) => ({ fieldName: `f${i + 1}`, message: `m${i + 1}` }));
  const shown = (n: number) =>
    Array.from({ length: n }, (_v, i) => `f${i + 1}: m${i + 1}`).join('; ');

  it('shows exactly 10 field errors without a suffix', () => {
    const err = new InioApiError(400, 'V', 'Bad', 'c-3', manyFields(10));
    expect(errorText(err)).toBe(`V: Bad (correlationId c-3) Fields: ${shown(10)}`);
  });

  it('caps at 10 field errors and says how many more there are', () => {
    const err = new InioApiError(400, 'V', 'Bad', 'c-3', manyFields(12));
    expect(errorText(err)).toBe(`V: Bad (correlationId c-3) Fields: ${shown(10)}; … and 2 more`);
  });

  it('says "and 1 more" for 11 field errors', () => {
    const err = new InioApiError(400, 'V', 'Bad', 'c-3', manyFields(11));
    expect(errorText(err)).toBe(`V: Bad (correlationId c-3) Fields: ${shown(10)}; … and 1 more`);
  });

  it('leaves the text unchanged for an empty fieldErrors array', () => {
    const err = new InioApiError(400, 'VALIDATION_ERROR', 'Bad input', 'c-3', []);
    expect(errorText(err)).toBe('VALIDATION_ERROR: Bad input (correlationId c-3)');
  });

  it('redacts an email in a thrown non-Error string', () => {
    expect(errorText('failed for a.b@x.example')).toBe('failed for [redacted-email]');
  });

  it('redacts an email in a plain Error message', () => {
    expect(errorText(new Error('failed for jane@home.example today'))).toBe(
      'failed for [redacted-email] today',
    );
  });

  it('returns the message of a plain Error', () => {
    expect(errorText(new Error('plain failure'))).toBe('plain failure');
  });

  it('stringifies a non-Error value', () => {
    expect(errorText('raw string')).toBe('raw string');
    expect(errorText(42)).toBe('42');
  });
});

describe('ok and fail', () => {
  it('ok wraps text in a single text content item', () => {
    expect(ok('hello')).toStrictEqual({ content: [{ type: 'text', text: 'hello' }] });
  });

  it('fail wraps text in a single text content item flagged isError', () => {
    expect(fail('NOT_FOUND: x')).toStrictEqual({
      content: [{ type: 'text', text: 'NOT_FOUND: x' }],
      isError: true,
    });
  });
});

describe('compact', () => {
  it('removes keys whose values are null, undefined, "", [] or {}', () => {
    expect(compact({ a: null, b: undefined, c: '', d: [], e: {}, keep: 'x' })).toStrictEqual({
      keep: 'x',
    });
  });

  it('keeps false, 0 and non-empty strings', () => {
    expect(compact({ f: false, z: 0, s: ' ', t: 'x' })).toStrictEqual({
      f: false,
      z: 0,
      s: ' ',
      t: 'x',
    });
  });

  it('removes an object that becomes empty after compacting its children', () => {
    expect(compact({ a: { b: null }, keep: 1 })).toStrictEqual({ keep: 1 });
  });

  it('removes an array that becomes empty after compacting its entries', () => {
    expect(compact({ a: [null, '', {}], keep: 1 })).toStrictEqual({ keep: 1 });
  });

  it('compacts at any depth', () => {
    expect(compact({ a: { b: { c: { d: null, e: 1 } } } })).toStrictEqual({
      a: { b: { c: { e: 1 } } },
    });
  });

  it('removes empty entries from arrays and keeps false and 0', () => {
    expect(
      compact([null, undefined, '', [], {}, 0, false, 'x', { a: null }, [[null]]]),
    ).toStrictEqual([0, false, 'x']);
  });

  it('compacts objects inside arrays', () => {
    expect(
      compact([
        { id: 1, note: null },
        { id: 2, tags: [] },
      ]),
    ).toStrictEqual([{ id: 1 }, { id: 2 }]);
  });

  it('returns an empty object for a top-level object that compacts to nothing', () => {
    expect(compact({ a: null })).toStrictEqual({});
    expect(compact({})).toStrictEqual({});
  });

  it('returns an empty array for a top-level array that compacts to nothing', () => {
    expect(compact([null, ''])).toStrictEqual([]);
    expect(compact([])).toStrictEqual([]);
  });

  it.each([['x'], [0], [false], [12.5]])('returns the top-level scalar %j as-is', (value) => {
    expect(compact(value)).toBe(value);
  });

  it('does not mutate its input', () => {
    const input = { a: null, b: { c: '', d: [null, 1] }, e: [{}, 2] };
    const before = structuredClone(input);
    compact(input);
    expect(input).toStrictEqual(before);
  });

  it('returns a copy, not the same object', () => {
    const inner = { x: 1 };
    const input = { inner };
    const out = compact(input);
    expect(out).toStrictEqual(input);
    expect(out).not.toBe(input);
    expect(out !== null && typeof out === 'object' && 'inner' in out && out.inner).not.toBe(inner);
  });
});

describe('present', () => {
  it('compacts before redacting, so a null SSN is removed rather than "[redacted]"', () => {
    expect(present({ SSN: null, iban: 'SE12' }, false)).toBe('{"iban":"[redacted]"}');
  });

  it('skips redaction when revealPii is true', () => {
    expect(present({ SSN: null, iban: 'SE12' }, true)).toBe('{"iban":"SE12"}');
  });

  it('redacts email addresses inside string values', () => {
    expect(present({ note: 'mail a@b.com now' }, false)).toBe(
      '{"note":"mail [redacted-email] now"}',
    );
  });

  it('redacts nested PII after compaction', () => {
    expect(present({ customer: { name: 'A', iban: 'SE12', email: '' } }, false)).toBe(
      '{"customer":{"name":"A","iban":"[redacted]"}}',
    );
  });

  it('renders a fully empty object as "{}"', () => {
    expect(present({ a: null, b: [] }, false)).toBe('{}');
  });
});

describe('PageInput', () => {
  const Schema = z.strictObject({ ...PageInput });

  it('defaults limit to 25 and offset to 0', () => {
    expect(Schema.parse({})).toStrictEqual({ limit: 25, offset: 0 });
  });

  it.each([1, 100, 50])('accepts limit %d', (limit) => {
    expect(Schema.parse({ limit })).toStrictEqual({ limit, offset: 0 });
  });

  it.each([0, 101, 1.5, -1])('rejects limit %d', (limit) => {
    expect(Schema.safeParse({ limit }).success).toBe(false);
  });

  it('rejects a string limit', () => {
    expect(Schema.safeParse({ limit: '10' }).success).toBe(false);
  });

  it.each([0, 1, 10_000])('accepts offset %d', (offset) => {
    expect(Schema.parse({ offset })).toStrictEqual({ limit: 25, offset });
  });

  it.each([-1, 1.5])('rejects offset %d', (offset) => {
    expect(Schema.safeParse({ offset }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(Schema.safeParse({ limit: 10, page: 2 }).success).toBe(false);
  });

  it('describes limit and offset for the tool schema', () => {
    expect(PageInput.limit.description).toBe('Page size, 1-100');
    expect(PageInput.offset.description).toBe('Number of items to skip');
  });
});

describe('toPage', () => {
  const pick = (item: Record<string, unknown>) => ({ id: item.id });

  it('maps data items and returns total, limit and offset', () => {
    const page = toPage(
      {
        data: [
          { id: 1, x: 'a' },
          { id: 2, x: 'b' },
        ],
        total: 2,
        limit: 25,
        offset: 0,
      },
      pick,
    );
    expect(page).toStrictEqual({ items: [{ id: 1 }, { id: 2 }], total: 2, limit: 25, offset: 0 });
  });

  it('calls mapItem once per data item with that item', () => {
    const mapItem = vi.fn<(item: Record<string, unknown>) => unknown>((item) => item.id);
    toPage({ data: [{ id: 'a' }, { id: 'b' }], total: 2, limit: 2, offset: 0 }, mapItem);
    expect(mapItem.mock.calls.map(([item]) => item)).toStrictEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('sets nextOffset to offset + items.length when that is below total', () => {
    const page = toPage({ data: [{ id: 3 }, { id: 4 }], total: 5, limit: 2, offset: 2 }, pick);
    expect(page).toStrictEqual({
      items: [{ id: 3 }, { id: 4 }],
      total: 5,
      limit: 2,
      offset: 2,
      nextOffset: 4,
    });
  });

  it('bases nextOffset on items returned, not on limit', () => {
    const page = toPage({ data: [{ id: 1 }], total: 10, limit: 25, offset: 0 }, pick);
    expect(page).toHaveProperty('nextOffset', 1);
  });

  it('omits nextOffset when offset + items.length equals total', () => {
    const page = toPage({ data: [{ id: 4 }, { id: 5 }], total: 5, limit: 2, offset: 3 }, pick);
    expect(page).not.toHaveProperty('nextOffset');
  });

  it('omits nextOffset for an empty page', () => {
    const page = toPage({ data: [], total: 0, limit: 25, offset: 0 }, pick);
    expect(page).toStrictEqual({ items: [], total: 0, limit: 25, offset: 0 });
  });

  it('omits nextOffset for an empty page below total, so callers cannot loop forever', () => {
    const page = toPage({ data: [], total: 5, limit: 25, offset: 2 }, pick);
    expect(page).toStrictEqual({ items: [], total: 5, limit: 25, offset: 2 });
  });

  it('ignores extra payload keys', () => {
    const page = toPage({ data: [], total: 0, limit: 25, offset: 0, extra: 'x' }, pick);
    expect(page).toStrictEqual({ items: [], total: 0, limit: 25, offset: 0 });
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'x'],
    ['an object without data', { total: 0, limit: 25, offset: 0 }],
    ['non-array data', { data: {}, total: 0, limit: 25, offset: 0 }],
    ['missing total', { data: [], limit: 25, offset: 0 }],
    ['a string total', { data: [], total: '0', limit: 25, offset: 0 }],
    ['missing limit', { data: [], total: 0, offset: 0 }],
    ['a string limit', { data: [], total: 0, limit: '25', offset: 0 }],
    ['missing offset', { data: [], total: 0, limit: 25 }],
    ['a string offset', { data: [], total: 0, limit: 25, offset: '0' }],
  ])('throws UPSTREAM_ERROR for %s', (_label, payload) => {
    let err: InioApiError | undefined;
    try {
      toPage(payload, pick);
    } catch (e) {
      if (e instanceof InioApiError) err = e;
      else throw e;
    }
    if (!err) throw new Error('expected toPage to throw');
    expect(err.status).toBe(200);
    expect(err.code).toBe('UPSTREAM_ERROR');
    expect(err.message).toBe('Unexpected list payload from the Inio API.');
    expect(err.correlationId).toBeUndefined();
    expect(errorText(err)).toBe('UPSTREAM_ERROR: Unexpected list payload from the Inio API.');
  });
});
