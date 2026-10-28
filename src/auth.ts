import { z } from 'zod';

type LogFn = (obj: object, msg?: string) => void;

/** Minimal pino-compatible logger; modules take only the methods they use. */
export type Logger = { debug: LogFn; info: LogFn; warn: LogFn };

export const noopLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {} };

export type TokenProvider = { getToken(): Promise<string>; invalidate(): void };

type Options = {
  authUrl: string;
  clientId: string;
  clientSecret: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  logger?: Pick<Logger, 'debug'>;
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
}: Options): TokenProvider {
  let cached: { token: string; expiresAt: number } | undefined;
  let inFlight: Promise<string> | undefined;

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
      });
    } catch {
      throw new Error('Cannot reach the Inio auth server (INIO_AUTH_URL).');
    }
    const body: unknown = await res.json().catch(() => undefined);
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

function authError(detail: string): Error {
  return new Error(
    `Authentication failed (HTTP ${detail}). Check INIO_CLIENT_ID and INIO_CLIENT_SECRET.`,
  );
}
