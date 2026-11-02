import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { registerGetInvoice } from '../../src/tools/get-invoice.ts';
import { InioApiError } from '../../src/inio-client.ts';

const ID = '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b';
const INVOICE = {
  id: ID,
  number: 'INV-1',
  total: 120.5,
  IBAN: 'BG80BNBG96611020345678',
  lines: [{ sku: 'a', qty: 2 }],
};

let mcpClient: Client | undefined;

afterEach(async () => {
  await mcpClient?.close();
  mcpClient = undefined;
});

async function setup(get: (path: string) => Promise<unknown>, revealPii = false) {
  const inio = { get: vi.fn<(path: string) => Promise<unknown>>(get) };
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerGetInvoice(server, { client: inio, revealPii });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  mcpClient = client;
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const call = (args: Record<string, unknown>) =>
    client.callTool({ name: 'get_invoice', arguments: args });
  return { inio, call, client };
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  expect(content).toHaveLength(1);
  expect(content[0]?.type).toBe('text');
  return content[0]?.text ?? '';
}

describe('get_invoice registration', () => {
  it('lists the tool as get_invoice', async () => {
    const { client } = await setup(() => Promise.resolve(INVOICE));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['get_invoice']);
  });

  it('marks the tool read-only and open-world', async () => {
    const { client } = await setup(() => Promise.resolve(INVOICE));
    const { tools } = await client.listTools();
    expect(tools[0]?.annotations?.readOnlyHint).toBe(true);
    expect(tools[0]?.annotations?.openWorldHint).toBe(true);
  });

  it('has the title "Get invoice"', async () => {
    const { client } = await setup(() => Promise.resolve(INVOICE));
    const { tools } = await client.listTools();
    expect(tools[0]?.title).toBe('Get invoice');
  });

  it('describes lookup by invoice number or UUID and says personal data is redacted', async () => {
    const { client } = await setup(() => Promise.resolve(INVOICE));
    const { tools } = await client.listTools();
    const description = tools[0]?.description ?? '';
    expect(description).toMatch(/invoice number/i);
    expect(description).toMatch(/UUID/i);
    expect(description).toMatch(/redacted/i);
  });

  it.each(['id', 'number'])('gives the %s input a non-empty description', async (key) => {
    const { client } = await setup(() => Promise.resolve(INVOICE));
    const { tools } = await client.listTools();
    expect(tools[0]?.inputSchema.properties).toMatchObject({
      [key]: { description: expect.stringMatching(/\S/) },
    });
  });

  it('advertises a strict input schema with id, number, withInherited and includeWorkflowSettings', async () => {
    const { client } = await setup(() => Promise.resolve(INVOICE));
    const { tools } = await client.listTools();
    const schema = tools[0]?.inputSchema;
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([
      'id',
      'includeWorkflowSettings',
      'number',
      'withInherited',
    ]);
    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', format: 'uuid' },
        number: { type: 'string', minLength: 1, maxLength: 100 },
        withInherited: { type: 'boolean', default: false },
        includeWorkflowSettings: { type: 'boolean', default: false },
      },
    });
  });
});

describe('get_invoice routing', () => {
  it('fetches by id from /invoices/<id>', async () => {
    const { inio, call } = await setup(() => Promise.resolve(INVOICE));
    await call({ id: ID });
    expect(inio.get).toHaveBeenCalledTimes(1);
    expect(inio.get).toHaveBeenCalledWith(`/invoices/${ID}`);
  });

  it('fetches by number from /invoices/by-number/<encoded number>', async () => {
    const { inio, call } = await setup(() => Promise.resolve(INVOICE));
    await call({ number: 'INV 1/2' });
    expect(inio.get).toHaveBeenCalledTimes(1);
    expect(inio.get).toHaveBeenCalledWith('/invoices/by-number/INV%201%2F2');
  });

  it('accepts a number of exactly 100 characters', async () => {
    const { inio, call } = await setup(() => Promise.resolve(INVOICE));
    const result = await call({ number: 'x'.repeat(100) });
    expect(result.isError).not.toBe(true);
    expect(inio.get).toHaveBeenCalledWith(`/invoices/by-number/${'x'.repeat(100)}`);
  });

  it('accepts a number with non-ASCII letters, plus and hash', async () => {
    const { inio, call } = await setup(() => Promise.resolve(INVOICE));
    const result = await call({ number: 'Kund-æøå+#1' });
    expect(result.isError).not.toBe(true);
    expect(inio.get).toHaveBeenCalledWith(
      `/invoices/by-number/${encodeURIComponent('Kund-æøå+#1')}`,
    );
  });

  it('accepts a number of exactly 1 character', async () => {
    const { inio, call } = await setup(() => Promise.resolve(INVOICE));
    const result = await call({ number: '7' });
    expect(result.isError).not.toBe(true);
    expect(inio.get).toHaveBeenCalledWith('/invoices/by-number/7');
  });
});

describe('get_invoice input validation', () => {
  // SDK v2 surfaces zod failures as a tool result with isError and
  // text "Input validation error: ...", not as a protocol error.
  // Fragments are what zod 4 emits for each rule.
  it.each([
    ['both id and number', { id: ID, number: 'INV-1' }, 'Provide exactly one of id or number.'],
    ['neither id nor number', {}, 'Provide exactly one of id or number.'],
    ['a non-uuid id', { id: 'not-a-uuid' }, 'id: Invalid UUID'],
    ['an extra key', { id: ID, extra: 1 }, 'Unrecognized key: "extra"'],
    [
      'an empty number',
      { number: '' },
      'number: Too small: expected string to have >=1 characters',
    ],
    [
      'a number over 100 characters',
      { number: 'x'.repeat(101) },
      'number: Too big: expected string to have <=100 characters',
    ],
    ['a number with CR/LF', { number: 'INV-1\r\nX-Injected: 1' }, 'number'],
    ['a number with a NUL', { number: 'INV\u00001' }, 'number'],
    ['a number with a tab', { number: 'INV\t1' }, 'number'],
    ['a number with DEL', { number: 'INV\u007f1' }, 'number'],
    [
      'a non-string number',
      { number: 42 },
      'number: Invalid input: expected string, received number',
    ],
  ])('rejects %s without calling the API', async (_label, args, fragment) => {
    const { inio, call } = await setup(() => Promise.resolve(INVOICE));
    const result = await call(args);
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toMatch(/^Input validation error: /);
    expect(text).toContain(fragment);
    expect(inio.get).not.toHaveBeenCalled();
  });

  it.each(['..', '.'])('rejects the number %j as an invalid path segment', async (number) => {
    const { inio, call } = await setup(() => Promise.resolve(INVOICE));
    const result = await call({ number });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Invalid path segment');
    expect(inio.get).not.toHaveBeenCalled();
  });
});

describe('get_invoice success', () => {
  it('returns the redacted invoice as compact JSON text', async () => {
    const { call } = await setup(() => Promise.resolve(INVOICE));
    const result = await call({ id: ID });
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toBe(JSON.stringify({ ...INVOICE, IBAN: '[redacted]' }));
  });

  it('drops empty values before redacting, so a null SSN is removed rather than "[redacted]"', async () => {
    const { call } = await setup(() =>
      Promise.resolve({ ...INVOICE, SSN: null, note: '', tags: [], meta: {} }),
    );
    const result = await call({ id: ID });
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toBe(JSON.stringify({ ...INVOICE, IBAN: '[redacted]' }));
  });

  it('redacts the pdfURL link', async () => {
    const withPdf = { ...INVOICE, pdfURL: 'https://files.example/inv-1.pdf' };
    const { call } = await setup(() => Promise.resolve(withPdf));
    const text = textOf(await call({ id: ID }));
    expect(text).toContain('"pdfURL":"[redacted]"');
    expect(text).not.toContain('files.example');
  });

  it('keeps the pdfURL link when revealPii is true', async () => {
    const withPdf = { ...INVOICE, pdfURL: 'https://files.example/inv-1.pdf' };
    const { call } = await setup(() => Promise.resolve(withPdf), true);
    expect(textOf(await call({ id: ID }))).toContain('"pdfURL":"https://files.example/inv-1.pdf"');
  });

  it('keeps PII when revealPii is true', async () => {
    const { call } = await setup(() => Promise.resolve(INVOICE), true);
    const result = await call({ id: ID });
    expect(textOf(result)).toBe(JSON.stringify(INVOICE));
  });

  it('does not return structuredContent', async () => {
    const { call } = await setup(() => Promise.resolve(INVOICE));
    const result = await call({ id: ID });
    expect(result.structuredContent).toBeUndefined();
  });

  it('does not advertise an output schema', async () => {
    const { client } = await setup(() => Promise.resolve(INVOICE));
    const { tools } = await client.listTools();
    expect(tools[0]?.outputSchema).toBeUndefined();
  });
});

const PII_INVOICE = {
  id: ID,
  number: 'INV-2',
  total: 99,
  digitalInvoiceURL: 'https://pay.inio.example/i/abc123',
  distributionEmailAddress: 'ap@customer.example',
  distributionEmailAddress2: 'cfo@customer.example',
  mobilePhoneNo: '+359888123456',
  zipCode: '1000',
  city: 'Sofia',
  countryCode: 'BG',
  shippingAddress: {
    addressLine1: '1 Main St',
    addressLine2: 'Floor 3',
    zipCode: '1000',
    city: 'Sofia',
    countryCode: 'BG',
  },
  histories: [
    { type: 'Sent', messageData: { from: 'billing@acme.example', subject: 'Invoice INV-2' } },
    { type: 'Note', text: 'Sent to a@b.example today' },
  ],
};

const PII_INVOICE_REDACTED = {
  id: ID,
  number: 'INV-2',
  total: 99,
  digitalInvoiceURL: '[redacted]',
  distributionEmailAddress: '[redacted]',
  distributionEmailAddress2: '[redacted]',
  mobilePhoneNo: '[redacted]',
  zipCode: '[redacted]',
  city: '[redacted]',
  countryCode: 'BG',
  shippingAddress: {
    addressLine1: '[redacted]',
    addressLine2: '[redacted]',
    zipCode: '[redacted]',
    city: '[redacted]',
    countryCode: 'BG',
  },
  histories: [
    { type: 'Sent', messageData: { from: '[redacted-email]', subject: 'Invoice INV-2' } },
    { type: 'Note', text: 'Sent to [redacted-email] today' },
  ],
};

describe('get_invoice PII redaction', () => {
  it('redacts contact, address, link and embedded emails when revealPii is false', async () => {
    const { call } = await setup(() => Promise.resolve(PII_INVOICE));
    const result = await call({ id: ID });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toEqual(PII_INVOICE_REDACTED);
  });

  it('returns every field unredacted when revealPii is true', async () => {
    const { call } = await setup(() => Promise.resolve(PII_INVOICE), true);
    const result = await call({ id: ID });
    expect(textOf(result)).toBe(JSON.stringify(PII_INVOICE));
  });
});

describe('get_invoice errors', () => {
  it('formats an InioApiError with its correlation id', async () => {
    const { call } = await setup(() =>
      Promise.reject(
        new InioApiError(404, 'NOT_FOUND', 'Invoice with number X could not be found', 'c-1'),
      ),
    );
    const result = await call({ number: 'X' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'NOT_FOUND: Invoice with number X could not be found (correlationId c-1)',
    );
  });

  it('omits the correlation parenthetical when the InioApiError has none', async () => {
    const { call } = await setup(() =>
      Promise.reject(
        new InioApiError(404, 'NOT_FOUND', 'Invoice with number X could not be found'),
      ),
    );
    const result = await call({ number: 'X' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('NOT_FOUND: Invoice with number X could not be found');
  });

  it('returns an auth failure message verbatim', async () => {
    const message =
      'Authentication failed (HTTP 401: invalid_client). Check INIO_CLIENT_ID and INIO_CLIENT_SECRET.';
    const { call } = await setup(() => Promise.reject(new Error(message)));
    const result = await call({ id: ID });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(message);
  });

  it.each([
    ['null', null],
    ['a string', 'oops'],
    ['a number', 42],
    ['undefined', undefined],
  ])('rejects %s as an unexpected upstream payload', async (_label, payload) => {
    const { call } = await setup(() => Promise.resolve(payload));
    const result = await call({ id: ID });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('UPSTREAM_ERROR: Unexpected invoice payload from the Inio API.');
  });
});

describe('get_invoice tool-call logging', () => {
  async function setupWithLogger(get: (path: string) => Promise<unknown>) {
    const logger = {
      debug: vi.fn<(obj: object, msg?: string) => void>(),
      info: vi.fn<(obj: object, msg?: string) => void>(),
      warn: vi.fn<(obj: object, msg?: string) => void>(),
    };
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerGetInvoice(server, { client: { get }, revealPii: false, logger });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    mcpClient = client;
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return { logger, client };
  }

  it('logs one tool call line with tool get_invoice and outcome ok', async () => {
    const { logger, client } = await setupWithLogger(() => Promise.resolve(INVOICE));
    const result = await client.callTool({ name: 'get_invoice', arguments: { id: ID } });
    const bytes = Buffer.byteLength(textOf(result), 'utf8');
    expect(logger.info.mock.calls).toEqual([
      [
        {
          tool: 'get_invoice',
          durationMs: expect.any(Number),
          outcome: 'ok',
          responseBytes: bytes,
          approxTokens: Math.ceil(bytes / 4),
        },
        'tool call',
      ],
    ]);
  });

  it('logs outcome error when the API call fails', async () => {
    const { logger, client } = await setupWithLogger(() =>
      Promise.reject(new InioApiError(404, 'NOT_FOUND', 'nope', 'c-1')),
    );
    await client.callTool({ name: 'get_invoice', arguments: { id: ID } });
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info.mock.calls[0]?.[0]).toMatchObject({
      tool: 'get_invoice',
      outcome: 'error',
    });
    expect(logger.info.mock.calls[0]?.[1]).toBe('tool call');
  });

  it('does not log invoice content or PII', async () => {
    const { logger, client } = await setupWithLogger(() => Promise.resolve(INVOICE));
    await client.callTool({ name: 'get_invoice', arguments: { id: ID } });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(INVOICE.IBAN);
  });
});

describe('get_invoice withInherited', () => {
  const INHERITED = { ...INVOICE, bankName: 'Acme Bank', effectivePause: { id: 'p-1' } };

  it('fetches /invoices/<id>/with-inherited once when given an id', async () => {
    const { inio, call } = await setup(() => Promise.resolve(INHERITED));
    const result = await call({ id: ID, withInherited: true });
    expect(result.isError).not.toBe(true);
    expect(inio.get).toHaveBeenCalledTimes(1);
    expect(inio.get).toHaveBeenCalledWith(`/invoices/${ID}/with-inherited`);
  });

  it('looks the invoice up by number first, then fetches with-inherited by the returned id', async () => {
    const { inio, call } = await setup((path) =>
      Promise.resolve(path.endsWith('/with-inherited') ? INHERITED : INVOICE),
    );
    const result = await call({ number: 'INV 1/2', withInherited: true });
    expect(result.isError).not.toBe(true);
    expect(inio.get.mock.calls).toEqual([
      ['/invoices/by-number/INV%201%2F2'],
      [`/invoices/${ID}/with-inherited`],
    ]);
  });

  it('returns the with-inherited response, redacted', async () => {
    const { call } = await setup((path) =>
      Promise.resolve(path.endsWith('/with-inherited') ? INHERITED : INVOICE),
    );
    const text = textOf(await call({ number: 'INV-1', withInherited: true }));
    expect(JSON.parse(text)).toStrictEqual({
      ...INHERITED,
      IBAN: '[redacted]',
    });
  });

  it('keeps PII in the with-inherited response when revealPii is true', async () => {
    const { call } = await setup(() => Promise.resolve(INHERITED), true);
    expect(JSON.parse(textOf(await call({ id: ID, withInherited: true })))).toStrictEqual(
      INHERITED,
    );
  });

  it('behaves as before when withInherited is false', async () => {
    const { inio, call } = await setup(() => Promise.resolve(INVOICE));
    await call({ id: ID, withInherited: false });
    expect(inio.get.mock.calls).toEqual([[`/invoices/${ID}`]]);
  });

  it.each([
    ['null', null],
    ['an array', [INVOICE]],
    ['an object without id', { number: 'INV-1' }],
    ['an object with a numeric id', { id: 5 }],
    ['an object with an empty id', { id: '' }],
    ['an object with a path-traversal id', { id: '../x' }],
    ['an object with a non-uuid id', { id: 'not-a-uuid' }],
  ])('rejects a first response that is %s without a second call', async (_label, first) => {
    const { inio, call } = await setup(() => Promise.resolve(first));
    const result = await call({ number: 'INV-1', withInherited: true });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('UPSTREAM_ERROR: Unexpected invoice payload from the Inio API.');
    expect(inio.get).toHaveBeenCalledTimes(1);
  });

  it('formats an error from the first call', async () => {
    const { inio, call } = await setup(() =>
      Promise.reject(new InioApiError(404, 'NOT_FOUND', 'No such invoice', 'c-1')),
    );
    const result = await call({ number: 'INV-1', withInherited: true });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('NOT_FOUND: No such invoice (correlationId c-1)');
    expect(inio.get).toHaveBeenCalledTimes(1);
  });

  it('formats an error from the with-inherited call', async () => {
    const { call } = await setup((path) =>
      path.endsWith('/with-inherited')
        ? Promise.reject(new InioApiError(500, 'INTERNAL', 'Boom', 'c-2'))
        : Promise.resolve(INVOICE),
    );
    const result = await call({ number: 'INV-1', withInherited: true });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('INTERNAL: Boom (correlationId c-2)');
  });

  it('rejects a non-boolean withInherited without calling the API', async () => {
    const { inio, call } = await setup(() => Promise.resolve(INVOICE));
    const result = await call({ id: ID, withInherited: 'yes' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('withInherited');
    expect(inio.get).not.toHaveBeenCalled();
  });
});

describe('get_invoice includeWorkflowSettings', () => {
  const WF = { invoicing1: { distribution: 'sms', enabled: true } };
  const WITH_WF = { ...INVOICE, workflowsSettings: WF };
  const INHERITED_WF = { ...WITH_WF, bankName: 'Acme Bank' };

  it('omits workflowsSettings by default', async () => {
    const { call } = await setup(() => Promise.resolve(WITH_WF));
    const text = textOf(await call({ id: ID }));
    expect(text).not.toContain('workflowsSettings');
    expect(JSON.parse(text)).toStrictEqual({ ...INVOICE, IBAN: '[redacted]' });
  });

  it('omits workflowsSettings when the flag is false', async () => {
    const { call } = await setup(() => Promise.resolve(WITH_WF));
    expect(textOf(await call({ id: ID, includeWorkflowSettings: false }))).not.toContain(
      'workflowsSettings',
    );
  });

  it('includes workflowsSettings when the flag is true', async () => {
    const { call } = await setup(() => Promise.resolve(WITH_WF));
    expect(JSON.parse(textOf(await call({ id: ID, includeWorkflowSettings: true })))).toStrictEqual(
      {
        ...INVOICE,
        IBAN: '[redacted]',
        workflowsSettings: WF,
      },
    );
  });

  it('works by number with the flag', async () => {
    const { inio, call } = await setup(() => Promise.resolve(WITH_WF));
    const text = textOf(await call({ number: 'INV-1', includeWorkflowSettings: true }));
    expect(text).toContain('"workflowsSettings"');
    expect(inio.get).toHaveBeenCalledWith('/invoices/by-number/INV-1');
  });

  it('omits workflowsSettings by default with withInherited by id', async () => {
    const { inio, call } = await setup(() => Promise.resolve(INHERITED_WF));
    const text = textOf(await call({ id: ID, withInherited: true }));
    expect(text).not.toContain('workflowsSettings');
    expect(text).toContain('"bankName":"Acme Bank"');
    expect(inio.get.mock.calls).toEqual([[`/invoices/${ID}/with-inherited`]]);
  });

  it('includes workflowsSettings with withInherited by id and the flag', async () => {
    const { call } = await setup(() => Promise.resolve(INHERITED_WF));
    const text = textOf(await call({ id: ID, withInherited: true, includeWorkflowSettings: true }));
    expect(text).toContain('"workflowsSettings"');
    expect(text).toContain('"bankName":"Acme Bank"');
  });

  it.each([
    [false, false],
    [true, true],
  ])(
    'with withInherited by number and flag %s, workflowsSettings present is %s',
    async (flag, present) => {
      const { inio, call } = await setup((path) =>
        Promise.resolve(path.endsWith('/with-inherited') ? INHERITED_WF : WITH_WF),
      );
      const text = textOf(
        await call({ number: 'INV-1', withInherited: true, includeWorkflowSettings: flag }),
      );
      expect(text.includes('"workflowsSettings"')).toBe(present);
      expect(text).toContain('"bankName":"Acme Bank"');
      expect(inio.get.mock.calls).toEqual([
        ['/invoices/by-number/INV-1'],
        [`/invoices/${ID}/with-inherited`],
      ]);
    },
  );

  it('rejects a non-boolean flag without calling the API', async () => {
    const { inio, call } = await setup(() => Promise.resolve(WITH_WF));
    const result = await call({ id: ID, includeWorkflowSettings: 'yes' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('includeWorkflowSettings');
    expect(inio.get).not.toHaveBeenCalled();
  });
});

describe('get_invoice customer-type redaction', () => {
  const CUSTOMER_ID = '7a1d2c3b-0000-4000-8000-00000000c001';
  const BIZ_INVOICE = {
    id: ID,
    customerId: CUSTOMER_ID,
    city: 'Sofia',
    customerName: 'Acme Ltd',
    addressLine1: 'Main St 1',
    zipCode: '1000',
    note: 'mail ops@acme.example',
    distributionEmailAddress: 'billing@acme.example',
    pdfURL: 'https://x.example/a.pdf',
    digitalInvoiceURL: 'https://x.example/view',
  };
  const BUSINESS_OUT = {
    ...BIZ_INVOICE,
    pdfURL: '[redacted]',
    digitalInvoiceURL: '[redacted]',
  };
  const CONSUMER_OUT = {
    id: ID,
    customerId: CUSTOMER_ID,
    city: '[redacted]',
    customerName: '[redacted]',
    addressLine1: '[redacted]',
    zipCode: '[redacted]',
    note: 'mail [redacted-email]',
    distributionEmailAddress: '[redacted]',
    pdfURL: '[redacted]',
    digitalInvoiceURL: '[redacted]',
  };
  const customerOf = (customerType: unknown) => ({
    externalCustomer: { id: CUSTOMER_ID, customerType },
    serviceLine: null,
    effectivePause: null,
  });

  /** Routes /customers/<id> to `customer`, everything else to the invoice. */
  function route(customer: () => Promise<unknown>, invoice: unknown = BIZ_INVOICE) {
    return (path: string) =>
      path.startsWith('/customers/') ? customer() : Promise.resolve(invoice);
  }

  async function setupWith(
    get: (path: string) => Promise<unknown>,
    revealPii = false,
    customerTypes?: Map<string, 'business' | 'consumer'>,
  ) {
    const inio = { get: vi.fn<(path: string) => Promise<unknown>>(get) };
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerGetInvoice(server, {
      client: inio,
      revealPii,
      ...(customerTypes ? { customerTypes } : {}),
    });
    const [st, ct] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    mcpClient = client;
    await Promise.all([server.connect(st), client.connect(ct)]);
    const call = (args: Record<string, unknown>) =>
      client.callTool({ name: 'get_invoice', arguments: args });
    return { inio, call };
  }

  const customerCalls = (inio: { get: { mock: { calls: unknown[][] } } }) =>
    inio.get.mock.calls.map(([p]) => String(p)).filter((p) => p.startsWith('/customers/'));

  it('applies business rules for a B customer and fetches /customers/<customerId>', async () => {
    const { inio, call } = await setupWith(route(() => Promise.resolve(customerOf('B'))));
    const result = await call({ id: ID });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toEqual(BUSINESS_OUT);
    expect(customerCalls(inio)).toEqual([`/customers/${CUSTOMER_ID}`]);
  });

  it('applies business rules when addressed by number', async () => {
    const { call } = await setupWith(route(() => Promise.resolve(customerOf('B'))));
    expect(JSON.parse(textOf(await call({ number: 'INV-1' })))).toEqual(BUSINESS_OUT);
  });

  it('applies business rules with withInherited and includeWorkflowSettings', async () => {
    const { call } = await setupWith(route(() => Promise.resolve(customerOf('B'))));
    const result = await call({ id: ID, withInherited: true, includeWorkflowSettings: true });
    expect(JSON.parse(textOf(result))).toEqual(BUSINESS_OUT);
  });

  it('encodes the customerId in the customer path', async () => {
    const { inio, call } = await setupWith(
      route(() => Promise.resolve(customerOf('B')), { ...BIZ_INVOICE, customerId: 'a/b c' }),
    );
    await call({ id: ID });
    expect(customerCalls(inio)).toEqual(['/customers/a%2Fb%20c']);
  });

  it('applies consumer rules for a C customer', async () => {
    const { call } = await setupWith(route(() => Promise.resolve(customerOf('C'))));
    expect(JSON.parse(textOf(await call({ id: ID })))).toEqual(CONSUMER_OUT);
  });

  it.each(['Company', '', 1, null, 'b'])(
    'applies consumer rules for customerType %j',
    async (type) => {
      const { call } = await setupWith(route(() => Promise.resolve(customerOf(type))));
      expect(JSON.parse(textOf(await call({ id: ID })))).toEqual(CONSUMER_OUT);
    },
  );

  it('applies consumer rules and still succeeds when the customer lookup throws', async () => {
    const { call } = await setupWith(
      route(() => Promise.reject(new InioApiError(404, 'NOT_FOUND', 'no customer'))),
    );
    const result = await call({ id: ID });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toEqual(CONSUMER_OUT);
  });

  it('does not cache a failed lookup', async () => {
    const lookups = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(customerOf('B'));
    const { inio, call } = await setupWith(route(lookups));
    expect(JSON.parse(textOf(await call({ id: ID })))).toEqual(CONSUMER_OUT);
    expect(JSON.parse(textOf(await call({ id: ID })))).toEqual(BUSINESS_OUT);
    expect(customerCalls(inio)).toHaveLength(2);
  });

  it.each([
    ['a string', 'oops'],
    ['null', null],
    ['an array', []],
    ['a number', 5],
  ])('applies consumer rules when the customer payload is %s', async (_label, payload) => {
    const { call } = await setupWith(route(() => Promise.resolve(payload)));
    const result = await call({ id: ID });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toEqual(CONSUMER_OUT);
  });

  it.each([
    ['a flat customer without externalCustomer', { id: CUSTOMER_ID, customerType: 'B' }],
    ['a null externalCustomer', { externalCustomer: null }],
    ['a string externalCustomer', { externalCustomer: 'B' }],
  ])('applies consumer rules and caches nothing for %s', async (_label, payload) => {
    const cache = new Map<string, 'business' | 'consumer'>();
    const { call } = await setupWith(
      route(() => Promise.resolve(payload)),
      false,
      cache,
    );
    expect(JSON.parse(textOf(await call({ id: ID })))).toEqual(CONSUMER_OUT);
    expect(cache.size).toBe(0);
  });

  it('does not cache a lookup whose payload is not an object', async () => {
    const lookups = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce('oops')
      .mockResolvedValue(customerOf('B'));
    const { call } = await setupWith(route(lookups));
    expect(JSON.parse(textOf(await call({ id: ID })))).toEqual(CONSUMER_OUT);
    expect(JSON.parse(textOf(await call({ id: ID })))).toEqual(BUSINESS_OUT);
  });

  it('applies consumer rules and makes no lookup when the invoice has no customerId', async () => {
    const { customerId: _, ...noCustomer } = BIZ_INVOICE;
    const { inio, call } = await setupWith(
      route(() => Promise.resolve(customerOf('B')), noCustomer),
    );
    expect(JSON.parse(textOf(await call({ id: ID })))).toEqual({
      ...CONSUMER_OUT,
      customerId: undefined,
    });
    expect(customerCalls(inio)).toEqual([]);
  });

  it.each([5, null, ['x']])('makes no lookup when customerId is %j', async (customerId) => {
    const { inio, call } = await setupWith(
      route(() => Promise.resolve(customerOf('B')), { ...BIZ_INVOICE, customerId }),
    );
    const result = await call({ id: ID });
    expect(result.isError).not.toBe(true);
    expect(customerCalls(inio)).toEqual([]);
    expect(JSON.parse(textOf(result)).city).toBe('[redacted]');
  });

  it('looks a customer up once across calls when a cache is shared', async () => {
    const cache = new Map<string, 'business' | 'consumer'>();
    const { inio, call } = await setupWith(
      route(() => Promise.resolve(customerOf('B'))),
      false,
      cache,
    );
    await call({ id: ID });
    const second = await call({ number: 'INV-2' });
    expect(JSON.parse(textOf(second))).toEqual(BUSINESS_OUT);
    expect(customerCalls(inio)).toHaveLength(1);
    expect(cache.get(CUSTOMER_ID)).toBe('business');
  });

  it('caches a consumer result too', async () => {
    const cache = new Map<string, 'business' | 'consumer'>();
    const { inio, call } = await setupWith(
      route(() => Promise.resolve(customerOf('C'))),
      false,
      cache,
    );
    await call({ id: ID });
    await call({ id: ID });
    expect(customerCalls(inio)).toHaveLength(1);
    expect(cache.get(CUSTOMER_ID)).toBe('consumer');
  });

  it('uses a cached type without any customer request', async () => {
    const cache = new Map<string, 'business' | 'consumer'>([[CUSTOMER_ID, 'business']]);
    const { inio, call } = await setupWith(
      route(() => Promise.reject(new Error('no'))),
      false,
      cache,
    );
    expect(JSON.parse(textOf(await call({ id: ID })))).toEqual(BUSINESS_OUT);
    expect(customerCalls(inio)).toEqual([]);
  });

  it('looks up each distinct customer separately', async () => {
    const { inio, call } = await setupWith((path) =>
      Promise.resolve(
        path.startsWith('/customers/')
          ? customerOf('B')
          : { ...BIZ_INVOICE, customerId: path.includes('INV-A') ? 'cust-a' : 'cust-b' },
      ),
    );
    await call({ number: 'INV-A' });
    await call({ number: 'INV-B' });
    expect(customerCalls(inio)).toEqual(['/customers/cust-a', '/customers/cust-b']);
  });

  it('makes no customer lookup and returns everything when revealPii is true', async () => {
    const { inio, call } = await setupWith(
      route(() => Promise.resolve(customerOf('B'))),
      true,
    );
    expect(textOf(await call({ id: ID }))).toBe(JSON.stringify(BIZ_INVOICE));
    expect(customerCalls(inio)).toEqual([]);
  });

  it('works without a cache dependency', async () => {
    const { call } = await setupWith(route(() => Promise.resolve(customerOf('B'))));
    expect(JSON.parse(textOf(await call({ id: ID })))).toEqual(BUSINESS_OUT);
  });

  it('keeps the cache below 1000 entries by clearing it when full', async () => {
    const cache = new Map<string, 'business' | 'consumer'>();
    for (let i = 0; i < 999; i++) cache.set(`old-${i}`, 'consumer');
    const { call } = await setupWith(
      route(() => Promise.resolve(customerOf('B'))),
      false,
      cache,
    );
    await call({ id: ID });
    expect(cache.size).toBe(1000);
    expect(cache.has('old-0')).toBe(true);
    // Next new customer finds the map at 1000: clear, then insert.
    const { call: call2 } = await setupWith(
      (path) =>
        Promise.resolve(
          path.startsWith('/customers/')
            ? customerOf('B')
            : { ...BIZ_INVOICE, customerId: 'new-1' },
        ),
      false,
      cache,
    );
    await call2({ id: ID });
    expect([...cache.keys()]).toEqual(['new-1']);
  });
});
