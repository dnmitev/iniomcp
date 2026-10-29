import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInioClient, InioApiError, pathSegment } from '../../src/inio-client.ts';

const API_URL = 'https://api.example/v1';
const TOKEN = 'tok-AAA-111-do-not-leak';
const TOKEN2 = 'tok-BBB-222-do-not-leak';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function ok(result: unknown): Response {
  return json({ success: true, status: 200, correlationId: 'c-ok', result });
}

const notFound = {
  success: false,
  status: 404,
  code: 'NOT_FOUND',
  message: 'Invoice with number X could not be found',
  correlationId: 'c-1',
};

const unauthorized = {
  success: false,
  status: 401,
  code: 'UNAUTHORIZED',
  message: 'Unauthorized',
  correlationId: 'c-401',
};

function setup(responses: Array<Response | Error>) {
  const queue = [...responses];
  const fetch = vi.fn<typeof globalThis.fetch>(() => {
    const next = queue.shift();
    if (!next) return Promise.reject(new Error('unexpected extra fetch'));
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  const tokenQueue = [TOKEN, TOKEN2];
  const tokens = {
    getToken: vi.fn<() => Promise<string>>(() =>
      Promise.resolve(tokenQueue.shift() ?? 'tok-extra'),
    ),
    invalidate: vi.fn<() => void>(),
  };
  const logger = {
    debug: vi.fn<(obj: object, msg?: string) => void>(),
    warn: vi.fn<(obj: object, msg?: string) => void>(),
  };
  const sleep = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());
  const client = createInioClient({ apiUrl: API_URL, tokens, fetch, logger, sleep });
  return { client, fetch, tokens, logger, sleep };
}

async function apiErrorOf(p: Promise<unknown>): Promise<InioApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof InioApiError) return e;
    throw new Error('expected InioApiError', { cause: e });
  }
  throw new Error('expected promise to reject');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const rateLimited = {
  success: false,
  status: 429,
  code: 'TOO_MANY_REQUESTS',
  message: 'slow down',
  correlationId: 'c-429',
};

function tooMany(retryAfter?: string): Response {
  return new Response(JSON.stringify(rateLimited), {
    status: 429,
    headers: {
      'content-type': 'application/json',
      ...(retryAfter === undefined ? {} : { 'retry-after': retryAfter }),
    },
  });
}

describe('createInioClient', () => {
  describe('request', () => {
    it('sends GET to apiUrl + path', async () => {
      const { client, fetch } = setup([ok({})]);
      await client.get('/invoices/abc');
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0] ?? [];
      expect(url).toBe('https://api.example/v1/invoices/abc');
      expect(init?.method ?? 'GET').toBe('GET');
    });

    it('sends the bearer token in the Authorization header', async () => {
      const { client, fetch } = setup([ok({})]);
      await client.get('/invoices/abc');
      const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
      expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    });

    it('sends Accept: application/json', async () => {
      const { client, fetch } = setup([ok({})]);
      await client.get('/invoices/abc');
      const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
      expect(headers.get('accept')).toBe('application/json');
    });
  });

  describe('success', () => {
    it("returns the envelope's result", async () => {
      const invoice = { id: 'abc', invoiceNo: 'INV-1', amount: 12.5 };
      const { client } = setup([ok(invoice)]);
      await expect(client.get('/invoices/abc')).resolves.toEqual(invoice);
    });

    it('returns a falsy result unchanged', async () => {
      const { client } = setup([ok(0)]);
      await expect(client.get('/count')).resolves.toBe(0);
    });
  });

  describe('401 handling', () => {
    it('invalidates the token and retries once with a fresh token', async () => {
      const { client, fetch, tokens } = setup([json(unauthorized, 401), ok({ id: 'abc' })]);
      await expect(client.get('/invoices/abc')).resolves.toEqual({ id: 'abc' });
      expect(tokens.invalidate).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(2);
      const headers = new Headers(fetch.mock.calls[1]?.[1]?.headers);
      expect(headers.get('authorization')).toBe(`Bearer ${TOKEN2}`);
    });

    it('throws InioApiError with status 401 when the retry is also 401', async () => {
      const { client, fetch } = setup([json(unauthorized, 401), json(unauthorized, 401)]);
      const err = await apiErrorOf(client.get('/invoices/abc'));
      expect(err.status).toBe(401);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('does not invalidate or retry on non-401 errors', async () => {
      const { client, fetch, tokens } = setup([json(notFound, 404)]);
      await apiErrorOf(client.get('/invoices/abc'));
      expect(tokens.invalidate).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('429 handling', () => {
    it('waits the Retry-After seconds, retries once and returns the result', async () => {
      const { client, fetch, sleep } = setup([tooMany('2'), ok({ id: 'abc' })]);
      await expect(client.get('/invoices/abc')).resolves.toEqual({ id: 'abc' });
      expect(sleep.mock.calls).toEqual([[2000]]);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('retries with the same URL (including query) and headers', async () => {
      const { client, fetch } = setup([tooMany('1'), ok({})]);
      await client.get('/invoices', {
        query: { status: ['open', 'open'], limit: 2 },
        headers: { 'x-extra': 'v' },
      });
      const [first, second] = fetch.mock.calls;
      expect(second?.[0]).toBe('https://api.example/v1/invoices?status=open&status=open&limit=2');
      expect(second?.[0]).toBe(first?.[0]);
      expect(second?.[1]).toEqual({ ...first?.[1], signal: expect.any(AbortSignal) });
      expect(new Headers(second?.[1]?.headers).get('x-extra')).toBe('v');
    });

    it('waits 0 ms for Retry-After: 0', async () => {
      const { client, sleep } = setup([tooMany('0'), ok({})]);
      await client.get('/x');
      expect(sleep.mock.calls).toEqual([[0]]);
    });

    it('honors a Retry-After HTTP date', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const { client, sleep } = setup([
        tooMany(new Date('2026-01-01T00:00:03Z').toUTCString()),
        ok({}),
      ]);
      await client.get('/x');
      expect(sleep.mock.calls).toEqual([[3000]]);
    });

    it('caps a far-future Retry-After HTTP date at 5000 ms', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const { client, sleep } = setup([
        tooMany(new Date('2026-01-01T00:01:00Z').toUTCString()),
        ok({}),
      ]);
      await client.get('/x');
      expect(sleep.mock.calls).toEqual([[5000]]);
    });

    it.each([
      ['missing', undefined],
      ['not a number', 'abc'],
      ['negative', '-3'],
      ['empty', ''],
    ])('waits 1000 ms when Retry-After is %s', async (_label, value) => {
      const { client, sleep } = setup([tooMany(value), ok({})]);
      await client.get('/x');
      expect(sleep.mock.calls).toEqual([[1000]]);
    });

    it('caps the wait at 5000 ms', async () => {
      const { client, sleep } = setup([tooMany('60'), ok({})]);
      await client.get('/x');
      expect(sleep.mock.calls).toEqual([[5000]]);
    });

    it('waits exactly 5000 ms for Retry-After: 5', async () => {
      const { client, sleep } = setup([tooMany('5'), ok({})]);
      await client.get('/x');
      expect(sleep.mock.calls).toEqual([[5000]]);
    });

    it('throws RATE_LIMITED when the retry is also 429, after exactly two fetches', async () => {
      const { client, fetch } = setup([tooMany('1'), tooMany('7')]);
      const err = await apiErrorOf(client.get('/invoices/abc'));
      expect(err.status).toBe(429);
      expect(err.code).toBe('RATE_LIMITED');
      expect(err.message).toBe('The Inio API rate limit was reached. Try again in 7 s.');
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('reports the API value (not the capped wait) in the message', async () => {
      const { client } = setup([tooMany('1'), tooMany('60')]);
      const err = await apiErrorOf(client.get('/x'));
      expect(err.message).toBe('The Inio API rate limit was reached. Try again in 60 s.');
    });

    it.each([
      ['missing', undefined, 1],
      ['0', '0', 1],
      ['invalid', 'abc', 1],
      ['fractional', '2.5', 3],
    ])('reports at least 1 s and rounds up when the second Retry-After is %s', async (_l, v, n) => {
      const { client } = setup([tooMany('1'), tooMany(v)]);
      const err = await apiErrorOf(client.get('/x'));
      expect(err.message).toBe(`The Inio API rate limit was reached. Try again in ${n} s.`);
    });

    it('sleeps only once when the retry is also 429', async () => {
      const { client, sleep } = setup([tooMany('1'), tooMany('1')]);
      await apiErrorOf(client.get('/x'));
      expect(sleep).toHaveBeenCalledTimes(1);
    });

    it('logs a "rate limited" warning with the path, status and wait, never the query', async () => {
      const { client, logger } = setup([tooMany('2'), ok({})]);
      await client.get('/invoices', { query: { customerNo: 'SECRET-Q' } });
      expect(logger.warn.mock.calls).toContainEqual([
        { method: 'GET', path: '/invoices', status: 429, waitMs: 2000 },
        'rate limited',
      ]);
      expect(JSON.stringify([logger.warn.mock.calls, logger.debug.mock.calls])).not.toContain(
        'SECRET-Q',
      );
    });

    it('logs "rate limited" only for the 429 that is waited on, then the final upstream error', async () => {
      const { client, logger } = setup([tooMany('1'), tooMany('2')]);
      await apiErrorOf(client.get('/x', { query: { a: 'SECRET-Q' } }));
      const lines = logger.warn.mock.calls.filter(([, msg]) => msg === 'rate limited');
      expect(lines).toEqual([
        [{ method: 'GET', path: '/x', status: 429, waitMs: 1000 }, 'rate limited'],
      ]);
      expect(logger.warn.mock.calls).toContainEqual([
        expect.objectContaining({ method: 'GET', path: '/x', status: 429, code: 'RATE_LIMITED' }),
        'upstream error',
      ]);
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('SECRET-Q');
    });

    it('retries after a 429 with a null body', async () => {
      const first = new Response(null, { status: 429, headers: { 'retry-after': '0' } });
      const { client, fetch } = setup([first, ok({ id: 'abc' })]);
      await expect(client.get('/x')).resolves.toEqual({ id: 'abc' });
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('throws RATE_LIMITED, not a TypeError, when both 429s have null bodies', async () => {
      const { client } = setup([
        new Response(null, { status: 429, headers: { 'retry-after': '0' } }),
        new Response(null, { status: 429, headers: { 'retry-after': '0' } }),
      ]);
      const err = await apiErrorOf(client.get('/x'));
      expect(err.code).toBe('RATE_LIMITED');
      expect(err.status).toBe(429);
    });

    it('cancels the 429 response body before retrying', async () => {
      const cancel = vi.fn<() => void>();
      const first = new Response(new ReadableStream({ cancel }), {
        status: 429,
        headers: { 'retry-after': '1' },
      });
      const { client } = setup([first, ok({})]);
      await client.get('/x');
      expect(cancel).toHaveBeenCalledTimes(1);
    });

    it('succeeds on 401, then 429, then 200', async () => {
      const { client, fetch, tokens, sleep } = setup([
        json(unauthorized, 401),
        tooMany('1'),
        ok({ id: 'abc' }),
      ]);
      await expect(client.get('/x')).resolves.toEqual({ id: 'abc' });
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(tokens.invalidate).toHaveBeenCalledTimes(1);
      expect(sleep).toHaveBeenCalledTimes(1);
    });

    it('sends the fresh token on the request after a 401 then a 429', async () => {
      const { client, fetch, tokens } = setup([
        json(unauthorized, 401),
        tooMany('1'),
        ok({ id: 'abc' }),
      ]);
      let current = TOKEN;
      tokens.getToken.mockImplementation(() => Promise.resolve(current));
      tokens.invalidate.mockImplementation(() => {
        current = TOKEN2;
      });
      await client.get('/x');
      const auth = fetch.mock.calls.map(([, init]) =>
        new Headers(init?.headers).get('authorization'),
      );
      expect(auth).toEqual([`Bearer ${TOKEN}`, `Bearer ${TOKEN2}`, `Bearer ${TOKEN2}`]);
    });

    it('succeeds on 429, then 401, then 200', async () => {
      const { client, fetch, tokens, sleep } = setup([
        tooMany('1'),
        json(unauthorized, 401),
        ok({ id: 'abc' }),
      ]);
      await expect(client.get('/x')).resolves.toEqual({ id: 'abc' });
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(tokens.invalidate).toHaveBeenCalledTimes(1);
      expect(sleep).toHaveBeenCalledTimes(1);
    });
  });

  describe('errors', () => {
    it('maps an error envelope to InioApiError with its fields', async () => {
      const { client } = setup([json(notFound, 404)]);
      const err = await apiErrorOf(client.get('/invoices/by-number/X'));
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('InioApiError');
      expect(err.status).toBe(404);
      expect(err.code).toBe('NOT_FOUND');
      expect(err.message).toBe('Invoice with number X could not be found');
      expect(err.correlationId).toBe('c-1');
    });

    it('maps a non-JSON body to a generic UPSTREAM_ERROR', async () => {
      const { client } = setup([
        new Response('<html>502 Bad Gateway</html>', {
          status: 502,
          headers: { 'content-type': 'text/html' },
        }),
      ]);
      const err = await apiErrorOf(client.get('/invoices/abc'));
      expect(err.status).toBe(502);
      expect(err.code).toBe('UPSTREAM_ERROR');
      expect(err.message).toBe('Unexpected response from the Inio API (HTTP 502).');
    });

    it('maps an unexpected JSON error body to a generic UPSTREAM_ERROR', async () => {
      const { client } = setup([json({ oops: true }, 500)]);
      const err = await apiErrorOf(client.get('/invoices/abc'));
      expect(err.status).toBe(500);
      expect(err.code).toBe('UPSTREAM_ERROR');
      expect(err.message).toBe('Unexpected response from the Inio API (HTTP 500).');
    });

    it('maps a 2xx JSON body without result to UPSTREAM_ERROR', async () => {
      const { client } = setup([json({ success: true, status: 200, correlationId: 'c-2' })]);
      const err = await apiErrorOf(client.get('/invoices/abc'));
      expect(err.status).toBe(200);
      expect(err.code).toBe('UPSTREAM_ERROR');
      expect(err.message).toBe('Unexpected response from the Inio API (HTTP 200).');
    });

    it('maps a rejected fetch to a NETWORK_ERROR without leaking the cause', async () => {
      const { client } = setup([new TypeError('connect ECONNREFUSED LEAK-MARKER')]);
      const err = await apiErrorOf(client.get('/invoices/abc'));
      expect(err.status).toBe(0);
      expect(err.code).toBe('NETWORK_ERROR');
      expect(err.message).toBe('Cannot reach the Inio API (INIO_URL).');
      expect(err.message).not.toContain('LEAK-MARKER');
    });

    it('maps an error envelope without correlationId to InioApiError', async () => {
      const { client } = setup([
        json({ success: false, status: 404, code: 'NOT_FOUND', message: 'x' }, 404),
      ]);
      const err = await apiErrorOf(client.get('/invoices/abc'));
      expect(err.status).toBe(404);
      expect(err.code).toBe('NOT_FOUND');
      expect(err.message).toBe('x');
      expect(err.correlationId).toBeUndefined();
    });

    it('never includes the token in a thrown error message', async () => {
      const bodies = [
        json({ ...notFound, message: 'not found' }, 404),
        new Response('<html>bad</html>', { status: 502 }),
        json({}, 200),
      ];
      for (const body of bodies) {
        const { client } = setup([body]);
        const err = await apiErrorOf(client.get('/invoices/abc'));
        expect(err.message).not.toContain(TOKEN);
        expect(err.message).not.toContain('tok-');
      }
    });
  });

  describe('debug logging', () => {
    it('logs each upstream request with method, path, status and durationMs', async () => {
      vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(125);
      const { client, logger } = setup([ok({})]);
      await client.get('/invoices/abc');
      expect(logger.debug.mock.calls).toEqual([
        [{ method: 'GET', path: '/invoices/abc', status: 200, durationMs: 25 }, 'upstream request'],
      ]);
    });

    it('logs one entry per attempt on a 401 retry', async () => {
      const { client, logger } = setup([json(unauthorized, 401), ok({})]);
      await client.get('/invoices/abc');
      expect(logger.debug.mock.calls.map(([obj]) => obj)).toEqual([
        expect.objectContaining({ status: 401 }),
        expect.objectContaining({ status: 200 }),
      ]);
    });

    it('logs a path without a query string', async () => {
      const { client, logger } = setup([ok({})]);
      await client.get('/invoices/abc');
      expect(logger.debug.mock.calls[0]?.[0]).toHaveProperty('path', '/invoices/abc');
      expect(JSON.stringify(logger.debug.mock.calls)).not.toContain('?');
    });

    it('never logs the token', async () => {
      const { client, logger } = setup([json(unauthorized, 401), ok({})]);
      await client.get('/invoices/abc');
      const logged = JSON.stringify(logger.debug.mock.calls);
      expect(logged).not.toContain(TOKEN);
      expect(logged).not.toContain(TOKEN2);
      expect(logged).not.toContain('tok-');
    });
  });

  describe('warn logging', () => {
    it('logs a non-2xx Inio error with method, path, status, code and correlationId', async () => {
      const { client, logger } = setup([json(notFound, 404)]);
      await client.get('/invoices/by-number/X').catch(() => {});
      expect(logger.warn.mock.calls).toEqual([
        [
          {
            method: 'GET',
            path: '/invoices/by-number/X',
            status: 404,
            code: 'NOT_FOUND',
            correlationId: 'c-1',
          },
          'upstream error',
        ],
      ]);
    });

    it('logs code UPSTREAM_ERROR and no correlationId for a non-envelope 5xx', async () => {
      const { client, logger } = setup([new Response('<html>bad gateway</html>', { status: 502 })]);
      await client.get('/invoices/abc').catch(() => {});
      expect(logger.warn).toHaveBeenCalledTimes(1);
      const [obj, msg] = logger.warn.mock.calls[0] ?? [];
      expect(msg).toBe('upstream error');
      expect(obj).toEqual({
        method: 'GET',
        path: '/invoices/abc',
        status: 502,
        code: 'UPSTREAM_ERROR',
        correlationId: undefined,
      });
    });

    it('logs once, for the final response, when the 401 retry is also 401', async () => {
      const { client, logger } = setup([json(unauthorized, 401), json(unauthorized, 401)]);
      await client.get('/invoices/abc').catch(() => {});
      expect(logger.warn.mock.calls).toEqual([
        [
          {
            method: 'GET',
            path: '/invoices/abc',
            status: 401,
            code: 'UNAUTHORIZED',
            correlationId: 'c-401',
          },
          'upstream error',
        ],
      ]);
    });

    it('does not warn when a 401 is recovered by the retry', async () => {
      const { client, logger } = setup([json(unauthorized, 401), ok({})]);
      await client.get('/invoices/abc');
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('does not warn on success', async () => {
      const { client, logger } = setup([ok({ id: 'abc' })]);
      await client.get('/invoices/abc');
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('logs a network error with status 0 and code NETWORK_ERROR', async () => {
      const { client, logger } = setup([new TypeError('fetch failed: getaddrinfo api.internal')]);
      await client.get('/invoices/abc').catch(() => {});
      expect(logger.warn).toHaveBeenCalledTimes(1);
      const [obj, msg] = logger.warn.mock.calls[0] ?? [];
      expect(msg).toBe('upstream error');
      expect(obj).toEqual({
        method: 'GET',
        path: '/invoices/abc',
        status: 0,
        code: 'NETWORK_ERROR',
      });
    });

    it('still throws the same InioApiError after logging a network error', async () => {
      const { client } = setup([new TypeError('fetch failed')]);
      const err = await apiErrorOf(client.get('/invoices/abc'));
      expect(err.code).toBe('NETWORK_ERROR');
      expect(err.status).toBe(0);
    });

    it('never logs the token or network cause in warn lines', async () => {
      const { client, logger } = setup([
        json(unauthorized, 401),
        new TypeError('fetch failed: getaddrinfo api.internal'),
      ]);
      await client.get('/invoices/abc').catch(() => {});
      const logged = JSON.stringify(logger.warn.mock.calls);
      expect(logged).not.toContain('tok-');
      expect(logged).not.toContain('api.internal');
    });
  });
});

describe('pathSegment', () => {
  it.each([
    ['a/b?c', 'a%2Fb%3Fc'],
    ['a#b', 'a%23b'],
    ['INV 1', 'INV%201'],
    ['../admin', '..%2Fadmin'],
    ['INV-2024-001', 'INV-2024-001'],
  ])('encodes %j as %j', (input, expected) => {
    expect(pathSegment(input)).toBe(expected);
  });

  it.each(['.', '..'])('rejects the dot segment %j, which URL parsing would resolve', (input) => {
    expect(() => pathSegment(input)).toThrow(new Error(`Invalid path segment: ${input}`));
  });

  it('keeps an encoded value inside its path segment when joined', () => {
    const url = new URL(`${API_URL}/invoices/by-number/${pathSegment('../../x?y#z')}`);
    expect(url.pathname).toBe('/v1/invoices/by-number/..%2F..%2Fx%3Fy%23z');
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
  });
});

describe('createInioClient query and headers', () => {
  function urlOf(fetch: ReturnType<typeof setup>['fetch'], call = 0): unknown {
    return fetch.mock.calls[call]?.[0];
  }

  function headersOf(fetch: ReturnType<typeof setup>['fetch'], call = 0): Headers {
    return new Headers(fetch.mock.calls[call]?.[1]?.headers);
  }

  it('appends defined query entries in insertion order and drops undefined ones', async () => {
    const { client, fetch } = setup([ok({})]);
    await client.get('/customers', {
      query: { limit: 25, offset: 0, customerNo: undefined, directDebit: false },
    });
    expect(urlOf(fetch)).toBe(
      'https://api.example/v1/customers?limit=25&offset=0&directDebit=false',
    );
  });

  it('serialises true as "true"', async () => {
    const { client, fetch } = setup([ok({})]);
    await client.get('/customers', { query: { directDebit: true } });
    expect(urlOf(fetch)).toBe('https://api.example/v1/customers?directDebit=true');
  });

  it('URL-encodes query values', async () => {
    const { client, fetch } = setup([ok({})]);
    await client.get('/customers', { query: { customerNo: 'a b&c=æ' } });
    expect(urlOf(fetch)).toBe('https://api.example/v1/customers?customerNo=a+b%26c%3D%C3%A6');
  });

  it('URL-encodes query keys', async () => {
    const { client, fetch } = setup([ok({})]);
    await client.get('/customers', { query: { 'a&b': 'x' } });
    expect(urlOf(fetch)).toBe('https://api.example/v1/customers?a%26b=x');
  });

  it('keeps an empty-string value', async () => {
    const { client, fetch } = setup([ok({})]);
    await client.get('/customers', { query: { customerNo: '' } });
    expect(urlOf(fetch)).toBe('https://api.example/v1/customers?customerNo=');
  });

  it('adds no "?" when every query value is undefined', async () => {
    const { client, fetch } = setup([ok({})]);
    await client.get('/customers', { query: { customerNo: undefined } });
    expect(urlOf(fetch)).toBe('https://api.example/v1/customers');
  });

  it('appends each array element as a repeated key, in order', async () => {
    const { client, fetch } = setup([ok({})]);
    await client.get('/invoices', { query: { status: ['open', 'paused'], limit: 25 } });
    expect(urlOf(fetch)).toBe('https://api.example/v1/invoices?status=open&status=paused&limit=25');
  });

  it('skips empty arrays and keeps scalar entries around them', async () => {
    const { client, fetch } = setup([ok({})]);
    await client.get('/invoices', { query: { limit: 5, status: [], offset: 0 } });
    expect(urlOf(fetch)).toBe('https://api.example/v1/invoices?limit=5&offset=0');
  });

  it('adds no "?" when the only query value is an empty array', async () => {
    const { client, fetch } = setup([ok({})]);
    await client.get('/invoices', { query: { status: [] } });
    expect(urlOf(fetch)).toBe('https://api.example/v1/invoices');
  });

  it('URL-encodes array elements and keeps duplicates', async () => {
    const { client, fetch } = setup([ok({})]);
    await client.get('/invoices', { query: { status: ['a b&c', 'a b&c'] } });
    expect(urlOf(fetch)).toBe('https://api.example/v1/invoices?status=a+b%26c&status=a+b%26c');
  });

  it('does not log array query values', async () => {
    const { client, logger } = setup([ok({})]);
    await client.get('/invoices', { query: { status: ['SECRET-Q'] } });
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain('SECRET-Q');
  });

  it('adds no "?" for an empty query object', async () => {
    const { client, fetch } = setup([ok({})]);
    await client.get('/customers', { query: {} });
    expect(urlOf(fetch)).toBe('https://api.example/v1/customers');
  });

  it('adds no "?" when options carry only headers', async () => {
    const { client, fetch } = setup([ok({})]);
    await client.get('/customers', { headers: { 'x-customer-no': 'C-1' } });
    expect(urlOf(fetch)).toBe('https://api.example/v1/customers');
  });

  it('sends extra headers alongside authorization and accept', async () => {
    const { client, fetch } = setup([ok({})]);
    await client.get('/customers', { headers: { 'x-customer-no': 'C-1' } });
    const headers = headersOf(fetch);
    expect(headers.get('x-customer-no')).toBe('C-1');
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(headers.get('accept')).toBe('application/json');
  });

  it.each(['authorization', 'Authorization', 'AUTHORIZATION'])(
    'does not let a caller %s header replace the bearer token',
    async (name) => {
      const { client, fetch } = setup([ok({})]);
      await client.get('/customers', { headers: { [name]: 'Bearer evil' } });
      expect(headersOf(fetch).get('authorization')).toBe(`Bearer ${TOKEN}`);
    },
  );

  it.each(['accept', 'Accept', 'ACCEPT'])(
    'does not let a caller %s header replace accept: application/json',
    async (name) => {
      const { client, fetch } = setup([ok({})]);
      await client.get('/customers', { headers: { [name]: 'text/html' } });
      expect(headersOf(fetch).get('accept')).toBe('application/json');
    },
  );

  it('retries a 401 that has no body', async () => {
    const { client, fetch } = setup([new Response(null, { status: 401 }), ok({ id: 'abc' })]);
    await expect(client.get('/invoices/abc')).resolves.toEqual({ id: 'abc' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('re-sends the same URL and extra headers on the 401 retry', async () => {
    const { client, fetch } = setup([json(unauthorized, 401), ok({})]);
    await client.get('/customers', {
      query: { limit: 10 },
      headers: { 'x-customer-no': 'C-1' },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(urlOf(fetch, 1)).toBe('https://api.example/v1/customers?limit=10');
    const headers = headersOf(fetch, 1);
    expect(headers.get('x-customer-no')).toBe('C-1');
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN2}`);
  });

  it('logs the debug path without the query string', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(110);
    const { client, logger } = setup([ok({})]);
    await client.get('/customers', { query: { customerNo: 'SECRET-Q' } });
    expect(logger.debug.mock.calls).toEqual([
      [{ method: 'GET', path: '/customers', status: 200, durationMs: 10 }, 'upstream request'],
    ]);
  });

  it('logs the warn path without the query string', async () => {
    const { client, logger } = setup([json(notFound, 404)]);
    await client.get('/customers', { query: { customerNo: 'SECRET-Q' } }).catch(() => {});
    expect(logger.warn.mock.calls).toEqual([
      [
        { method: 'GET', path: '/customers', status: 404, code: 'NOT_FOUND', correlationId: 'c-1' },
        'upstream error',
      ],
    ]);
  });

  it('logs the network-error path without the query string', async () => {
    const { client, logger } = setup([new TypeError('fetch failed')]);
    await client.get('/customers', { query: { customerNo: 'SECRET-Q' } }).catch(() => {});
    expect(logger.warn.mock.calls).toEqual([
      [{ method: 'GET', path: '/customers', status: 0, code: 'NETWORK_ERROR' }, 'upstream error'],
    ]);
  });

  it('returns the envelope result for a request with query options', async () => {
    const page = { data: [], total: 0, limit: 25, offset: 0 };
    const { client } = setup([ok(page)]);
    await expect(client.get('/customers', { query: { limit: 25 } })).resolves.toEqual(page);
  });
});

describe('createInioClient request timeout', () => {
  /** A fetch that never answers until its signal aborts, then rejects with the signal's reason. */
  function hangingFetch() {
    return vi.fn<typeof globalThis.fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error('no signal passed'));
            return;
          }
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
  }

  function timeoutError(): DOMException {
    return new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  }

  function build(fetch: typeof globalThis.fetch, timeoutMs?: number) {
    const tokens = {
      getToken: vi.fn<() => Promise<string>>(() => Promise.resolve(TOKEN)),
      invalidate: vi.fn<() => void>(),
    };
    const logger = {
      debug: vi.fn<(obj: object, msg?: string) => void>(),
      warn: vi.fn<(obj: object, msg?: string) => void>(),
    };
    const client = createInioClient({
      apiUrl: API_URL,
      tokens,
      fetch,
      logger,
      sleep: () => Promise.resolve(),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    return { client, logger };
  }

  it('aborts a request that does not answer and throws TIMEOUT', async () => {
    const { client } = build(hangingFetch(), 20);
    const err = await apiErrorOf(client.get('/invoices/abc'));
    expect(err.status).toBe(0);
    expect(err.code).toBe('TIMEOUT');
    expect(err.message).toBe('The Inio API did not respond within 1 s.');
  });

  it.each([
    [1000, 1],
    [1500, 2],
    [20, 1],
    [60000, 60],
    [90000, 90],
  ])('reports a timeout of %i ms as %i s', async (timeoutMs, seconds) => {
    const { client } = build(() => Promise.reject(timeoutError()), timeoutMs);
    const err = await apiErrorOf(client.get('/x'));
    expect(err.message).toBe(`The Inio API did not respond within ${seconds} s.`);
  });

  it('defaults the timeout to 30 s', async () => {
    const { client } = build(() => Promise.reject(timeoutError()));
    const err = await apiErrorOf(client.get('/x'));
    expect(err.message).toBe('The Inio API did not respond within 30 s.');
  });

  it('passes an AbortSignal that is not yet aborted to fetch', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(ok({})));
    const { client } = build(fetch, 5000);
    await client.get('/x');
    const signal = fetch.mock.calls[0]?.[1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  it('logs a warn line with method, path without query, status 0 and code TIMEOUT', async () => {
    const { client, logger } = build(hangingFetch(), 20);
    await apiErrorOf(client.get('/invoices', { query: { customerNo: 'SECRET-Q' } }));
    expect(logger.warn.mock.calls).toContainEqual([
      expect.objectContaining({ method: 'GET', path: '/invoices', status: 0, code: 'TIMEOUT' }),
      'upstream error',
    ]);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('SECRET-Q');
  });

  it('still maps other network errors to NETWORK_ERROR', async () => {
    const { client } = build(() => Promise.reject(new TypeError('fetch failed')), 5000);
    const err = await apiErrorOf(client.get('/x'));
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.message).toBe('Cannot reach the Inio API (INIO_URL).');
  });

  it('does not treat a plain abort error as a timeout', async () => {
    const { client } = build(() => Promise.reject(new DOMException('aborted', 'AbortError')), 5000);
    expect((await apiErrorOf(client.get('/x'))).code).toBe('NETWORK_ERROR');
  });

  it('gives the 401 retry its own fresh signal', async () => {
    const queue = [json(unauthorized, 401), ok({ id: 'abc' })];
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(queue.shift() ?? ok({})));
    const { client } = build(fetch, 5000);
    await client.get('/x');
    const [first, second] = fetch.mock.calls.map(([, init]) => init?.signal);
    expect(second).toBeInstanceOf(AbortSignal);
    expect(second).not.toBe(first);
    expect(second?.aborted).toBe(false);
  });

  it('gives the 429 retry its own fresh signal', async () => {
    const queue = [tooMany('0'), ok({ id: 'abc' })];
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(queue.shift() ?? ok({})));
    const { client } = build(fetch, 5000);
    await client.get('/x');
    const [first, second] = fetch.mock.calls.map(([, init]) => init?.signal);
    expect(second).toBeInstanceOf(AbortSignal);
    expect(second).not.toBe(first);
    expect(second?.aborted).toBe(false);
  });

  it('times out a retry attempt independently of the first attempt', async () => {
    let calls = 0;
    const hanging = hangingFetch();
    const fetch = vi.fn<typeof globalThis.fetch>((url, init) => {
      calls += 1;
      return calls === 1 ? Promise.resolve(json(unauthorized, 401)) : hanging(url, init);
    });
    const { client } = build(fetch, 20);
    const err = await apiErrorOf(client.get('/x'));
    expect(err.code).toBe('TIMEOUT');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  /** A response whose body never completes; it errors with the signal's reason on abort. */
  function stalledResponse(init: RequestInit | undefined, status: number): Response {
    const signal = init?.signal;
    const body = new ReadableStream({
      start(controller) {
        signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true });
      },
    });
    return new Response(body, { status, headers: { 'content-type': 'application/json' } });
  }

  it.each([
    ['a 200', 200],
    ['a 500', 500],
  ])('throws TIMEOUT when the body of %s response stalls', async (_label, status) => {
    const { client } = build(
      vi.fn<typeof globalThis.fetch>((_url, init) =>
        Promise.resolve(stalledResponse(init, status)),
      ),
      20,
    );
    const err = await apiErrorOf(client.get('/x'));
    expect(err.status).toBe(0);
    expect(err.code).toBe('TIMEOUT');
    expect(err.message).toBe('The Inio API did not respond within 1 s.');
  });
});
