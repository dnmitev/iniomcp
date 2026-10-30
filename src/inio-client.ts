import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { type TokenProvider } from './auth.ts';
import { noopLogger, type Logger } from './logger.ts';

export type FieldError = { fieldName: string; message: string };

export class InioApiError extends Error {
  override name = 'InioApiError';
  readonly status: number;
  readonly code: string;
  readonly correlationId: string | undefined;
  readonly fieldErrors: FieldError[] | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    correlationId?: string,
    fieldErrors?: FieldError[],
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
    this.fieldErrors = fieldErrors;
  }
}

export type RequestOptions = {
  query?: Record<string, string | number | boolean | string[] | undefined>;
  headers?: Record<string, string>;
};

export type InioClient = {
  get(path: string, options?: RequestOptions): Promise<unknown>;
  post(path: string, body: unknown, options?: RequestOptions): Promise<unknown>;
  patch(path: string, body: unknown, options?: RequestOptions): Promise<unknown>;
};

type Method = 'GET' | 'POST' | 'PATCH';

/** One logical call; `method` and `path` (never the query or body) are what gets logged. */
type Request = {
  method: Method;
  path: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
};

type Options = {
  apiUrl: string;
  tokens: TokenProvider;
  fetch?: typeof globalThis.fetch;
  logger?: Pick<Logger, 'debug' | 'warn'>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
};

const SuccessEnvelope = z.object({ result: z.unknown() }).refine((b) => 'result' in b);
const ErrorEnvelope = z.object({
  code: z.string(),
  message: z.string(),
  correlationId: z.string().optional(),
  fieldErrors: z.unknown().optional(),
});
const FieldErrorSchema = z.object({ fieldName: z.string(), message: z.string() });

/** Well-formed `{ fieldName, message }` entries of an envelope's fieldErrors; others dropped. */
function fieldErrorsOf(value: unknown): FieldError[] | undefined {
  const list = z.array(z.unknown()).safeParse(value);
  if (!list.success) return undefined;
  return list.data.flatMap((e) => {
    const parsed = FieldErrorSchema.safeParse(e);
    return parsed.success ? [parsed.data] : [];
  });
}

// Callers cannot override these, in any letter case.
const RESERVED_HEADERS = ['authorization', 'accept', 'content-type', 'x-user-real-name'];

/** Encodes one caller-supplied URL path segment; rejects dot segments URL parsing would resolve. */
export function pathSegment(value: string): string {
  if (value === '.' || value === '..') throw new Error(`Invalid path segment: ${value}`);
  return encodeURIComponent(value);
}

/** True for the rejection AbortSignal.timeout causes, whether on headers or body. */
function isTimeout(err: unknown): boolean {
  return err instanceof Error && err.name === 'TimeoutError';
}

/**
 * Suffix for write failures whose outcome is unknown (timeout, network error, 5xx, unreadable 2xx):
 * the change may have landed, so say so instead of inviting a blind retry. Empty for GET.
 */
function uncertainOutcome({ method }: Request): string {
  return method === 'GET'
    ? ''
    : ' The change may or may not have been applied; check before retrying.';
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
  timeoutMs = 30_000,
}: Options): InioClient {
  /** Logs a failed upstream call at warn and returns the error to throw. */
  function fail({ method, path }: Request, err: InioApiError): InioApiError {
    const { status, code, correlationId } = err;
    logger.warn({ method, path, status, code, correlationId }, 'upstream error');
    return err;
  }

  /** Logs and returns the TIMEOUT error for a request whose signal fired. */
  function timedOut(req: Request): InioApiError {
    const seconds = Math.ceil(timeoutMs / 1000);
    return fail(
      req,
      new InioApiError(
        0,
        'TIMEOUT',
        `The Inio API did not respond within ${seconds} s.${uncertainOutcome(req)}`,
      ),
    );
  }

  /** Sends one attempt of `req` with `token`. */
  async function send(req: Request, token: string): Promise<Response> {
    const { method, path, url, headers, body } = req;
    const started = performance.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { ...headers, authorization: `Bearer ${token}` },
        body,
        // Fresh per attempt, so each retry gets the full timeout.
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (isTimeout(err)) throw timedOut(req);
      // The cause may carry host/network details; keep it out of messages and logs.
      throw fail(
        req,
        new InioApiError(
          0,
          'NETWORK_ERROR',
          `Cannot reach the Inio API (INIO_URL).${uncertainOutcome(req)}`,
        ),
      );
    }
    const durationMs = Math.round(performance.now() - started);
    logger.debug({ method, path, status: res.status, durationMs }, 'upstream request');
    return res;
  }

  async function request(
    method: Method,
    path: string,
    body: unknown,
    { query = {}, headers = {} }: RequestOptions = {},
  ): Promise<unknown> {
    const qs = new URLSearchParams(
      // Arrays become repeated keys; undefined and empty arrays add nothing.
      Object.entries(query).flatMap(([k, v]) =>
        v === undefined ? [] : Array.isArray(v) ? v.map((e) => [k, e]) : [[k, String(v)]],
      ),
    ).toString();
    const callerHeaders = Object.fromEntries(
      Object.entries(headers).filter(([k]) => !RESERVED_HEADERS.includes(k.toLowerCase())),
    );
    const isWrite = method !== 'GET';
    const req: Request = {
      method,
      path,
      url: apiUrl + path + (qs ? `?${qs}` : ''),
      headers: {
        ...callerHeaders,
        accept: 'application/json',
        // Writes are attributed to this server in the Inio audit trail.
        ...(isWrite ? { 'content-type': 'application/json', 'x-user-real-name': 'inio-mcp' } : {}),
      },
      body: isWrite ? JSON.stringify(body) : undefined,
    };
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
        return send(req, token);
      }
      if (res.status === 429 && !rateRetried) {
        rateRetried = true;
        await res.body?.cancel();
        const seconds = retryAfterSeconds(res.headers.get('retry-after'), now());
        // 1 s when Retry-After is unusable; never more than 5 s inside one tool call.
        const waitMs = seconds === undefined ? 1000 : Math.min(5000, Math.round(seconds * 1000));
        logger.warn({ method, path, status: 429, waitMs }, 'rate limited');
        await sleep(waitMs);
        // Same token: a 429 says nothing about the token.
        return send(req, token);
      }
      return res;
    };
    // Two passes cover a 401 and a 429 in either order.
    const res = await retry(await retry(await send(req, token)));
    if (res.status === 429) {
      await res.body?.cancel();
      const retryAfter = retryAfterSeconds(res.headers.get('retry-after'), now());
      const seconds = Math.max(1, Math.ceil(retryAfter ?? 1));
      throw fail(
        req,
        new InioApiError(
          429,
          'RATE_LIMITED',
          `The Inio API rate limit was reached. Try again in ${seconds} s.`,
        ),
      );
    }
    // The timeout also covers a body that stalls; other read failures mean an unparseable body.
    const resBody: unknown = await res.json().catch((err: unknown) => {
      if (isTimeout(err)) throw timedOut(req);
      return undefined;
    });
    if (res.ok) {
      const ok = SuccessEnvelope.safeParse(resBody);
      if (ok.success) return ok.data.result;
    } else {
      const err = ErrorEnvelope.safeParse(resBody);
      if (err.success) {
        const { code, message, correlationId, fieldErrors } = err.data;
        const hint = res.status >= 500 ? uncertainOutcome(req) : '';
        throw fail(
          req,
          new InioApiError(
            res.status,
            code,
            hint ? message.replace(/\.?$/, '.') + hint : message,
            correlationId,
            fieldErrorsOf(fieldErrors),
          ),
        );
      }
    }
    // A 2xx suggests the write landed, but without a readable result we cannot confirm it.
    const unexpected = new InioApiError(
      res.status,
      'UPSTREAM_ERROR',
      `Unexpected response from the Inio API (HTTP ${res.status}).${res.ok || res.status >= 500 ? uncertainOutcome(req) : ''}`,
    );
    throw res.ok ? unexpected : fail(req, unexpected);
  }

  return {
    get: (path, options) => request('GET', path, undefined, options),
    post: (path, body, options) => request('POST', path, body, options),
    patch: (path, body, options) => request('PATCH', path, body, options),
  };
}
