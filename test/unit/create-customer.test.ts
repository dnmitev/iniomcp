import { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerCreateCustomer } from '../../src/tools/create-customer.ts';
import { createInioClient, InioApiError } from '../../src/inio-client.ts';
import { makeHarness, textOf, WRITE_ANNOTATIONS } from './helpers/write-tool.ts';

const CLIENT_ID = 'client-7f3a9c';
const CUSTOMER_ID = '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** Unsigned JWT-shaped token: the tool only decodes the payload. */
const jwt = (claims: Record<string, unknown>) =>
  `${b64({ alg: 'none' })}.${b64(claims)}.sig-secret`;
const TOKEN = jwt({ sub: 'svc', inio_client_id: CLIENT_ID });

const ADDRESS = {
  countryCode: 'SE',
  city: 'Göteborg',
  zipCode: '41101',
  addressLine1: 'Example Street 1',
};
const BASE = {
  customerNo: 'C-1001',
  customerName: 'Jane Doe',
  languageCode: 'EN',
  serviceLineName: 'B2C',
  customerAddress: ADDRESS,
};
// The API requires SSN for a consumer and orgNr and vatNo for a business.
const ARGS = { ...BASE, customerType: 'C', SSN: '19900101-1234' };
const BARGS = { ...BASE, customerType: 'B', orgNr: '556000-0000', vatNo: 'SE556000000001' };
const NOTE = 'The customer was created, but the API answer could not be read.';

let token = TOKEN;
const { setup, close } = makeHarness((server, deps) => {
  registerCreateCustomer(server, {
    ...deps,
    tokens: { getToken: () => Promise.resolve(token) },
  });
}, 'create_customer');
afterEach(async () => {
  token = TOKEN;
  await close();
});

const impl = () => ({ post: () => Promise.resolve([CUSTOMER_ID]) });

describe('create_customer registration', () => {
  it('lists the tool with title Create customer', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['create_customer']);
    expect(tools[0]?.title).toBe('Create customer');
  });

  it('is annotated as a non-read-only, destructive, non-idempotent, open-world tool', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    expect(tools[0]?.annotations).toMatchObject(WRITE_ANNOTATIONS);
  });

  it.each([
    'serviceLineName',
    'get_customer',
    'customerNo must be new',
    'nothing is sent to the customer',
  ])('description mentions %j', async (fragment) => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    expect(tools[0]?.description ?? '').toContain(fragment);
  });

  it('advertises a strict schema without clientId or workflowsSettings inputs', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    const schema = tools[0]?.inputSchema;
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([
      'SSN',
      'customerAddress',
      'customerName',
      'customerNo',
      'customerType',
      'distributionEmailAddress',
      'distributionEmailAddress2',
      'distributionEmailAddress3',
      'languageCode',
      'mobilePhoneNo',
      'orgNr',
      'serviceLineName',
      'shippingAddress',
      'vatNo',
    ]);
    expect([...(schema?.required ?? [])].sort()).toEqual([
      'customerAddress',
      'customerName',
      'customerNo',
      'customerType',
      'languageCode',
      'serviceLineName',
    ]);
    expect(schema).toMatchObject({
      additionalProperties: false,
      properties: {
        customerNo: { type: 'string', minLength: 1, maxLength: 50 },
        customerName: { type: 'string', minLength: 2, maxLength: 100 },
        customerType: { enum: ['B', 'C'] },
        languageCode: { enum: ['EN', 'SV', 'BG', 'DE'] },
        serviceLineName: { type: 'string', minLength: 1, maxLength: 60 },
        SSN: { type: 'string', minLength: 1, maxLength: 25 },
        orgNr: { type: 'string', minLength: 1, maxLength: 25 },
        vatNo: { type: 'string', minLength: 1, maxLength: 100 },
      },
    });
  });

  it('describes every property', async () => {
    const { client } = await setup(impl());
    const { tools } = await client.listTools();
    const props = z
      .record(z.string(), z.looseObject({ description: z.string().min(1) }))
      .parse(tools[0]?.inputSchema.properties);
    expect(Object.keys(props)).toHaveLength(14);
  });
});

describe('create_customer request', () => {
  it('posts a one-element array to /customers with clientId from the token', async () => {
    const { inio, call } = await setup(impl());
    await call(ARGS);
    expect(inio.post).toHaveBeenCalledTimes(1);
    expect(inio.post.mock.calls[0]).toStrictEqual([
      '/customers',
      [{ ...ARGS, clientId: CLIENT_ID }],
    ]);
  });

  it('sends every optional field of a consumer when given', async () => {
    const { inio, call } = await setup(impl());
    const full = {
      ...ARGS,
      distributionEmailAddress: 'a@x.example',
      distributionEmailAddress2: 'b@x.example',
      distributionEmailAddress3: 'c@x.example',
      mobilePhoneNo: '+46701234567',
      shippingAddress: { ...ADDRESS, addressLine2: 'c/o X', addressLine5: 'Floor 3' },
      SSN: '19900101-1234',
    };
    expect((await call(full)).isError).not.toBe(true);
    expect(inio.post.mock.calls[0]?.[1]).toStrictEqual([{ ...full, clientId: CLIENT_ID }]);
  });

  it('sends orgNr and vatNo for a business', async () => {
    const { inio, call } = await setup(impl());
    const b = { ...BARGS, orgNr: '556000-0000', vatNo: 'SE556000000001' };
    expect((await call(b)).isError).not.toBe(true);
    expect(inio.post.mock.calls[0]?.[1]).toStrictEqual([{ ...b, clientId: CLIENT_ID }]);
  });

  it('sends only the identity numbers of the type for a consumer and for a business', async () => {
    const { inio, call } = await setup(impl());
    expect((await call(BARGS)).isError).not.toBe(true);
    expect((await call(ARGS)).isError).not.toBe(true);
    expect(inio.post.mock.calls[0]?.[1]).toStrictEqual([{ ...BARGS, clientId: CLIENT_ID }]);
    expect(inio.post.mock.calls[1]?.[1]).toStrictEqual([{ ...ARGS, clientId: CLIENT_ID }]);
  });

  it('accepts the address with its optional lines addressLine2 to addressLine5', async () => {
    const { inio, call } = await setup(impl());
    const customerAddress = {
      ...ADDRESS,
      addressLine2: 'l2',
      addressLine3: 'l3',
      addressLine4: 'l4',
      addressLine5: 'l5',
    };
    await call({ ...ARGS, customerAddress });
    expect(inio.post.mock.calls[0]?.[1]).toMatchObject([{ customerAddress }]);
  });

  it.each(['EN', 'SV', 'BG', 'DE'])('accepts the languageCode %s', async (languageCode) => {
    const { call } = await setup(impl());
    expect((await call({ ...ARGS, languageCode })).isError).not.toBe(true);
  });

  it.each([
    ['a customerNo of 1 character', { customerNo: 'x' }],
    ['a customerNo of 50 characters', { customerNo: 'x'.repeat(50) }],
    ['a customerNo with an embedded dot', { customerNo: 'C-1.a_b' }],
    ['a customerNo of three dots', { customerNo: '...' }],
    ['a customerNo with æ, + and #', { customerNo: 'Kund-æøå+#1' }],
    ['a customerName of 2 characters', { customerName: 'Jo' }],
    ['a customerName of 100 characters', { customerName: 'x'.repeat(100) }],
    ['a serviceLineName of 1 character', { serviceLineName: 'x' }],
    ['a serviceLineName of 60 characters', { serviceLineName: 'x'.repeat(60) }],
    ['an SSN of 1 character', { SSN: 'x' }],
    ['an SSN of 25 characters', { SSN: 'x'.repeat(25) }],
    ['a mobilePhoneNo of + and 1 digit', { mobilePhoneNo: '+1' }],
    ['a mobilePhoneNo of + and 17 digits', { mobilePhoneNo: `+${'1'.repeat(17)}` }],
    ['a 4-character zipCode', { customerAddress: { ...ADDRESS, zipCode: '1000' } }],
    ['a 6-character zipCode with a space', { customerAddress: { ...ADDRESS, zipCode: 'SW1 1A' } }],
    ['a lowercase countryCode', { customerAddress: { ...ADDRESS, countryCode: 'bg' } }],
    ['a city of 50 characters', { customerAddress: { ...ADDRESS, city: 'x'.repeat(50) } }],
    ['an addressLine1 of 60', { customerAddress: { ...ADDRESS, addressLine1: 'x'.repeat(60) } }],
    ['an addressLine5 of 60', { customerAddress: { ...ADDRESS, addressLine5: 'x'.repeat(60) } }],
  ])('accepts %s', async (_l, patch) => {
    const { call } = await setup(impl());
    expect((await call({ ...ARGS, ...patch })).isError).not.toBe(true);
  });

  it.each([
    ['an orgNr of 25 characters', { orgNr: 'x'.repeat(25) }],
    ['a vatNo of 100 characters', { vatNo: 'x'.repeat(100) }],
    ['an orgNr of 1 character', { orgNr: 'x' }],
    ['a vatNo of 1 character', { vatNo: 'x' }],
  ])('accepts %s for a business', async (_l, patch) => {
    const { call } = await setup(impl());
    expect((await call({ ...BARGS, ...patch })).isError).not.toBe(true);
  });

  it('accepts the same email in different fields only when they differ, compared ignoring case', async () => {
    const { call } = await setup(impl());
    const result = await call({
      ...ARGS,
      distributionEmailAddress: 'a@x.example',
      distributionEmailAddress3: 'b@x.example',
    });
    expect(result.isError).not.toBe(true);
  });
});

describe('create_customer input validation', () => {
  const A = 'a@x.example';
  const without = (k: string) => {
    const copy: Record<string, unknown> = { ...ARGS };
    Reflect.deleteProperty(copy, k);
    return copy;
  };
  const withoutB = (...ks: string[]) => {
    const copy: Record<string, unknown> = { ...BARGS };
    for (const k of ks) Reflect.deleteProperty(copy, k);
    return copy;
  };
  const noAddr = (k: string) => {
    const a: Record<string, unknown> = { ...ADDRESS };
    Reflect.deleteProperty(a, k);
    return a;
  };
  type Row = [string, Record<string, unknown>, string];
  const REJECTS: Row[] = [
    ...[
      'customerNo',
      'customerName',
      'customerType',
      'languageCode',
      'serviceLineName',
      'customerAddress',
    ].map((k): Row => [`a missing ${k}`, without(k), k]),
    ...['countryCode', 'city', 'zipCode', 'addressLine1'].map((k): Row => [
      `a customerAddress without ${k}`,
      { ...ARGS, customerAddress: noAddr(k) },
      k,
    ]),
    ...['countryCode', 'city', 'zipCode', 'addressLine1'].map((k): Row => [
      `a shippingAddress without ${k}`,
      { ...ARGS, shippingAddress: noAddr(k) },
      k,
    ]),
    ['an empty customerAddress', { ...ARGS, customerAddress: {} }, 'countryCode'],
    ['a null shippingAddress', { ...ARGS, shippingAddress: null }, 'shippingAddress'],
    ['an empty customerNo', { ...ARGS, customerNo: '' }, 'customerNo'],
    ['a customerNo over 50 characters', { ...ARGS, customerNo: 'x'.repeat(51) }, 'customerNo'],
    ['a customerNo with a tab', { ...ARGS, customerNo: 'C\t1' }, 'customerNo'],
    ['a customerNo with CR/LF', { ...ARGS, customerNo: 'C-1\r\nX' }, 'customerNo'],
    ['a customerNo with a control character', { ...ARGS, customerNo: 'C\u00001' }, 'customerNo'],
    ['a customerNo with a lone LF', { ...ARGS, customerNo: 'C-1\nX' }, 'customerNo'],
    ['a customerNo with DEL', { ...ARGS, customerNo: 'C\u007f1' }, 'customerNo'],
    ['a customerNo of .', { ...ARGS, customerNo: '.' }, 'Invalid path segment'],
    ['a customerNo of ..', { ...ARGS, customerNo: '..' }, 'Invalid path segment'],
    ['a one-character customerName', { ...ARGS, customerName: 'a' }, 'customerName'],
    [
      'a customerName over 100 characters',
      { ...ARGS, customerName: 'x'.repeat(101) },
      'customerName',
    ],
    ['an unknown customerType', { ...ARGS, customerType: 'X' }, 'customerType'],
    ['a lowercase customerType', { ...ARGS, customerType: 'c' }, 'customerType'],
    ['an unknown languageCode', { ...ARGS, languageCode: 'FR' }, 'languageCode'],
    ['an empty serviceLineName', { ...ARGS, serviceLineName: '' }, 'serviceLineName'],
    [
      'a serviceLineName over 60 characters',
      { ...ARGS, serviceLineName: 'x'.repeat(61) },
      'serviceLineName',
    ],
    ['an empty SSN', { ...ARGS, SSN: '' }, 'SSN'],
    ['an SSN over 25 characters', { ...ARGS, SSN: 'x'.repeat(26) }, 'SSN'],
    ['an empty orgNr', { ...BARGS, orgNr: '' }, 'orgNr'],
    ['an orgNr over 25 characters', { ...BARGS, orgNr: 'x'.repeat(26) }, 'orgNr'],
    ['an empty vatNo', { ...BARGS, vatNo: '' }, 'vatNo'],
    ['a vatNo over 100 characters', { ...BARGS, vatNo: 'x'.repeat(101) }, 'vatNo'],
    [
      'an invalid email',
      { ...ARGS, distributionEmailAddress: 'not-an-email' },
      'distributionEmailAddress',
    ],
    ['a mobilePhoneNo without +', { ...ARGS, mobilePhoneNo: '46701234567' }, 'mobilePhoneNo'],
    [
      'a mobilePhoneNo of 18 digits',
      { ...ARGS, mobilePhoneNo: `+${'1'.repeat(18)}` },
      'mobilePhoneNo',
    ],
    [
      'a 3-letter countryCode',
      { ...ARGS, customerAddress: { ...ADDRESS, countryCode: 'SWE' } },
      'countryCode',
    ],
    ['an empty city', { ...ARGS, customerAddress: { ...ADDRESS, city: '' } }, 'city'],
    [
      'a city over 50 characters',
      { ...ARGS, customerAddress: { ...ADDRESS, city: 'x'.repeat(51) } },
      'city',
    ],
    [
      'a 3-character zipCode',
      { ...ARGS, customerAddress: { ...ADDRESS, zipCode: '123' } },
      'zipCode',
    ],
    [
      'a 7-character zipCode',
      { ...ARGS, customerAddress: { ...ADDRESS, zipCode: '1234567' } },
      'zipCode',
    ],
    [
      'a zipCode with a dash',
      { ...ARGS, customerAddress: { ...ADDRESS, zipCode: '111-22' } },
      'zipCode',
    ],
    [
      'a bad shipping zipCode',
      { ...ARGS, shippingAddress: { ...ADDRESS, zipCode: '1' } },
      'zipCode',
    ],
    [
      'an addressLine3 over 60 characters',
      { ...ARGS, customerAddress: { ...ADDRESS, addressLine3: 'x'.repeat(61) } },
      'addressLine3',
    ],
    ['an unknown address key', { ...ARGS, customerAddress: { ...ADDRESS, foo: 'x' } }, 'foo'],
    ['an unknown shipping key', { ...ARGS, shippingAddress: { ...ADDRESS, foo: 'x' } }, 'foo'],
    ...['distributionEmailAddress', 'distributionEmailAddress2', 'distributionEmailAddress3'].map(
      (k): Row => [`a null ${k}`, { ...ARGS, [k]: null }, k],
    ),
    ...['abc+46701234567', '0+46701234567'].map((v): Row => [
      `the mobilePhoneNo ${v}`,
      { ...ARGS, mobilePhoneNo: v },
      'mobilePhoneNo',
    ]),
    ['a clientId', { ...ARGS, clientId: 'other' }, 'Unrecognized key: "clientId"'],
    [
      'workflowsSettings',
      { ...ARGS, workflowsSettings: { distributionMethods: { setup: 'email' } } },
      'Unrecognized key: "workflowsSettings"',
    ],
    ['a customerTag1', { ...ARGS, customerTag1: 'x' }, 'Unrecognized key: "customerTag1"'],
    ['an unknown key', { ...ARGS, foo: 1 }, 'Unrecognized key: "foo"'],
    [
      'duplicate emails 1 and 2',
      { ...ARGS, distributionEmailAddress: A, distributionEmailAddress2: A },
      'Distribution email addresses must be different.',
    ],
    [
      'duplicate emails 1 and 3',
      { ...ARGS, distributionEmailAddress: A, distributionEmailAddress3: A },
      'Distribution email addresses must be different.',
    ],
    [
      'duplicate emails 2 and 3',
      { ...ARGS, distributionEmailAddress2: A, distributionEmailAddress3: A },
      'Distribution email addresses must be different.',
    ],
    [
      'duplicate emails that differ only in case',
      {
        ...ARGS,
        distributionEmailAddress: 'A@x.example',
        distributionEmailAddress2: 'a@x.example',
      },
      'Distribution email addresses must be different.',
    ],
    ['a consumer without SSN', without('SSN'), 'SSN is required for customerType C.'],
    [
      'a business without orgNr',
      withoutB('orgNr'),
      'orgNr and vatNo are required for customerType B.',
    ],
    [
      'a business without vatNo',
      withoutB('vatNo'),
      'orgNr and vatNo are required for customerType B.',
    ],
    [
      'a business without orgNr and vatNo',
      withoutB('orgNr', 'vatNo'),
      'orgNr and vatNo are required for customerType B.',
    ],
    ['an SSN on a business', { ...BARGS, SSN: '123' }, 'SSN is only for customerType C.'],
    [
      'an orgNr on a consumer',
      { ...ARGS, orgNr: '556000-0000' },
      'orgNr and vatNo are only for customerType B.',
    ],
    [
      'a vatNo on a consumer',
      { ...ARGS, vatNo: 'SE1' },
      'orgNr and vatNo are only for customerType B.',
    ],
    [
      'an orgNr and vatNo on a consumer',
      { ...ARGS, orgNr: '1', vatNo: 'SE1' },
      'orgNr and vatNo are only for customerType B.',
    ],
  ];
  it.each(REJECTS)('rejects %s without calling the API', async (_label, args, fragment) => {
    const { inio, call } = await setup(impl());
    const result = await call(args);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Input validation error: /);
    expect(textOf(result)).toContain(fragment);
    expect(inio.post).not.toHaveBeenCalled();
  });
});

describe('create_customer client id from the token', () => {
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

describe('create_customer output', () => {
  it('returns created, the id and the customer number from a 201 id list', async () => {
    const { call } = await setup(impl());
    const result = await call(ARGS);
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toStrictEqual({
      created: true,
      id: CUSTOMER_ID,
      customerNo: 'C-1001',
    });
  });

  it.each([
    ['a string', 'Success'],
    ['null', null],
    ['an empty object', {}],
    ['an empty array', []],
    ['an array of a non-string', [42]],
    ['an array of an empty string', ['']],
    ['an array of several ids', ['a', 'b']],
  ])('still reports success with a note when the 2xx body is %s', async (_l, body) => {
    const { call } = await setup({ post: () => Promise.resolve(body) });
    const result = await call(ARGS);
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toStrictEqual({
      created: true,
      customerNo: 'C-1001',
      note: NOTE,
    });
  });

  it.each([200, 201, 299])(
    'reports success with a note for an InioApiError with status %s',
    async (status) => {
      const { inio, call } = await setup({
        post: () =>
          Promise.reject(new InioApiError(status, 'UPSTREAM_ERROR', 'Unexpected response')),
      });
      const result = await call(ARGS);
      expect(result.isError).not.toBe(true);
      expect(JSON.parse(textOf(result))).toStrictEqual({
        created: true,
        customerNo: 'C-1001',
        note: NOTE,
      });
      expect(inio.post).toHaveBeenCalledTimes(1);
    },
  );

  it('treats an InioApiError with status 300 as a plain error, without a note', async () => {
    const { call } = await setup({
      post: () => Promise.reject(new InioApiError(300, 'UPSTREAM_ERROR', 'Multiple choices')),
    });
    const result = await call(ARGS);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('UPSTREAM_ERROR: Multiple choices');
  });
});

describe('create_customer errors', () => {
  it('explains a 409 as an existing customerNo and points at get_customer', async () => {
    const error = new InioApiError(409, 'CONFLICT', 'Customer exists', 'c-3');
    const { call, inio } = await setup({ post: () => Promise.reject(error) });
    const result = await call(ARGS);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('already exists');
    expect(textOf(result)).toContain('get_customer');
    expect(textOf(result)).not.toContain('may or may not have been created');
    expect(inio.post).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'a validation rejection',
      new InioApiError(400, 'BAD_REQUEST', 'Unknown service line', 'c-4'),
      'BAD_REQUEST: Unknown service line (correlationId c-4)',
    ],
    [
      'a 499',
      new InioApiError(499, 'CLIENT_CLOSED', 'Closed request', 'c-7'),
      'CLIENT_CLOSED: Closed request (correlationId c-7)',
    ],
  ])('returns %s as the plain error text, without a hint', async (_l, error, text) => {
    const { call } = await setup({ post: () => Promise.reject(error) });
    const result = await call(ARGS);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(text);
  });

  it('returns field errors', async () => {
    const { call } = await setup({
      post: () =>
        Promise.reject(
          new InioApiError(400, 'VALIDATION_ERROR', 'Bad input', 'c-6', [
            { fieldName: '0.serviceLineName', message: 'Unknown' },
          ]),
        ),
    });
    expect(textOf(await call(ARGS))).toBe(
      'VALIDATION_ERROR: Bad input (correlationId c-6) Fields: 0.serviceLineName: Unknown',
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
    ['a 500', new InioApiError(500, 'INTERNAL_ERROR', 'Server error')],
    ['a 502', new InioApiError(502, 'UPSTREAM_ERROR', 'Bad gateway', 'c-8')],
    ['a 503', new InioApiError(503, 'UNAVAILABLE', 'Service unavailable')],
    ['a lost response', new InioApiError(0, 'NETWORK_ERROR', 'Could not reach the Inio API.')],
  ])(
    'keeps %s an error and tells the model to check get_customer by number before any retry',
    async (_l, error) => {
      const { call, inio } = await setup({ post: () => Promise.reject(error) });
      const result = await call(ARGS);
      expect(result.isError).toBe(true);
      const text = textOf(result);
      expect(text.startsWith(`${error.code}: ${error.message}`)).toBe(true);
      expect(text).toContain('get_customer');
      expect(text).toContain('C-1001');
      expect(text).toContain('may or may not have been created');
      expect(inio.post).toHaveBeenCalledTimes(1);
    },
  );
});

describe('create_customer tool-call logging', () => {
  it('logs one tool call line with outcome ok and no input values, token or client id', async () => {
    const { call, logger } = await setup(impl());
    const bytes = Buffer.byteLength(
      textOf(await call({ ...ARGS, SSN: 'ssn-secret', customerName: 'Secret Person' })),
      'utf8',
    );
    expect(logger.info.mock.calls).toEqual([
      [
        {
          tool: 'create_customer',
          durationMs: expect.any(Number),
          outcome: 'ok',
          responseBytes: bytes,
          approxTokens: Math.ceil(bytes / 4),
        },
        'tool call',
      ],
    ]);
    const logged = JSON.stringify(logger.info.mock.calls);
    for (const leak of ['ssn-secret', 'Secret Person', CLIENT_ID, 'sig-secret', TOKEN]) {
      expect(logged).not.toContain(leak);
    }
  });

  it('logs outcome error and never the token when the claim is missing', async () => {
    token = jwt({ sub: 'svc' });
    const { call, logger } = await setup(impl());
    await call(ARGS);
    expect(logger.info.mock.calls[0]?.[0]).toMatchObject({
      tool: 'create_customer',
      outcome: 'error',
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('sig-secret');
  });
});

describe('create_customer through the real client', () => {
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
    });
    return call(ARGS);
  };
  const respond = (res: Response) => vi.fn<typeof globalThis.fetch>(() => Promise.resolve(res));
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  it('returns the id from a 201 result envelope', async () => {
    const result = await run(respond(json({ success: true, result: [CUSTOMER_ID] }, 201)));
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toEqual({
      created: true,
      id: CUSTOMER_ID,
      customerNo: 'C-1001',
    });
  });

  it('reports success with a note when a 201 body is not JSON', async () => {
    const result = await run(respond(new Response('<html>created</html>', { status: 201 })));
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toEqual({
      created: true,
      customerNo: 'C-1001',
      note: NOTE,
    });
  });

  it('reports success with a note when a 201 JSON body lacks the result envelope', async () => {
    const result = await run(respond(json([CUSTOMER_ID], 201)));
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toEqual({
      created: true,
      customerNo: 'C-1001',
      note: NOTE,
    });
  });

  it('sends the POST once to /customers with the token claim in the body', async () => {
    const f = respond(json({ success: true, result: [CUSTOMER_ID] }, 201));
    await run(f);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] ?? [];
    expect(init?.method).toBe('POST');
    expect(url).toBe('https://api.example/v1/customers');
    expect(JSON.parse(z.string().parse(init?.body))).toEqual([{ ...ARGS, clientId: CLIENT_ID }]);
  });

  it('turns a 409 envelope into the already-exists error', async () => {
    const f = respond(
      json(
        { success: false, status: 409, code: 'CONFLICT', message: 'Exists', correlationId: 'c-9' },
        409,
      ),
    );
    const result = await run(f);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('already exists');
    expect(textOf(result)).toContain('get_customer');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('still fails on a 400 error envelope, without a retry hint', async () => {
    const result = await run(
      respond(
        json(
          {
            success: false,
            status: 400,
            code: 'VALIDATION_ERROR',
            message: 'Bad input',
            correlationId: 'c-9',
          },
          400,
        ),
      ),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('VALIDATION_ERROR: Bad input (correlationId c-9)');
  });

  it('keeps a timeout an error that points at get_customer, with one POST only', async () => {
    const f = vi.fn<typeof globalThis.fetch>(() =>
      Promise.reject(new DOMException('timed out', 'TimeoutError')),
    );
    const result = await run(f);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('TIMEOUT');
    expect(textOf(result)).toContain('get_customer');
    expect(textOf(result)).toContain('may or may not have been created');
    expect(f).toHaveBeenCalledTimes(1);
  });
});

const emailOfLength = (n: number) => 'a'.repeat(n - '@x.example'.length) + '@x.example';

describe('create_customer distribution email length', () => {
  it.each(['distributionEmailAddress', 'distributionEmailAddress2', 'distributionEmailAddress3'])(
    'rejects a 151 character %s without calling the API',
    async (field) => {
      const email = emailOfLength(151);
      expect(email).toHaveLength(151);
      const { inio, call } = await setup(impl());
      const result = await call({ ...ARGS, [field]: email });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/^Input validation error: /);
      expect(textOf(result)).toContain(field);
      expect(inio.post).not.toHaveBeenCalled();
    },
  );

  it.each(['distributionEmailAddress', 'distributionEmailAddress2', 'distributionEmailAddress3'])(
    'accepts a 150 character %s',
    async (field) => {
      const email = emailOfLength(150);
      expect(email).toHaveLength(150);
      const { inio, call } = await setup(impl());
      const result = await call({ ...ARGS, [field]: email });
      expect(result.isError).not.toBe(true);
      expect(inio.post).toHaveBeenCalledTimes(1);
    },
  );
});
