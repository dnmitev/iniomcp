import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { noopLogger, type Logger, type TokenProvider } from './auth.ts';

export class InioApiError extends Error {
  override name = 'InioApiError';
  readonly status: number;
  readonly code: string;
  readonly correlationId: string | undefined;

  constructor(status: number, code: string, message: string, correlationId?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
  }
}

export type GetOptions = {
  query?: Record<string, string | number | boolean | string[] | undefined>;
  headers?: Record<string, string>;
};

export type InioClient = { get(path: string, options?: GetOptions): Promise<unknown> };

type Options = {
  apiUrl: string;
  tokens: TokenProvider;
  fetch?: typeof globalThis.fetch;
  logger?: Pick<Logger, 'debug' | 'warn'>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const SuccessEnvelope = z.object({ result: z.unknown() }).refine((b) => 'result' in b);
const ErrorEnvelope = z.object({
  code: z.string(),
  message: z.string(),
  correlationId: z.string().optional(),
});

/** Encodes one caller-supplied URL path segment; rejects dot segments URL parsing would resolve. */
export function pathSegment(value: string): string {
  if (value === '.' || value === '..') throw new Error(`Invalid path segment: ${value}`);
  return encodeURIComponent(value);
}

/** Retry-After as seconds (delta or HTTP date); undefined when missing, invalid or negative. */
function retryAfterSeconds(header: string | null, now: number): number | undefined {
  if (header === null || header === '') return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds : undefined;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, (date - now) / 1000);
}

/** Inio REST client: bearer auth, one retry each on 401 and 429, unwraps the response envelope. */
export function createInioClient({
  apiUrl,
  tokens,
  fetch = globalThis.fetch,
  logger = noopLogger,
  sleep = delay,
  now = Date.now,
}: Options): InioClient {
  /** Logs a failed upstream call at warn and returns the error to throw. */
  function fail(path: string, err: InioApiError): InioApiError {
    const { status, code, correlationId } = err;
    logger.warn({ method: 'GET', path, status, code, correlationId }, 'upstream error');
    return err;
  }

  /** Sends one GET; `path` (never the query) is what gets logged. */
  async function send(
    path: string,
    url: string,
    extraHeaders: Record<string, string>,
    token: string,
  ): Promise<Response> {
    const started = performance.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { ...extraHeaders, authorization: `Bearer ${token}`, accept: 'application/json' },
      });
    } catch {
      // The cause may carry host/network details; keep it out of messages and logs.
      throw fail(
        path,
        new InioApiError(0, 'NETWORK_ERROR', 'Cannot reach the Inio API (INIO_URL).'),
      );
    }
    const durationMs = Math.round(performance.now() - started);
    logger.debug({ method: 'GET', path, status: res.status, durationMs }, 'upstream request');
    return res;
  }

  return {
    async get(path: string, { query = {}, headers = {} }: GetOptions = {}): Promise<unknown> {
      const qs = new URLSearchParams(
        // Arrays become repeated keys; undefined and empty arrays add nothing.
        Object.entries(query).flatMap(([k, v]) =>
          v === undefined ? [] : Array.isArray(v) ? v.map((e) => [k, e]) : [[k, String(v)]],
        ),
      ).toString();
      const url = apiUrl + path + (qs ? `?${qs}` : '');
      // Our auth and accept headers win over caller headers in any letter case.
      const extraHeaders = Object.fromEntries(
        Object.entries(headers).filter(
          ([k]) => !['authorization', 'accept'].includes(k.toLowerCase()),
        ),
      );
      let token = await tokens.getToken();
      let authRetried = false;
      let rateRetried = false;
      /** Retries a 401 (fresh token) or a 429 (after Retry-After) once each. */
      const retry = async (res: Response): Promise<Response> => {
        if (res.status === 401 && !authRetried) {
          authRetried = true;
          await res.body?.cancel();
          tokens.invalidate();
          token = await tokens.getToken();
          return send(path, url, extraHeaders, token);
        }
        if (res.status === 429 && !rateRetried) {
          rateRetried = true;
          await res.body?.cancel();
          const seconds = retryAfterSeconds(res.headers.get('retry-after'), now());
          // 1 s when Retry-After is unusable; never more than 5 s inside one tool call.
          const waitMs = seconds === undefined ? 1000 : Math.min(5000, Math.round(seconds * 1000));
          logger.warn({ method: 'GET', path, status: 429, waitMs }, 'rate limited');
          await sleep(waitMs);
          // Same token: a 429 says nothing about the token.
          return send(path, url, extraHeaders, token);
        }
        return res;
      };
      // Two passes cover a 401 and a 429 in either order.
      const res = await retry(await retry(await send(path, url, extraHeaders, token)));
      if (res.status === 429) {
        await res.body?.cancel();
        const retryAfter = retryAfterSeconds(res.headers.get('retry-after'), now());
        const seconds = Math.max(1, Math.ceil(retryAfter ?? 1));
        throw fail(
          path,
          new InioApiError(
            429,
            'RATE_LIMITED',
            `The Inio API rate limit was reached. Try again in ${seconds} s.`,
          ),
        );
      }
      const body: unknown = await res.json().catch(() => undefined);
      if (res.ok) {
        const ok = SuccessEnvelope.safeParse(body);
        if (ok.success) return ok.data.result;
      } else {
        const err = ErrorEnvelope.safeParse(body);
        if (err.success) {
          const { code, message, correlationId } = err.data;
          throw fail(path, new InioApiError(res.status, code, message, correlationId));
        }
      }
      const unexpected = new InioApiError(
        res.status,
        'UPSTREAM_ERROR',
        `Unexpected response from the Inio API (HTTP ${res.status}).`,
      );
      throw res.ok ? unexpected : fail(path, unexpected);
    },
  };
}
