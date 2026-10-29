import { describe, expect, it, vi } from 'vitest';
import { createTokenProvider } from '../../src/auth.ts';

const AUTH_URL = 'https://kc.example/realms/api/protocol/openid-connect/token';
const CLIENT_ID = 'mcp-client';
const SECRET = 's3cr3t-Zq9xW7-do-not-leak';
const TOKEN = 'tok-AAA-111';
const AUTH_INVALID =
  'Authentication failed (HTTP 200: invalid token response). Check INIO_CLIENT_ID and INIO_CLIENT_SECRET.';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function tokenResponse(token = TOKEN, expiresIn = 300): Response {
  return json({ access_token: token, token_type: 'Bearer', expires_in: expiresIn });
}

function setup(responses: Array<Response | Error> = [tokenResponse()]) {
  let clock = 1_000_000;
  const queue = [...responses];
  const fetch = vi.fn<typeof globalThis.fetch>(() => {
    const next = queue.shift() ?? tokenResponse('tok-extra');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  const logger = { debug: vi.fn<(obj: object, msg?: string) => void>() };
  const provider = createTokenProvider({
    authUrl: AUTH_URL,
    clientId: CLIENT_ID,
    clientSecret: SECRET,
    fetch,
    now: () => clock,
    logger,
  });
  return {
    provider,
    fetch,
    logger,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

async function errorOf(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    if (e instanceof Error) return e;
    throw new Error('expected an Error instance', { cause: e });
  }
  throw new Error('expected promise to reject');
}

describe('createTokenProvider', () => {
  describe('token request', () => {
    it('returns the access_token from the auth server', async () => {
      const { provider } = setup();
      await expect(provider.getToken()).resolves.toBe(TOKEN);
    });

    it('POSTs to the auth URL', async () => {
      const { provider, fetch } = setup();
      await provider.getToken();
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0] ?? [];
      expect(url).toBe(AUTH_URL);
      expect(init?.method).toBe('POST');
    });

    it('sends content-type application/x-www-form-urlencoded', async () => {
      const { provider, fetch } = setup();
      await provider.getToken();
      const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
      expect(headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    });

    it('sends grant_type, client_id and client_secret as form params', async () => {
      const { provider, fetch } = setup();
      await provider.getToken();
      const raw = fetch.mock.calls[0]?.[1]?.body;
      const body = new URLSearchParams(
        raw instanceof URLSearchParams ? raw : typeof raw === 'string' ? raw : '',
      );
      expect(Object.fromEntries(body)).toEqual({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: SECRET,
      });
    });
  });

  describe('caching', () => {
    it('reuses the cached token on a repeated call', async () => {
      const { provider, fetch } = setup();
      await provider.getToken();
      await expect(provider.getToken()).resolves.toBe(TOKEN);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('reuses the token just before expires_in - 60 s', async () => {
      const { provider, fetch, advance } = setup([tokenResponse(TOKEN, 300)]);
      await provider.getToken();
      advance(240_000 - 1);
      await expect(provider.getToken()).resolves.toBe(TOKEN);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('fetches a new token once expires_in - 60 s has elapsed', async () => {
      const { provider, fetch, advance } = setup([
        tokenResponse(TOKEN, 300),
        tokenResponse('tok-BBB-222', 300),
      ]);
      await provider.getToken();
      advance(240_000);
      await expect(provider.getToken()).resolves.toBe('tok-BBB-222');
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('shares one request between concurrent calls', async () => {
      const { provider, fetch } = setup();
      const results = await Promise.all([
        provider.getToken(),
        provider.getToken(),
        provider.getToken(),
      ]);
      expect(results).toEqual([TOKEN, TOKEN, TOKEN]);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('fetches a new token after invalidate()', async () => {
      const { provider, fetch } = setup([tokenResponse(TOKEN), tokenResponse('tok-BBB-222')]);
      await provider.getToken();
      provider.invalidate();
      await expect(provider.getToken()).resolves.toBe('tok-BBB-222');
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('does not cache a failed fetch; the next call retries', async () => {
      const { provider, fetch } = setup([new TypeError('fetch failed'), tokenResponse()]);
      await expect(provider.getToken()).rejects.toThrow(
        'Cannot reach the Inio auth server (INIO_AUTH_URL).',
      );
      await expect(provider.getToken()).resolves.toBe(TOKEN);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('does not cache a non-2xx response; the next call retries', async () => {
      const { provider, fetch } = setup([json({ error: 'invalid_client' }, 401), tokenResponse()]);
      await expect(provider.getToken()).rejects.toThrow('Authentication failed (HTTP 401');
      await expect(provider.getToken()).resolves.toBe(TOKEN);
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('errors', () => {
    const leakyBody = {
      error: 'invalid_client',
      error_description: `Invalid client secret ${SECRET} RAW-BODY-MARKER`,
    };

    it('throws with status and OAuth error code on non-2xx', async () => {
      const { provider } = setup([json(leakyBody, 401)]);
      const err = await errorOf(provider.getToken());
      expect(err.message).toBe(
        'Authentication failed (HTTP 401: invalid_client). Check INIO_CLIENT_ID and INIO_CLIENT_SECRET.',
      );
    });

    it('throws with status only when the body has no error field', async () => {
      const { provider } = setup([new Response('<html>oops</html>', { status: 500 })]);
      const err = await errorOf(provider.getToken());
      expect(err.message).toBe(
        'Authentication failed (HTTP 500). Check INIO_CLIENT_ID and INIO_CLIENT_SECRET.',
      );
    });

    it('never puts the secret, raw body or error_description in the message', async () => {
      const { provider } = setup([json(leakyBody, 401)]);
      const err = await errorOf(provider.getToken());
      expect(err.message).not.toContain(SECRET);
      expect(err.message).not.toContain('RAW-BODY-MARKER');
      expect(err.message).not.toContain('Invalid client secret');
    });

    it('throws a reachability error when fetch rejects', async () => {
      const { provider } = setup([new TypeError(`connect ECONNREFUSED ${SECRET}`)]);
      const err = await errorOf(provider.getToken());
      expect(err.message).toBe('Cannot reach the Inio auth server (INIO_AUTH_URL).');
    });

    it('throws an authentication error on 2xx without access_token', async () => {
      const { provider } = setup([json({ token_type: 'Bearer', expires_in: 300 })]);
      const err = await errorOf(provider.getToken());
      expect(err.message).toBe(AUTH_INVALID);
    });

    it('throws an authentication error on 2xx with a non-string access_token', async () => {
      const { provider } = setup([json({ access_token: 42, expires_in: 300 })]);
      const err = await errorOf(provider.getToken());
      expect(err.message).toBe(AUTH_INVALID);
    });

    it('throws an authentication error on 2xx with a non-JSON body', async () => {
      const { provider } = setup([new Response('not json', { status: 200 })]);
      const err = await errorOf(provider.getToken());
      expect(err.message).toMatch(/^Authentication failed/);
    });
  });

  describe('debug logging', () => {
    // clock 1_000_000 + expires_in 300 s - 60 s margin
    const EXPIRES_AT = 1_240_000;

    it('logs a cache miss then token fetched with expiresAt on the first call', async () => {
      const { provider, logger } = setup();
      await provider.getToken();
      expect(logger.debug.mock.calls).toEqual([
        [{}, 'token cache miss'],
        [{ expiresAt: EXPIRES_AT }, 'token fetched'],
      ]);
    });

    it('logs a cache hit with expiresAt on a cached call', async () => {
      const { provider, logger } = setup();
      await provider.getToken();
      logger.debug.mockClear();
      await provider.getToken();
      expect(logger.debug.mock.calls).toEqual([[{ expiresAt: EXPIRES_AT }, 'token cache hit']]);
    });

    it('never logs the token or the client secret', async () => {
      const { provider, logger } = setup();
      await provider.getToken();
      await provider.getToken();
      const logged = JSON.stringify(logger.debug.mock.calls);
      expect(logged).not.toContain(TOKEN);
      expect(logged).not.toContain(SECRET);
    });
  });
});

describe('createTokenProvider request timeout', () => {
  function build(fetch: typeof globalThis.fetch, timeoutMs?: number) {
    return createTokenProvider({
      authUrl: AUTH_URL,
      clientId: CLIENT_ID,
      clientSecret: SECRET,
      fetch,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
  }

  function timeoutError(): DOMException {
    return new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  }

  it('aborts a token request that does not answer and rejects with the timeout message', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
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
    const err = await errorOf(build(fetch, 20).getToken());
    expect(err.message).toBe('The Inio auth server did not respond within 1 s (INIO_AUTH_URL).');
  });

  it.each([
    [1000, 1],
    [1500, 2],
    [60000, 60],
    [90000, 90],
  ])('reports a timeout of %i ms as %i s', async (timeoutMs, seconds) => {
    const err = await errorOf(build(() => Promise.reject(timeoutError()), timeoutMs).getToken());
    expect(err.message).toBe(
      `The Inio auth server did not respond within ${seconds} s (INIO_AUTH_URL).`,
    );
  });

  it('defaults the timeout to 30 s', async () => {
    const err = await errorOf(build(() => Promise.reject(timeoutError())).getToken());
    expect(err.message).toBe('The Inio auth server did not respond within 30 s (INIO_AUTH_URL).');
  });

  it('passes an AbortSignal that is not yet aborted to the token request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(tokenResponse()));
    await build(fetch, 5000).getToken();
    const signal = fetch.mock.calls[0]?.[1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  it('never puts the client secret in the timeout message', async () => {
    const err = await errorOf(build(() => Promise.reject(timeoutError()), 1000).getToken());
    expect(err.message).not.toContain(SECRET);
  });

  it('keeps the unreachable message for other network failures', async () => {
    const err = await errorOf(
      build(() => Promise.reject(new TypeError('fetch failed'))).getToken(),
    );
    expect(err.message).toBe('Cannot reach the Inio auth server (INIO_AUTH_URL).');
  });

  it('lets a later call retry after a timeout', async () => {
    const queue: Array<Response | DOMException> = [timeoutError(), tokenResponse()];
    const fetch = vi.fn<typeof globalThis.fetch>(() => {
      const next = queue.shift();
      return next instanceof Response ? Promise.resolve(next) : Promise.reject(next);
    });
    const provider = build(fetch, 5000);
    await errorOf(provider.getToken());
    await expect(provider.getToken()).resolves.toBe(TOKEN);
  });

  it('reports a stalled token response body as the auth timeout', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((_url, init) => {
      const signal = init?.signal;
      const body = new ReadableStream({
        start(controller) {
          signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true });
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    });
    const err = await errorOf(build(fetch, 20).getToken());
    expect(err.message).toBe('The Inio auth server did not respond within 1 s (INIO_AUTH_URL).');
  });
});
