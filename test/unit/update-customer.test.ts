import { afterEach, describe, expect, it } from 'vitest';
import { registerUpdateCustomer } from '../../src/tools/update-customer.ts';
import { InioApiError } from '../../src/inio-client.ts';
import {
  makeHarness,
  textOf,
  WRITE_ANNOTATIONS,
  expectAcceptedNote,
} from './helpers/write-tool.ts';

const CID = '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b';
const CUSTOMER = {
  id: CID,
  customerNo: 'C-1001',
  customerName: 'Example Customer AB',
  distributionEmailAddress: 'billing@customer.example',
  mobilePhoneNo: '+46700000000',
  customerAddress: {
    city: 'Stockholm',
    zipCode: '111 22',
    countryCode: 'SE',
    addressLine1: 'Example Street 1',
  },
  directDebit: false,
};
const API_CUSTOMER = {
  ...CUSTOMER,
  workflowsSettings: { distributionMethods: { setup: 'email' } },
};
const REDACTED = {
  ...CUSTOMER,
  distributionEmailAddress: '[redacted]',
  mobilePhoneNo: '[redacted]',
  customerAddress: {
    city: 'Stockholm',
    zipCode: '[redacted]',
    countryCode: 'SE',
    addressLine1: '[redacted]',
  },
};
const PATH = `/customers/${CID}`;

const { setup, close } = makeHarness(registerUpdateCustomer, 'update_customer');
afterEach(close);

const updated = () => Promise.resolve([API_CUSTOMER]);

describe('update_customer registration', () => {
  it('lists the tool with title Update customer', async () => {
    const { client } = await setup({ patch: updated });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['update_customer']);
    expect(tools[0]?.title).toBe('Update customer');
  });

  it('is annotated as a non-read-only, destructive, non-idempotent, open-world tool', async () => {
    const { client } = await setup({ patch: updated });
    const { tools } = await client.listTools();
    expect(tools[0]?.annotations).toMatchObject(WRITE_ANNOTATIONS);
  });

  it('advertises a strict schema with only the editable fields', async () => {
    const { client } = await setup({ patch: updated });
    const { tools } = await client.listTools();
    const schema = tools[0]?.inputSchema;
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([
      'customerAddress',
      'customerName',
      'distributionEmailAddress',
      'distributionEmailAddress2',
      'distributionEmailAddress3',
      'id',
      'languageCode',
      'mobilePhoneNo',
      'number',
      'shippingAddress',
    ]);
    expect(schema).toMatchObject({
      additionalProperties: false,
      properties: {
        id: { type: 'string', format: 'uuid' },
        customerName: { type: 'string', minLength: 2, maxLength: 100 },
      },
    });
  });
});

describe('update_customer request', () => {
  it('patches /customers/<id> with only the given fields', async () => {
    const { inio, call } = await setup({ patch: updated });
    await call({ id: CID, customerName: 'New Name AB' });
    expect(inio.patch).toHaveBeenCalledTimes(1);
    expect(inio.patch).toHaveBeenCalledWith(PATH, { customerName: 'New Name AB' });
    expect(inio.patch.mock.calls[0]?.[1]).toStrictEqual({ customerName: 'New Name AB' });
  });

  it('patches the encoded by-number path', async () => {
    const { inio, call } = await setup({ patch: updated });
    await call({ number: 'C 1/2', customerName: 'New Name AB' });
    expect(inio.patch).toHaveBeenCalledWith('/customers/by-number/C%201%2F2', {
      customerName: 'New Name AB',
    });
  });

  it('keeps nulls so optional fields can be cleared', async () => {
    const { inio, call } = await setup({ patch: updated });
    await call({
      id: CID,
      distributionEmailAddress2: null,
      distributionEmailAddress3: null,
      mobilePhoneNo: null,
      languageCode: null,
      shippingAddress: null,
    });
    expect(inio.patch.mock.calls[0]?.[1]).toStrictEqual({
      distributionEmailAddress2: null,
      distributionEmailAddress3: null,
      mobilePhoneNo: null,
      languageCode: null,
      shippingAddress: null,
    });
  });

  it('sends a partial customerAddress as given, with null for addressLine2-5', async () => {
    const { inio, call } = await setup({ patch: updated });
    await call({
      id: CID,
      customerAddress: { city: 'Göteborg', addressLine2: null, addressLine5: 'Floor 3' },
    });
    expect(inio.patch.mock.calls[0]?.[1]).toStrictEqual({
      customerAddress: { city: 'Göteborg', addressLine2: null, addressLine5: 'Floor 3' },
    });
  });

  it('sends a partial shippingAddress', async () => {
    const { inio, call } = await setup({ patch: updated });
    await call({ id: CID, shippingAddress: { zipCode: '1000', countryCode: 'BG' } });
    expect(inio.patch.mock.calls[0]?.[1]).toStrictEqual({
      shippingAddress: { zipCode: '1000', countryCode: 'BG' },
    });
  });

  it.each(['EN', 'SV', 'BG', 'DE'])('accepts languageCode %s', async (languageCode) => {
    const { call } = await setup({ patch: updated });
    expect((await call({ id: CID, languageCode })).isError).not.toBe(true);
  });

  it.each(['+46701234567', '+1', `+${'1'.repeat(17)}`])('accepts mobilePhoneNo %s', async (v) => {
    const { call } = await setup({ patch: updated });
    expect((await call({ id: CID, mobilePhoneNo: v })).isError).not.toBe(true);
  });

  it.each(['ab', 'x'.repeat(100)])('accepts a customerName of %j length', async (customerName) => {
    const { call } = await setup({ patch: updated });
    expect((await call({ id: CID, customerName })).isError).not.toBe(true);
  });

  it('accepts shippingAddress null to remove the shipping address', async () => {
    const { inio, call } = await setup({ patch: updated });
    expect((await call({ id: CID, shippingAddress: null })).isError).not.toBe(true);
    expect(inio.patch.mock.calls[0]?.[1]).toStrictEqual({ shippingAddress: null });
  });

  it('accepts three different distribution emails and repeated nulls', async () => {
    const { call } = await setup({ patch: updated });
    expect(
      (
        await call({
          id: CID,
          distributionEmailAddress: 'a@x.example',
          distributionEmailAddress2: 'b@x.example',
          distributionEmailAddress3: 'c@x.example',
        })
      ).isError,
    ).not.toBe(true);
    expect(
      (await call({ id: CID, distributionEmailAddress2: null, distributionEmailAddress3: null }))
        .isError,
    ).not.toBe(true);
  });
});

describe('update_customer input validation', () => {
  const A = 'a@x.example';
  it.each([
    ['nothing to update', { id: CID }, 'Provide at least one field to update.'],
    ['neither id nor number', { customerName: 'Name AB' }, 'Provide exactly one of id or number.'],
    [
      'both id and number',
      { id: CID, number: 'C-1', customerName: 'Name AB' },
      'Provide exactly one of id or number.',
    ],
    ['a non-uuid id', { id: 'c-1', customerName: 'Name AB' }, 'id'],
    ['an empty number', { number: '', customerName: 'Name AB' }, 'number'],
    ['a number with CR/LF', { number: 'C-1\r\nX: 1', customerName: 'Name AB' }, 'number'],
    ['a number over 50 characters', { number: 'x'.repeat(51), customerName: 'Name AB' }, 'number'],
    ['a one-character customerName', { id: CID, customerName: 'a' }, 'customerName'],
    [
      'a customerName over 100 characters',
      { id: CID, customerName: 'x'.repeat(101) },
      'customerName',
    ],
    ['a null customerName', { id: CID, customerName: null }, 'customerName'],
    [
      'an invalid email',
      { id: CID, distributionEmailAddress: 'not-an-email' },
      'distributionEmailAddress',
    ],
    ['a phone without +', { id: CID, mobilePhoneNo: '46701234567' }, 'mobilePhoneNo'],
    ['a phone with spaces', { id: CID, mobilePhoneNo: '+46 70 123' }, 'mobilePhoneNo'],
    [
      'a phone with leading junk before the +',
      { id: CID, mobilePhoneNo: 'x+4912345' },
      'mobilePhoneNo',
    ],
    [
      'a phone with leading digits before the +',
      { id: CID, mobilePhoneNo: '0049+123' },
      'mobilePhoneNo',
    ],
    ['a phone with trailing junk', { id: CID, mobilePhoneNo: '+4912345x' }, 'mobilePhoneNo'],
    [
      'an empty customerAddress',
      { id: CID, customerAddress: {} },
      'Provide at least one address field.',
    ],
    [
      'an empty shippingAddress',
      { id: CID, shippingAddress: {} },
      'Provide at least one address field.',
    ],
    [
      'duplicate emails that differ only in case',
      {
        id: CID,
        distributionEmailAddress: 'A@x.example',
        distributionEmailAddress2: 'a@x.example',
      },
      'Distribution email addresses must be different.',
    ],
    [
      'duplicate emails in mixed case between 1 and 3',
      {
        id: CID,
        distributionEmailAddress: 'Bill@X.example',
        distributionEmailAddress3: 'bill@x.EXAMPLE',
      },
      'Distribution email addresses must be different.',
    ],
    ['a phone with 18 digits', { id: CID, mobilePhoneNo: `+${'1'.repeat(18)}` }, 'mobilePhoneNo'],
    ['an unknown languageCode', { id: CID, languageCode: 'FR' }, 'languageCode'],
    ['a lowercase languageCode', { id: CID, languageCode: 'en' }, 'languageCode'],
    ['a 3-letter countryCode', { id: CID, customerAddress: { countryCode: 'SWE' } }, 'countryCode'],
    ['an empty city', { id: CID, customerAddress: { city: '' } }, 'city'],
    ['a city over 50 characters', { id: CID, customerAddress: { city: 'x'.repeat(51) } }, 'city'],
    ['a 3-character zipCode', { id: CID, customerAddress: { zipCode: '123' } }, 'zipCode'],
    ['a 7-character zipCode', { id: CID, customerAddress: { zipCode: '1234567' } }, 'zipCode'],
    ['a zipCode with a dash', { id: CID, customerAddress: { zipCode: '111-22' } }, 'zipCode'],
    ['an empty addressLine1', { id: CID, customerAddress: { addressLine1: '' } }, 'addressLine1'],
    ['a null addressLine1', { id: CID, customerAddress: { addressLine1: null } }, 'addressLine1'],
    [
      'an addressLine3 over 60 characters',
      { id: CID, customerAddress: { addressLine3: 'x'.repeat(61) } },
      'addressLine3',
    ],
    ['an unknown address key', { id: CID, customerAddress: { foo: 'x' } }, 'foo'],
    ['an unknown shipping key', { id: CID, shippingAddress: { foo: 'x' } }, 'foo'],
    ['a bad shipping zipCode', { id: CID, shippingAddress: { zipCode: '1' } }, 'zipCode'],
    ['SSN', { id: CID, SSN: '19800101-1234' }, 'Unrecognized key: "SSN"'],
    ['orgNr', { id: CID, orgNr: '556677-8899' }, 'Unrecognized key: "orgNr"'],
    ['vatNo', { id: CID, vatNo: 'SE1' }, 'Unrecognized key: "vatNo"'],
    ['customerType', { id: CID, customerType: 'Company' }, 'Unrecognized key: "customerType"'],
    [
      'workflowsSettings',
      { id: CID, workflowsSettings: {} },
      'Unrecognized key: "workflowsSettings"',
    ],
    ['metadata', { id: CID, metadata: {} }, 'Unrecognized key: "metadata"'],
    ['an unknown key', { id: CID, customerName: 'Name AB', foo: 1 }, 'Unrecognized key: "foo"'],
    [
      'duplicate emails 1 and 2',
      { id: CID, distributionEmailAddress: A, distributionEmailAddress2: A },
      'Distribution email addresses must be different.',
    ],
    [
      'duplicate emails 1 and 3',
      { id: CID, distributionEmailAddress: A, distributionEmailAddress3: A },
      'Distribution email addresses must be different.',
    ],
    [
      'duplicate emails 2 and 3',
      { id: CID, distributionEmailAddress2: A, distributionEmailAddress3: A },
      'Distribution email addresses must be different.',
    ],
  ])('rejects %s without calling the API', async (_label, args, fragment) => {
    const { inio, call } = await setup({ patch: updated });
    const result = await call(args);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Input validation error: /);
    expect(textOf(result)).toContain(fragment);
    expect(inio.patch).not.toHaveBeenCalled();
  });

  it.each(['..', '.'])('rejects the number %j as an invalid path segment', async (number) => {
    const { inio, call } = await setup({ patch: updated });
    const result = await call({ number, customerName: 'Name AB' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Invalid path segment');
    expect(inio.patch).not.toHaveBeenCalled();
  });
});

describe('update_customer output', () => {
  it('returns the updated customer without workflowsSettings, redacted', async () => {
    const { call } = await setup({ patch: updated });
    const result = await call({ id: CID, customerName: 'Example Customer AB' });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toStrictEqual(REDACTED);
    expect(textOf(result)).not.toContain('workflowsSettings');
  });

  it('keeps personal data when revealPii is true', async () => {
    const { call } = await setup({ patch: updated }, true);
    const text = textOf(await call({ id: CID, customerName: 'Example Customer AB' }));
    expect(JSON.parse(text)).toStrictEqual(CUSTOMER);
  });

  it('does not return structuredContent', async () => {
    const { call } = await setup({ patch: updated });
    expect((await call({ id: CID, customerName: 'Name AB' })).structuredContent).toBeUndefined();
  });
});

describe('update_customer errors', () => {
  it.each([
    ['null', null],
    ['an empty array', []],
    ['an object', API_CUSTOMER],
    ['a string', 'Success'],
    ['an array of non-objects', ['x']],
  ])('reports success with a note when the answer is %s', async (_label, payload) => {
    const { call } = await setup({ patch: () => Promise.resolve(payload) });
    const result = await call({ id: CID, customerName: 'Name AB' });
    expectAcceptedNote(result);
  });

  it('returns API validation errors with field errors, redacting sensitive fields', async () => {
    const { call } = await setup({
      patch: () =>
        Promise.reject(
          new InioApiError(400, 'VALIDATION_ERROR', 'Bad input', 'c-1', [
            { fieldName: 'customerAddress.zipCode', message: 'Invalid zip 11122' },
            { fieldName: 'customerName', message: 'Too short' },
          ]),
        ),
    });
    expect(textOf(await call({ id: CID, customerName: 'Name AB' }))).toBe(
      'VALIDATION_ERROR: Bad input (correlationId c-1) Fields: customerAddress.zipCode: [redacted]; customerName: Too short',
    );
  });

  it('returns a 404 for an unknown customer as the API error text', async () => {
    const { call } = await setup({
      patch: () => Promise.reject(new InioApiError(404, 'NOT_FOUND', 'No such customer', 'c-2')),
    });
    expect(textOf(await call({ id: CID, customerName: 'Name AB' }))).toBe(
      'NOT_FOUND: No such customer (correlationId c-2)',
    );
  });
});

describe('update_customer tool-call logging', () => {
  it('logs one tool call line with outcome ok and no customer data', async () => {
    const { call, logger } = await setup({ patch: updated });
    const bytes = Buffer.byteLength(
      textOf(await call({ id: CID, customerName: 'Secret Name AB' })),
      'utf8',
    );
    expect(logger.info.mock.calls).toEqual([
      [
        {
          tool: 'update_customer',
          durationMs: expect.any(Number),
          outcome: 'ok',
          responseBytes: bytes,
          approxTokens: Math.ceil(bytes / 4),
        },
        'tool call',
      ],
    ]);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('Secret Name');
  });
});

const emailOfLength = (n: number) => 'a'.repeat(n - '@x.example'.length) + '@x.example';

describe('update_customer distribution email length', () => {
  it.each(['distributionEmailAddress', 'distributionEmailAddress2', 'distributionEmailAddress3'])(
    'rejects a 151 character %s without calling the API',
    async (field) => {
      const email = emailOfLength(151);
      expect(email).toHaveLength(151);
      const { inio, call } = await setup({ patch: updated });
      const result = await call({ id: CID, [field]: email });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/^Input validation error: /);
      expect(textOf(result)).toContain(field);
      expect(inio.patch).not.toHaveBeenCalled();
    },
  );

  it.each(['distributionEmailAddress', 'distributionEmailAddress2', 'distributionEmailAddress3'])(
    'accepts a 150 character %s',
    async (field) => {
      const email = emailOfLength(150);
      expect(email).toHaveLength(150);
      const { inio, call } = await setup({ patch: updated });
      const result = await call({ id: CID, [field]: email });
      expect(result.isError).not.toBe(true);
      expect(inio.patch).toHaveBeenCalledTimes(1);
    },
  );
});

describe('update_customer accepted write with an unreadable answer', () => {
  it.each([200, 201, 299])(
    'reports success with a note when the client cannot read a %i answer',
    async (status) => {
      const err = new InioApiError(status, 'UPSTREAM_ERROR', 'Unexpected response');
      const { call } = await setup({ patch: () => Promise.reject(err) });
      expectAcceptedNote(await call({ id: CID, customerName: 'Name AB' }));
    },
  );

  it('still reports a non-2xx client error as an error', async () => {
    const err = new InioApiError(400, 'BAD_REQUEST', 'Nope', 'c-1');
    const { call } = await setup({ patch: () => Promise.reject(err) });
    const result = await call({ id: CID, customerName: 'Name AB' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('BAD_REQUEST: Nope (correlationId c-1)');
  });
});
