import { pino, type Logger } from 'pino';
import type { LogLevel } from './config.ts';

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
export function createLogger(level: LogLevel, destination: { write(s: string): void }): Logger {
  return pino({ level, redact: { paths: REDACT_PATHS, censor: '[redacted]' } }, destination);
}
