import { describe, expect, it } from 'vitest';
import { redact } from '../../src/redact.ts';

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

    it('redacts address lines inside a nested shippingAddress but keeps city and countryCode', () => {
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
          city: 'Sofia',
          countryCode: 'BG',
        },
      });
    });

    it('keeps city and countryCode visible at the top level', () => {
      expect(redact({ city: 'Sofia', countryCode: 'BG' })).toEqual({
        city: 'Sofia',
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
