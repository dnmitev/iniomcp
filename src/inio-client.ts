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

export type InioClient = { get(path: string): Promise<unknown> };

type Options = {
  apiUrl: string;
  tokens: TokenProvider;
  fetch?: typeof globalThis.fetch;
  logger?: Pick<Logger, 'debug' | 'warn'>;
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

/** Inio REST client: bearer auth, one retry on 401, unwraps the response envelope. */
export function createInioClient({
  apiUrl,
  tokens,
  fetch = globalThis.fetch,
  logger = noopLogger,
}: Options): InioClient {
  /** Logs a failed upstream call at warn and returns the error to throw. */
  function fail(path: string, err: InioApiError): InioApiError {
    const { status, code, correlationId } = err;
    logger.warn({ method: 'GET', path, status, code, correlationId }, 'upstream error');
    return err;
  }

  async function send(path: string): Promise<Response> {
    const token = await tokens.getToken();
    const started = performance.now();
    let res: Response;
    try {
      res = await fetch(apiUrl + path, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
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
    async get(path: string): Promise<unknown> {
      let res = await send(path);
      if (res.status === 401) {
        await res.body?.cancel();
        tokens.invalidate();
        res = await send(path);
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
