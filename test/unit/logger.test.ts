import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLogger } from '../../src/logger.ts';

const Line = z.record(z.string(), z.unknown());

function sink() {
  const chunks: string[] = [];
  return {
    stream: { write: (s: string) => void chunks.push(s) },
    raw: () => chunks.join(''),
    lines: (): Array<Record<string, unknown>> =>
      chunks
        .join('')
        .split('\n')
        .filter((l) => l !== '')
        .map((l) => Line.parse(JSON.parse(l))),
  };
}

describe('createLogger output', () => {
  it('writes one JSON line per log call, newline-terminated', () => {
    const out = sink();
    const logger = createLogger('info', out.stream);
    logger.info({ a: 1 }, 'first');
    logger.info({ b: 2 }, 'second');
    expect(out.raw().endsWith('\n')).toBe(true);
    expect(out.raw().split('\n').filter(Boolean)).toHaveLength(2);
    expect(out.lines()[0]).toMatchObject({ a: 1, msg: 'first', level: 30 });
    expect(out.lines()[1]).toMatchObject({ b: 2, msg: 'second', level: 30 });
  });

  it('includes a numeric time field', () => {
    const out = sink();
    createLogger('info', out.stream).info('hello');
    expect(typeof out.lines()[0]?.time).toBe('number');
  });

  it('writes warn at pino level 40', () => {
    const out = sink();
    createLogger('info', out.stream).warn({ x: 1 }, 'careful');
    expect(out.lines()[0]).toMatchObject({ level: 40, msg: 'careful', x: 1 });
  });
});

describe('createLogger level filtering', () => {
  it('drops debug lines at level info', () => {
    const out = sink();
    const logger = createLogger('info', out.stream);
    logger.debug('hidden');
    logger.info('shown');
    expect(out.lines().map((l) => l.msg)).toEqual(['shown']);
  });

  it('keeps debug lines at level debug', () => {
    const out = sink();
    const logger = createLogger('debug', out.stream);
    logger.trace('hidden');
    logger.debug('shown');
    expect(out.lines().map((l) => l.msg)).toEqual(['shown']);
  });

  it('keeps trace lines at level trace', () => {
    const out = sink();
    createLogger('trace', out.stream).trace('shown');
    expect(out.lines().map((l) => l.msg)).toEqual(['shown']);
  });

  it('drops info and warn at level error', () => {
    const out = sink();
    const logger = createLogger('error', out.stream);
    logger.info('hidden');
    logger.warn('hidden');
    logger.error('shown');
    expect(out.lines().map((l) => l.msg)).toEqual(['shown']);
  });

  it('writes nothing at level silent', () => {
    const out = sink();
    const logger = createLogger('silent', out.stream);
    logger.fatal('hidden');
    logger.error('hidden');
    logger.info('hidden');
    expect(out.raw()).toBe('');
  });

  it('reports the configured level', () => {
    expect(createLogger('warn', sink().stream).level).toBe('warn');
  });
});

const SENSITIVE_KEYS = [
  'authorization',
  'Authorization',
  'client_secret',
  'clientSecret',
  'access_token',
  'accessToken',
  'token',
  'secret',
  'password',
] as const;

const LEAK = 'LEAK-9f8e7d-do-not-log';

describe('createLogger redaction', () => {
  it.each(SENSITIVE_KEYS)('redacts top-level %s', (key) => {
    const out = sink();
    createLogger('info', out.stream).info({ [key]: LEAK, keep: 'ok' }, 'm');
    expect(out.lines()[0]).toMatchObject({ [key]: '[redacted]', keep: 'ok' });
    expect(out.raw()).not.toContain(LEAK);
  });

  it.each(SENSITIVE_KEYS)('redacts %s nested one level deep', (key) => {
    const out = sink();
    createLogger('info', out.stream).info({ outer: { [key]: LEAK, keep: 'ok' } }, 'm');
    expect(out.lines()[0]?.outer).toEqual({ [key]: '[redacted]', keep: 'ok' });
    expect(out.raw()).not.toContain(LEAK);
  });

  it.each(SENSITIVE_KEYS)('redacts %s nested two levels deep', (key) => {
    const out = sink();
    createLogger('info', out.stream).info({ a: { b: { [key]: LEAK, keep: 'ok' } } }, 'm');
    expect(out.lines()[0]?.a).toEqual({ b: { [key]: '[redacted]', keep: 'ok' } });
    expect(out.raw()).not.toContain(LEAK);
  });

  it('redacts headers.authorization and headers.Authorization', () => {
    const out = sink();
    createLogger('info', out.stream).info(
      {
        headers: { authorization: `Bearer ${LEAK}`, Authorization: `Bearer ${LEAK}`, accept: 'x' },
      },
      'm',
    );
    expect(out.lines()[0]?.headers).toEqual({
      authorization: '[redacted]',
      Authorization: '[redacted]',
      accept: 'x',
    });
    expect(out.raw()).not.toContain(LEAK);
  });

  it('keeps non-sensitive keys untouched', () => {
    const out = sink();
    createLogger('info', out.stream).info(
      { tool: 'get_invoice', tokens: 3, approxTokens: 5, status: 200 },
      'm',
    );
    expect(out.lines()[0]).toMatchObject({
      tool: 'get_invoice',
      tokens: 3,
      approxTokens: 5,
      status: 200,
    });
  });

  it('does not add redacted keys that were absent', () => {
    const out = sink();
    createLogger('info', out.stream).info({ keep: 'ok' }, 'm');
    for (const key of SENSITIVE_KEYS) expect(out.lines()[0]).not.toHaveProperty(key);
  });

  it('redacts in child logger bindings', () => {
    const out = sink();
    createLogger('info', out.stream).child({ secret: LEAK }).info('m');
    expect(out.lines()[0]).toMatchObject({ secret: '[redacted]' });
    expect(out.raw()).not.toContain(LEAK);
  });
});
