import type { Logger } from './logger.ts';

type ToolResult = { content: Array<{ type: string; text?: string }>; isError?: boolean };

const TARGET_KEYS = [
  'id',
  'number',
  'customerId',
  'customerNo',
  'pauseId',
  'invoiceNo',
  'creditInvoiceNo',
] as const;

export type ToolLogOptions = {
  write?: boolean;
  client?: () => { name: string; version: string } | undefined;
};

/** Wraps a tool handler to log one info line per call with duration, outcome and response size.
 * Writes also log the identifier args as `target`; no other arg is ever logged. */
export function withToolLogging<A extends object, E, R extends ToolResult>(
  logger: Pick<Logger, 'info'>,
  tool: string,
  handler: (args: A, extra: E) => Promise<R>,
  { write, client }: ToolLogOptions = {},
): (args: A, extra: E) => Promise<R> {
  return async (args, extra) => {
    const started = performance.now();
    const user = userOf(extra);
    const log = (outcome: 'ok' | 'error', responseBytes: number) => {
      const durationMs = Math.round(performance.now() - started);
      const approxTokens = Math.ceil(responseBytes / 4);
      const clientInfo = client?.();
      logger.info(
        {
          tool,
          durationMs,
          outcome,
          responseBytes,
          approxTokens,
          ...(clientInfo && { client: { name: clientInfo.name, version: clientInfo.version } }),
          ...(user && { user }),
          ...(write && { write, ...targetOf(args) }),
        },
        'tool call',
      );
    };
    let result: R;
    try {
      result = await handler(args, extra);
    } catch (err) {
      log('error', 0);
      throw err;
    }
    const bytes = result.content.reduce(
      (sum, c) => sum + (c.type === 'text' ? Buffer.byteLength(c.text ?? '') : 0),
      0,
    );
    log(result.isError ? 'error' : 'ok', bytes);
    return result;
  };
}

function targetOf(args: object): { target?: Record<string, unknown> } {
  const record = new Map(Object.entries(args));
  const target = Object.fromEntries(
    TARGET_KEYS.filter((k) => record.has(k)).map((k) => [k, record.get(k)]),
  );
  return Object.keys(target).length > 0 ? { target } : {};
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Signed-in user (sub and name only) from the verified access token, if the request had one. */
function userOf(extra: unknown): { sub: string; name?: string } | undefined {
  const http = isRecord(extra) ? extra.http : undefined;
  const authInfo = isRecord(http) ? http.authInfo : undefined;
  const claims = isRecord(authInfo) ? authInfo.extra : undefined;
  if (!isRecord(claims) || typeof claims.sub !== 'string') return undefined;
  const name = claims.preferred_username;
  return { sub: claims.sub, ...(typeof name === 'string' && { name }) };
}
