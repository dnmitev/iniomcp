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
  const client = createInioClient({ apiUrl: API_URL, tokens, fetch, logger });
  return { client, fetch, tokens, logger };
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
});

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
