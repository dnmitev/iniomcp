import { describe, expect, it } from 'vitest';
import {
  BUSINESS_SENSITIVE_KEYS,
  SENSITIVE_KEYS,
  isSensitiveKey,
  redact,
} from '../../src/redact.ts';

describe('redact', () => {
  it.each(['IBAN', 'SSN', 'bankAccount', 'accountNumber'])('redacts the %s key', (key) => {
    expect(redact({ [key]: 'secret', keep: 1 })).toEqual({ [key]: '[redacted]', keep: 1 });
  });

  it.each(['iban', 'Iban', 'ssn', 'Ssn', 'BANKACCOUNT', 'accountnumber'])(
    'matches %s case-insensitively',
    (key) => {
      expect(redact({ [key]: 'secret' })).toEqual({ [key]: '[redacted]' });
    },
  );

  it('redacts non-string values of sensitive keys', () => {
    expect(redact({ IBAN: { country: 'BG', value: 'x' }, SSN: 123, bankAccount: null })).toEqual({
      IBAN: '[redacted]',
      SSN: '[redacted]',
      bankAccount: '[redacted]',
    });
  });

  it('redacts sensitive keys at any depth', () => {
    expect(redact({ a: { b: { c: { IBAN: 'x', name: 'n' } } } })).toEqual({
      a: { b: { c: { IBAN: '[redacted]', name: 'n' } } },
    });
  });

  it('redacts sensitive keys inside arrays of objects', () => {
    expect(
      redact({ payments: [{ iban: 'x', amount: 1 }, { accountNumber: 'y' }, 'plain', 7] }),
    ).toEqual({
      payments: [{ iban: '[redacted]', amount: 1 }, { accountNumber: '[redacted]' }, 'plain', 7],
    });
  });

  it('redacts objects nested in arrays nested in arrays', () => {
    expect(redact([[{ ssn: 'x' }]])).toEqual([[{ ssn: '[redacted]' }]]);
  });

  it('does not redact keys that only contain a sensitive name', () => {
    const input = { ibanCountry: 'BG', ssnLast4: '1234', myIBAN: 'x', bankAccountType: 'checking' };
    expect(redact(input)).toEqual(input);
  });

  it('leaves non-sensitive values untouched', () => {
    const input = { id: 'i-1', total: 12.5, paid: false, note: null, tags: ['a', 'b'] };
    expect(redact(input)).toEqual(input);
  });

  it('does not mutate the input at any depth', () => {
    const input = { IBAN: 'top', nested: { SSN: 'mid', list: [{ bankAccount: 'deep' }] } };
    const before = structuredClone(input);
    redact(input);
    expect(input).toEqual(before);
  });

  it('returns a copy rather than the input object', () => {
    const input = { a: 1 };
    expect(redact(input)).not.toBe(input);
  });

  it('returns a copy rather than the input array', () => {
    const input = [{ a: 1 }];
    expect(redact(input)).not.toBe(input);
  });

  it.each([
    ['a string', 'IBAN'],
    ['a number', 42],
    ['a boolean', true],
    ['null', null],
  ])('passes %s through unchanged', (_label, value) => {
    expect(redact(value)).toBe(value);
  });

  it('passes an array of primitives through with equal contents', () => {
    expect(redact(['IBAN', 1, null])).toEqual(['IBAN', 1, null]);
  });

  describe('pdf link keys', () => {
    it.each(['pdfURL', 'pdfUrl', 'PDFURL', 'pdfurl'])('redacts the %s key', (key) => {
      expect(redact({ [key]: 'https://files.example/a.pdf', keep: 1 })).toEqual({
        [key]: '[redacted]',
        keep: 1,
      });
    });

    it('redacts pdfUrl nested in histories[].messageData', () => {
      const input = {
        histories: [{ messageData: { pdfUrl: 'https://files.example/a.pdf', subject: 's' } }],
      };
      expect(redact(input)).toEqual({
        histories: [{ messageData: { pdfUrl: '[redacted]', subject: 's' } }],
      });
    });

    it('still redacts digitalInvoiceURL', () => {
      expect(redact({ digitalInvoiceURL: 'https://x.example/v' })).toEqual({
        digitalInvoiceURL: '[redacted]',
      });
    });

    it.each(['pdfURLs', 'mypdfUrl', 'pdf'])('does not redact %s', (key) => {
      expect(redact({ [key]: 'v' })).toEqual({ [key]: 'v' });
    });
  });

  describe('widened PII keys', () => {
    it.each([
      'digitalInvoiceURL',
      'DIGITALINVOICEURL',
      'mobilePhoneNo',
      'mobilephoneno',
      'zipCode',
      'ZIPCODE',
    ])('redacts the %s key', (key) => {
      expect(redact({ [key]: 'v', keep: 1 })).toEqual({ [key]: '[redacted]', keep: 1 });
    });

    it.each([
      'email',
      'emailAddress',
      'distributionEmailAddress',
      'distributionEmailAddress2',
      'techEmailAddress',
      'EMAIL',
    ])('redacts %s because the key contains "email"', (key) => {
      expect(redact({ [key]: 'v' })).toEqual({ [key]: '[redacted]' });
    });

    it.each(['phone', 'phoneNumber', 'visibleContactPhone', 'PHONE'])(
      'redacts %s because the key contains "phone"',
      (key) => {
        expect(redact({ [key]: 'v' })).toEqual({ [key]: '[redacted]' });
      },
    );

    it.each([
      'addressLine',
      'addressLine1',
      'addressLine2',
      'addressLine3',
      'addressLine4',
      'addressLine5',
      'ADDRESSLINE12',
    ])('redacts the %s key', (key) => {
      expect(redact({ [key]: 'v' })).toEqual({ [key]: '[redacted]' });
    });

    it.each(['addressLine1Extra', 'myAddressLine1', 'addressLineA', 'address1'])(
      'does not redact %s, which does not match /^addressLine\\d*$/i',
      (key) => {
        expect(redact({ [key]: 'v' })).toEqual({ [key]: 'v' });
      },
    );

    it('redacts address lines and city inside a nested shippingAddress but keeps countryCode', () => {
      expect(
        redact({
          shippingAddress: {
            addressLine1: '1 Main St',
            addressLine5: 'c/o X',
            zipCode: '1000',
            city: 'Sofia',
            countryCode: 'BG',
          },
        }),
      ).toEqual({
        shippingAddress: {
          addressLine1: '[redacted]',
          addressLine5: '[redacted]',
          zipCode: '[redacted]',
          city: '[redacted]',
          countryCode: 'BG',
        },
      });
    });

    it('redacts city but keeps countryCode at the top level', () => {
      expect(redact({ city: 'Sofia', countryCode: 'BG' })).toEqual({
        city: '[redacted]',
        countryCode: 'BG',
      });
    });
  });

  describe('email addresses inside string values', () => {
    it('replaces an email that is the whole value of a non-sensitive key', () => {
      expect(redact({ histories: [{ messageData: { from: 'billing@acme.example' } }] })).toEqual({
        histories: [{ messageData: { from: '[redacted-email]' } }],
      });
    });

    it('replaces an email embedded in text and keeps the rest of the string', () => {
      expect(redact({ note: 'Sent to a@b.example today' })).toEqual({
        note: 'Sent to [redacted-email] today',
      });
    });

    it('replaces every email in a string', () => {
      expect(redact({ note: 'cc a@b.example and x.y+z@sub.c.example.' })).toEqual({
        note: 'cc [redacted-email] and [redacted-email].',
      });
    });

    it('replaces emails in strings inside arrays', () => {
      expect(redact({ recipients: ['a@b.example', 'none'] })).toEqual({
        recipients: ['[redacted-email]', 'none'],
      });
    });

    it('replaces an email in a top-level string', () => {
      expect(redact('reply to a@b.example')).toBe('reply to [redacted-email]');
    });

    it('leaves strings without an email unchanged', () => {
      expect(redact({ note: 'at 5pm @ office', handle: '@acme' })).toEqual({
        note: 'at 5pm @ office',
        handle: '@acme',
      });
    });
  });
});

const PERSON = {
  customerName: 'Jane Doe',
  city: 'Sofia',
  yourReference: 'Jane',
  note: 'call a@b.example',
  addressLine1: 'Main St 1',
  zipCode: '1000',
  email: 'a@b.example',
  orgNr: '123',
};

describe('redact customer-type modes', () => {
  it('exports the business key set as the two invoice links and ssn', () => {
    expect([...BUSINESS_SENSITIVE_KEYS].sort((a, b) => a.localeCompare(b))).toEqual([
      'digitalinvoiceurl',
      'pdfurl',
      'ssn',
    ]);
  });

  it.each(['customername', 'city', 'yourreference'])(
    'adds %s to SENSITIVE_KEYS and the strict predicate',
    (key) => {
      expect(SENSITIVE_KEYS.has(key)).toBe(true);
      expect(isSensitiveKey(key)).toBe(true);
    },
  );

  it.each(['customerName', 'city', 'yourReference'])(
    'redacts %s for consumers by default, at any depth and case-insensitively',
    (key) => {
      expect(redact({ [key]: 'x' })).toEqual({ [key]: '[redacted]' });
      expect(redact({ a: [{ [key.toUpperCase()]: 'x' }] })).toEqual({
        a: [{ [key.toUpperCase()]: '[redacted]' }],
      });
    },
  );

  it('defaults to consumer rules when no type is given', () => {
    expect(redact({ city: 'x' })).toEqual(redact({ city: 'x' }, 'consumer'));
  });

  it('leaves everything but invoice links alone for a business argument', () => {
    expect(
      redact(
        { ...PERSON, pdfURL: 'u', pdfUrl: 'u', digitalInvoiceURL: 'u', IBAN: 'BG' },
        'business',
      ),
    ).toEqual({
      ...PERSON,
      pdfURL: '[redacted]',
      pdfUrl: '[redacted]',
      digitalInvoiceURL: '[redacted]',
      IBAN: 'BG',
    });
  });

  it('keeps emails inside strings in business mode', () => {
    expect(redact({ text: 'mail a@b.example', list: ['x@y.example'] }, 'business')).toEqual({
      text: 'mail a@b.example',
      list: ['x@y.example'],
    });
  });

  it('treats customerType B as business even with a consumer argument', () => {
    expect(redact({ customerType: 'B', ...PERSON, DigitalInvoiceUrl: 'u' })).toEqual({
      customerType: 'B',
      ...PERSON,
      DigitalInvoiceUrl: '[redacted]',
    });
  });

  it('treats customerType B as business for nested objects and arrays', () => {
    expect(
      redact({
        customerType: 'B',
        customerAddress: { city: 'Sofia' },
        list: [{ note: 'a@b.example' }],
      }),
    ).toEqual({
      customerType: 'B',
      customerAddress: { city: 'Sofia' },
      list: [{ note: 'a@b.example' }],
    });
  });

  it('treats customerType C as consumer even with a business argument', () => {
    expect(redact({ customerType: 'C', city: 'Sofia', email: 'a@b.example' }, 'business')).toEqual({
      customerType: 'C',
      city: '[redacted]',
      email: '[redacted]',
    });
  });

  it.each(['Company', '', 1, null, 'b'])('treats customerType %j as consumer', (type) => {
    expect(redact({ customerType: type, city: 'Sofia' }, 'business')).toEqual({
      customerType: type,
      city: '[redacted]',
    });
  });

  it('inherits the argument mode when customerType is absent', () => {
    expect(redact({ city: 'Sofia' }, 'business')).toEqual({ city: 'Sofia' });
  });

  it('lets a nested customerType override its parent, both directions', () => {
    const out = redact({
      customerType: 'B',
      city: 'Sofia',
      payer: { customerType: 'C', city: 'Varna', deep: { city: 'Ruse' } },
    });
    expect(out).toEqual({
      customerType: 'B',
      city: 'Sofia',
      payer: { customerType: 'C', city: '[redacted]', deep: { city: '[redacted]' } },
    });
    expect(
      redact({ customerType: 'C', city: 'x', other: { customerType: 'B', city: 'Varna' } }),
    ).toEqual({
      customerType: 'C',
      city: '[redacted]',
      other: { customerType: 'B', city: 'Varna' },
    });
  });

  it("applies each list item's own customerType", () => {
    expect(
      redact([{ customerType: 'B', city: 'a' }, { customerType: 'C', city: 'b' }, { city: 'c' }]),
    ).toEqual([
      { customerType: 'B', city: 'a' },
      { customerType: 'C', city: '[redacted]' },
      { city: '[redacted]' },
    ]);
  });

  it("does not leak a sibling's type to the next sibling", () => {
    expect(redact({ a: { customerType: 'B', city: 'x' }, b: { city: 'y' } })).toEqual({
      a: { customerType: 'B', city: 'x' },
      b: { city: '[redacted]' },
    });
  });

  it('still redacts emails in text and email keys for consumers', () => {
    expect(redact({ customerType: 'C', t: 'a@b.example', e: 1, Email: 'x' })).toEqual({
      customerType: 'C',
      t: '[redacted-email]',
      e: 1,
      Email: '[redacted]',
    });
  });
});

describe('note is not a sensitive key', () => {
  it('is not in SENSITIVE_KEYS and is returned as is for consumers', () => {
    expect(SENSITIVE_KEYS.has('note')).toBe(false);
    expect(isSensitiveKey('note')).toBe(false);
    expect(redact({ note: 'The change was accepted' })).toEqual({
      note: 'The change was accepted',
    });
  });
});

describe('business mode redacts SSN', () => {
  it.each(['SSN', 'ssn', 'Ssn'])('redacts %s for a type B customer at any depth', (key) => {
    expect(redact({ customerType: 'B', [key]: '19800101-1234', a: { [key]: 'x' } })).toEqual({
      customerType: 'B',
      [key]: '[redacted]',
      a: { [key]: '[redacted]' },
    });
  });

  it('redacts SSN with a business argument and keeps IBAN', () => {
    expect(redact({ SSN: '1', IBAN: 'BG' }, 'business')).toEqual({ SSN: '[redacted]', IBAN: 'BG' });
  });
});
