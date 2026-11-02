import { afterEach, describe, expect, it, vi } from 'vitest';
import { withToolLogging } from '../../src/tool-logging.ts';

type Content = Array<
  { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
>;
type Result = { content: Content; isError?: boolean };

function fakeLogger() {
  return {
    debug: vi.fn<(obj: object, msg?: string) => void>(),
    info: vi.fn<(obj: object, msg?: string) => void>(),
    warn: vi.fn<(obj: object, msg?: string) => void>(),
  };
}

function text(...texts: string[]): Result {
  return { content: texts.map((t) => ({ type: 'text' as const, text: t })) };
}

function clock(start: number, end: number) {
  vi.spyOn(performance, 'now').mockReturnValueOnce(start).mockReturnValueOnce(end);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('withToolLogging pass-through', () => {
  it('passes args and extra to the handler unchanged', async () => {
    const handler = vi.fn<(args: { id: string }, extra: { tag: string }) => Promise<Result>>(() =>
      Promise.resolve(text('x')),
    );
    const wrapped = withToolLogging(fakeLogger(), 't', handler);
    const args = { id: 'a' };
    const extra = { tag: 'e' };
    await wrapped(args, extra);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toBe(args);
    expect(handler.mock.calls[0]?.[1]).toBe(extra);
  });

  it('returns the handler result unchanged', async () => {
    const result = text('hello');
    const wrapped = withToolLogging(fakeLogger(), 't', () => Promise.resolve(result));
    await expect(wrapped({}, {})).resolves.toBe(result);
  });

  it('does not log before the handler settles', () => {
    const logger = fakeLogger();
    const wrapped = withToolLogging(logger, 't', () => new Promise<Result>(() => {}));
    void wrapped({}, {});
    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe('withToolLogging success line', () => {
  it('logs one info line with tool, durationMs, outcome, responseBytes and approxTokens', async () => {
    clock(1000, 1042);
    const logger = fakeLogger();
    const wrapped = withToolLogging(logger, 'get_invoice', () => Promise.resolve(text('abcde')));
    await wrapped({}, {});
    expect(logger.info.mock.calls).toEqual([
      [
        { tool: 'get_invoice', durationMs: 42, outcome: 'ok', responseBytes: 5, approxTokens: 2 },
        'tool call',
      ],
    ]);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('logs outcome error when the result has isError true', async () => {
    clock(0, 7);
    const logger = fakeLogger();
    const wrapped = withToolLogging(logger, 't', () =>
      Promise.resolve({ ...text('NOT_FOUND: x'), isError: true }),
    );
    await wrapped({}, {});
    expect(logger.info.mock.calls).toEqual([
      [
        { tool: 't', durationMs: 7, outcome: 'error', responseBytes: 12, approxTokens: 3 },
        'tool call',
      ],
    ]);
  });

  it('logs outcome ok when isError is false', async () => {
    const logger = fakeLogger();
    const wrapped = withToolLogging(logger, 't', () =>
      Promise.resolve({ ...text('x'), isError: false }),
    );
    await wrapped({}, {});
    expect(logger.info.mock.calls[0]?.[0]).toMatchObject({ outcome: 'ok' });
  });
});

describe('withToolLogging response size', () => {
  async function sizeOf(result: Result) {
    const logger = fakeLogger();
    await withToolLogging(logger, 't', () => Promise.resolve(result))({}, {});
    return logger.info.mock.calls[0]?.[0];
  }

  it('counts UTF-8 bytes, not string length', async () => {
    // 'ü' is 2 bytes: 4 * 2 + 1 = 9 bytes (string length 5)
    expect(await sizeOf(text('üüüüa'))).toMatchObject({ responseBytes: 9, approxTokens: 3 });
  });

  it('counts a 4-byte emoji as 4 bytes', async () => {
    expect(await sizeOf(text('\u{1F600}'))).toMatchObject({ responseBytes: 4, approxTokens: 1 });
  });

  it('sums the bytes of every text content item', async () => {
    expect(await sizeOf(text('abc', 'ü', 'de'))).toMatchObject({
      responseBytes: 7,
      approxTokens: 2,
    });
  });

  it('ignores non-text content items', async () => {
    const result: Result = {
      content: [
        { type: 'text', text: 'ab' },
        { type: 'image', data: 'aGVsbG8gd29ybGQ=', mimeType: 'image/png' },
      ],
    };
    expect(await sizeOf(result)).toMatchObject({ responseBytes: 2, approxTokens: 1 });
  });

  async function sizeOfLoose(content: Array<{ type: string; text?: string }>) {
    const logger = fakeLogger();
    await withToolLogging(logger, 't', () => Promise.resolve({ content }))({}, {});
    return logger.info.mock.calls[0]?.[0];
  }

  it('does not count the text field of a non-text item', async () => {
    const size = await sizeOfLoose([
      { type: 'text', text: 'ab' },
      { type: 'image', text: 'ignored-text' },
    ]);
    expect(size).toMatchObject({ responseBytes: 2, approxTokens: 1 });
  });

  it('counts a text item without text as 0 bytes', async () => {
    const size = await sizeOfLoose([{ type: 'text' }, { type: 'text', text: 'abcde' }]);
    expect(size).toMatchObject({ responseBytes: 5, approxTokens: 2 });
  });

  it('reports zero bytes and zero tokens for empty content', async () => {
    expect(await sizeOf({ content: [] })).toMatchObject({ responseBytes: 0, approxTokens: 0 });
  });

  it.each([
    [1, 1],
    [4, 1],
    [5, 2],
    [8, 2],
    [9, 3],
  ])('rounds %i bytes up to %i approx tokens', async (bytes, tokens) => {
    expect(await sizeOf(text('x'.repeat(bytes)))).toMatchObject({
      responseBytes: bytes,
      approxTokens: tokens,
    });
  });
});

describe('withToolLogging when the handler throws', () => {
  it('rethrows the same error', async () => {
    const boom = new Error('boom');
    const wrapped = withToolLogging(fakeLogger(), 't', () => Promise.reject(boom));
    await expect(wrapped({}, {})).rejects.toBe(boom);
  });

  it('logs outcome error with zero bytes and tokens before rethrowing', async () => {
    clock(500, 530);
    const logger = fakeLogger();
    const wrapped = withToolLogging(logger, 'get_invoice', () => Promise.reject(new Error('boom')));
    await wrapped({}, {}).catch(() => {});
    expect(logger.info.mock.calls).toEqual([
      [
        {
          tool: 'get_invoice',
          durationMs: 30,
          outcome: 'error',
          responseBytes: 0,
          approxTokens: 0,
        },
        'tool call',
      ],
    ]);
  });
});

describe('withToolLogging attribution', () => {
  const lineOf = (logger: ReturnType<typeof fakeLogger>) => logger.info.mock.calls[0]?.[0];
  const SENSITIVE = {
    id: 'i-1',
    number: 'N-1',
    customerId: 'c-1',
    customerNo: 'CN-1',
    pauseId: 'p-1',
    invoiceNo: 'INV-1',
    creditInvoiceNo: 'CR-1',
    amount: 123.45,
    email: 'a@b.example',
    ssn: '19800101-1234',
    reason: 'free text',
  };

  it('logs write: true and only the identifier args as target for a write', async () => {
    const logger = fakeLogger();
    const wrapped = withToolLogging(logger, 't', () => Promise.resolve(text('x')), { write: true });
    await wrapped(SENSITIVE, {});
    expect(lineOf(logger)).toMatchObject({
      write: true,
      target: {
        id: 'i-1',
        number: 'N-1',
        customerId: 'c-1',
        customerNo: 'CN-1',
        pauseId: 'p-1',
        invoiceNo: 'INV-1',
        creditInvoiceNo: 'CR-1',
      },
    });
  });

  it('never logs amounts, emails, SSN or free text', async () => {
    const logger = fakeLogger();
    const wrapped = withToolLogging(logger, 't', () => Promise.resolve(text('x')), { write: true });
    await wrapped(SENSITIVE, {});
    const logged = JSON.stringify(lineOf(logger));
    for (const v of ['123.45', 'a@b.example', '19800101-1234', 'free text']) {
      expect(logged).not.toContain(v);
    }
  });

  it('includes only the identifier keys present in the args', async () => {
    const logger = fakeLogger();
    const wrapped = withToolLogging(logger, 't', () => Promise.resolve(text('x')), { write: true });
    await wrapped({ customerId: 'c-1', amount: 5 }, {});
    expect(lineOf(logger)).toHaveProperty('target', { customerId: 'c-1' });
  });

  it('includes both identifiers of a credit-invoice call', async () => {
    const logger = fakeLogger();
    const wrapped = withToolLogging(logger, 't', () => Promise.resolve(text('x')), { write: true });
    await wrapped({ number: 'N-1', creditInvoiceNo: 'CR-1', amount: 5 }, {});
    expect(lineOf(logger)).toHaveProperty('target', { number: 'N-1', creditInvoiceNo: 'CR-1' });
  });

  it('omits target when no identifier is present', async () => {
    const logger = fakeLogger();
    const wrapped = withToolLogging(logger, 't', () => Promise.resolve(text('x')), { write: true });
    await wrapped({ amount: 5 }, {});
    expect(lineOf(logger)).toHaveProperty('write', true);
    expect(lineOf(logger)).not.toHaveProperty('target');
  });

  it('logs the write line on a handler error too, still once', async () => {
    const logger = fakeLogger();
    const wrapped = withToolLogging(logger, 't', () => Promise.reject(new Error('boom')), {
      write: true,
    });
    await expect(wrapped({ id: 'i-1' }, {})).rejects.toThrow('boom');
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(lineOf(logger)).toMatchObject({ outcome: 'error', write: true, target: { id: 'i-1' } });
  });

  it('adds no write or target for a read tool', async () => {
    const logger = fakeLogger();
    const wrapped = withToolLogging(logger, 't', () => Promise.resolve(text('x')));
    await wrapped({ id: 'i-1' }, {});
    expect(lineOf(logger)).not.toHaveProperty('write');
    expect(lineOf(logger)).not.toHaveProperty('target');
  });

  it('adds no write or target when write is false', async () => {
    const logger = fakeLogger();
    const wrapped = withToolLogging(logger, 't', () => Promise.resolve(text('x')), {
      write: false,
    });
    await wrapped({ id: 'i-1' }, {});
    expect(lineOf(logger)).not.toHaveProperty('write');
    expect(lineOf(logger)).not.toHaveProperty('target');
  });

  it('adds the client name and version when the getter returns them', async () => {
    const logger = fakeLogger();
    const client = () => ({ name: 'claude', version: '1.2.3' });
    const wrapped = withToolLogging(logger, 't', () => Promise.resolve(text('x')), { client });
    await wrapped({}, {});
    expect(lineOf(logger)).toMatchObject({ client: { name: 'claude', version: '1.2.3' } });
  });

  it('logs only name and version of the client', async () => {
    const logger = fakeLogger();
    const client = () => ({ name: 'claude', version: '1.2.3', title: 'extra' });
    const wrapped = withToolLogging(logger, 't', () => Promise.resolve(text('x')), { client });
    await wrapped({}, {});
    expect(lineOf(logger)).toHaveProperty('client', { name: 'claude', version: '1.2.3' });
  });

  it('omits client when the getter returns undefined', async () => {
    const logger = fakeLogger();
    const wrapped = withToolLogging(logger, 't', () => Promise.resolve(text('x')), {
      client: () => undefined,
    });
    await wrapped({}, {});
    expect(lineOf(logger)).not.toHaveProperty('client');
  });

  it('omits client when no getter is given', async () => {
    const logger = fakeLogger();
    await withToolLogging(logger, 't', () => Promise.resolve(text('x')))({}, {});
    expect(lineOf(logger)).not.toHaveProperty('client');
  });
});
