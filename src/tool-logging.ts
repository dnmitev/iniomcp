import type { Logger } from './logger.ts';

type ToolResult = { content: Array<{ type: string; text?: string }>; isError?: boolean };

/** Wraps a tool handler to log one info line per call with duration, outcome and response size. */
export function withToolLogging<A, E, R extends ToolResult>(
  logger: Pick<Logger, 'info'>,
  tool: string,
  handler: (args: A, extra: E) => Promise<R>,
): (args: A, extra: E) => Promise<R> {
  return async (args, extra) => {
    const started = performance.now();
    const log = (outcome: 'ok' | 'error', responseBytes: number) => {
      const durationMs = Math.round(performance.now() - started);
      const approxTokens = Math.ceil(responseBytes / 4);
      logger.info({ tool, durationMs, outcome, responseBytes, approxTokens }, 'tool call');
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
