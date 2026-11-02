import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CUSTOMER_KEYS, INVOICE_KEYS, unreviewedKeys } from '../response-keys.ts';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../integration/fixtures/${name}`, import.meta.url), 'utf8'));

describe('reviewed response keys', () => {
  it('customer fixture has no unreviewed keys', () => {
    expect(unreviewedKeys(fixture('customer.json'), CUSTOMER_KEYS)).toEqual([]);
  });

  it('invoice fixture has no unreviewed keys', () => {
    expect(unreviewedKeys(fixture('invoice.json'), INVOICE_KEYS)).toEqual([]);
  });

  it('customer fixture is a business customer', () => {
    expect(fixture('customer.json')).toMatchObject({ customerType: 'B' });
  });

  it('finds a new top-level key', () => {
    expect(unreviewedKeys({ id: 'x', birthDate: '1990' }, CUSTOMER_KEYS)).toEqual(['birthDate']);
  });

  it('finds a new key at depth and inside arrays, sorted and deduplicated', () => {
    const payload = {
      customerAddress: { city: 'x', floor: 3 },
      list: [{ nested: { zeta: 1 } }, { alpha: 1 }, { alpha: 2 }],
    };
    expect(unreviewedKeys(payload, new Set(['customerAddress', 'city', 'list']))).toEqual([
      'alpha',
      'floor',
      'nested',
      'zeta',
    ]);
  });

  it('does not fail when reviewed keys are absent from the payload', () => {
    expect(unreviewedKeys({ id: 'x' }, CUSTOMER_KEYS)).toEqual([]);
    expect(unreviewedKeys({}, INVOICE_KEYS)).toEqual([]);
  });

  it('ignores primitives and null', () => {
    expect(unreviewedKeys(null, CUSTOMER_KEYS)).toEqual([]);
    expect(unreviewedKeys('text', CUSTOMER_KEYS)).toEqual([]);
  });

  it('matches keys case-sensitively', () => {
    expect(unreviewedKeys({ CUSTOMERNAME: 'x' }, CUSTOMER_KEYS)).toEqual(['CUSTOMERNAME']);
  });
});
