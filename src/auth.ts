import { z } from 'zod';
import { noopLogger, type Logger } from './logger.ts';

export type TokenProvider = { getToken(): Promise<string>; invalidate(): void };

type Options = {
  authUrl: string;
  clientId: string;
  clientSecret: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  logger?: Pick<Logger, 'debug'>;
  timeoutMs?: number;
};

const EXPIRY_MARGIN_MS = 60_000;
const TokenResponse = z.object({ access_token: z.string(), expires_in: z.number() });
const OAuthError = z.object({ error: z.string() });

/** OAuth2 client_credentials token provider with caching and in-flight request sharing. */
export function createTokenProvider({
  authUrl,
  clientId,
  clientSecret,
  fetch = globalThis.fetch,
  now = Date.now,
  logger = noopLogger,
  timeoutMs = 30_000,
}: Options): TokenProvider {
  let cached: { token: string; expiresAt: number } | undefined;
  let inFlight: Promise<string> | undefined;

  function timedOut(): Error {
    const seconds = Math.ceil(timeoutMs / 1000);
    return new Error(`The Inio auth server did not respond within ${seconds} s (INIO_AUTH_URL).`);
  }

  async function fetchToken(): Promise<string> {
    let res: Response;
    try {
      res = await fetch(authUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (isTimeout(err)) throw timedOut();
      // oxlint-disable-next-line preserve-caught-error -- the cause may carry host/network details; keep it off the error.
      throw new Error('Cannot reach the Inio auth server (INIO_AUTH_URL).');
    }
    // The timeout also covers a body that stalls; other read failures mean an unparseable body.
    const body: unknown = await res.json().catch((err: unknown) => {
      if (isTimeout(err)) throw timedOut();
      return undefined;
    });
    if (!res.ok) {
      const code = OAuthError.safeParse(body).data?.error;
      throw authError(code ? `${res.status}: ${code}` : `${res.status}`);
    }
    const parsed = TokenResponse.safeParse(body);
    if (!parsed.success) throw authError(`${res.status}: invalid token response`);
    const expiresAt = now() + parsed.data.expires_in * 1000 - EXPIRY_MARGIN_MS;
    cached = { token: parsed.data.access_token, expiresAt };
    logger.debug({ expiresAt }, 'token fetched');
    return cached.token;
  }

  return {
    getToken() {
      if (cached && now() < cached.expiresAt) {
        logger.debug({ expiresAt: cached.expiresAt }, 'token cache hit');
        return Promise.resolve(cached.token);
      }
      logger.debug({}, 'token cache miss');
      inFlight ??= fetchToken().finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
    invalidate() {
      cached = undefined;
    },
  };
}

/** True for the rejection AbortSignal.timeout causes, whether on headers or body. */
function isTimeout(err: unknown): boolean {
  return err instanceof Error && err.name === 'TimeoutError';
}

function authError(detail: string): Error {
  return new Error(
    `Authentication failed (HTTP ${detail}). Check INIO_CLIENT_ID and INIO_CLIENT_SECRET.`,
  );
}
