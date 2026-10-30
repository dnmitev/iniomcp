import { pino, type Logger as PinoLogger } from 'pino';
import type { LogLevel } from './config.ts';

type LogFn = (obj: object, msg?: string) => void;

/** Minimal pino-compatible logger; modules take only the methods they use. */
export type Logger = { debug: LogFn; info: LogFn; warn: LogFn };

export const noopLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {} };

const SECRET_KEYS = [
  'authorization',
  'Authorization',
  'client_secret',
  'clientSecret',
  'access_token',
  'accessToken',
  'token',
  'secret',
  'password',
];
const REDACT_PATHS = SECRET_KEYS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`]);

/** JSON-lines logger with secret redaction; destination is stderr in production. */
export function createLogger(level: LogLevel, destination: { write(s: string): void }): PinoLogger {
  return pino({ level, redact: { paths: REDACT_PATHS, censor: '[redacted]' } }, destination);
}
