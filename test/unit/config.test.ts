import { describe, expect, it } from 'vitest';
import {
  isLoopbackHost,
  loadConfig,
  startupFields,
  WRITE_TOOL_NAMES,
  type Config,
} from '../../src/config.ts';

const SECRET = 's3cr3t-Zq9xW7-do-not-leak';

const valid = {
  INIO_CLIENT_ID: 'mcp-client',
  INIO_CLIENT_SECRET: SECRET,
  INIO_AUTH_URL: 'https://keycloak.example/realms/api',
  INIO_URL: 'https://api.example/v1',
} as const;

function env(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return { ...valid, ...overrides };
}

const TOKEN = 'tok-0123456789abcdef0123456789abcdef-http';

function httpEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return env({ MCP_TRANSPORT: 'http', MCP_AUTH_TOKEN: TOKEN, ...overrides });
}

function errorOf(input: Record<string, string | undefined>): Error {
  let caught: unknown;
  try {
    loadConfig(input);
  } catch (e) {
    caught = e;
  }
  if (!(caught instanceof Error)) throw new Error('expected loadConfig to throw an Error');
  return caught;
}

describe('loadConfig', () => {
  describe('valid config', () => {
    it('returns the full typed config with defaults when required vars are valid', () => {
      const config: Config = loadConfig(env());
      expect(config).toEqual({
        clientId: 'mcp-client',
        clientSecret: SECRET,
        authUrl: 'https://keycloak.example/realms/api/protocol/openid-connect/token',
        apiUrl: 'https://api.example/v1',
        allowWrites: false,
        revealPii: false,
        transport: 'stdio',
        logLevel: 'info',
        requestTimeoutMs: 30000,
        writeTools: new Set(WRITE_TOOL_NAMES),
      });
    });

    it('ignores unrelated env vars', () => {
      const config = loadConfig(
        env({ PATH: '/usr/bin', HOME: '/home/x', INIO_UNKNOWN: 'whatever' }),
      );
      expect(config).toEqual(loadConfig(env()));
      const defined = Object.entries(config).filter(([, v]) => v !== undefined);
      expect(defined.map(([k]) => k).sort()).toEqual([
        'allowWrites',
        'apiUrl',
        'authUrl',
        'clientId',
        'clientSecret',
        'logLevel',
        'requestTimeoutMs',
        'revealPii',
        'transport',
        'writeTools',
      ]);
    });
  });

  describe('missing variables', () => {
    it.each(['INIO_CLIENT_ID', 'INIO_CLIENT_SECRET', 'INIO_AUTH_URL', 'INIO_URL'])(
      'names %s when it is missing',
      (name) => {
        expect(errorOf(env({ [name]: undefined })).message).toContain(name);
      },
    );

    it.each(['INIO_CLIENT_ID', 'INIO_CLIENT_SECRET', 'INIO_AUTH_URL', 'INIO_URL'])(
      'treats empty-string %s as missing',
      (name) => {
        expect(errorOf(env({ [name]: '' })).message).toContain(name);
      },
    );

    it.each(['INIO_AUTH_URL', 'INIO_URL'])(
      'reports missing %s only as required, not as an invalid URL',
      (name) => {
        const msg = errorOf(env({ [name]: undefined })).message;
        expect(msg).toBe(`Invalid Inio MCP configuration:\n- ${name} is required`);
        expect(msg).not.toContain('must be an https URL');
      },
    );

    it('lists every missing required var in the exact message format and order', () => {
      expect(errorOf({}).message).toBe(
        'Invalid Inio MCP configuration:\n' +
          '- INIO_CLIENT_ID is required\n' +
          '- INIO_CLIENT_SECRET is required\n' +
          '- INIO_AUTH_URL is required\n' +
          '- INIO_URL is required',
      );
    });

    it('names both client id and secret in one error when both are missing', () => {
      const msg = errorOf(
        env({ INIO_CLIENT_ID: undefined, INIO_CLIENT_SECRET: undefined }),
      ).message;
      expect(msg).toContain('INIO_CLIENT_ID');
      expect(msg).toContain('INIO_CLIENT_SECRET');
    });

    it('names every required var in one error when the env is empty', () => {
      const msg = errorOf({}).message;
      for (const name of ['INIO_CLIENT_ID', 'INIO_CLIENT_SECRET', 'INIO_AUTH_URL', 'INIO_URL']) {
        expect(msg).toContain(name);
      }
    });

    it('names missing and invalid vars together in one error', () => {
      const msg = errorOf(
        env({ INIO_CLIENT_ID: undefined, INIO_URL: 'ftp://api.example', INIO_ALLOW_WRITES: 'yes' }),
      ).message;
      expect(msg).toContain('INIO_CLIENT_ID');
      expect(msg).toContain('INIO_URL');
      expect(msg).toContain('INIO_ALLOW_WRITES');
    });

    it('does not name valid vars in the error', () => {
      const msg = errorOf(env({ INIO_CLIENT_ID: undefined })).message;
      expect(msg).not.toContain('INIO_URL');
      expect(msg).not.toContain('INIO_AUTH_URL');
      expect(msg).not.toContain('INIO_CLIENT_SECRET');
    });
  });

  describe.each(['INIO_URL', 'INIO_AUTH_URL'])('%s scheme and host', (name) => {
    it('rejects http on a non-local host', () => {
      expect(errorOf(env({ [name]: 'http://api.example/x' })).message).toContain(name);
    });

    it.each(['http://localhost:8080', 'http://127.0.0.1:8080', 'http://[::1]:8080'])(
      'accepts http on local host %s',
      (url) => {
        expect(() => loadConfig(env({ [name]: url }))).not.toThrow();
      },
    );

    it('rejects a localhost lookalike host over http', () => {
      expect(errorOf(env({ [name]: 'http://localhost.evil.example' })).message).toContain(name);
    });

    it('rejects a non-URL value', () => {
      expect(errorOf(env({ [name]: 'not a url' })).message).toContain(name);
    });

    it('rejects the ftp scheme', () => {
      expect(errorOf(env({ [name]: 'ftp://api.example/x' })).message).toContain(name);
    });

    it.each(['ws://localhost:8080', 'ftp://localhost/x'])(
      'rejects non-http scheme %s on a local host',
      (url) => {
        expect(errorOf(env({ [name]: url })).message).toBe(
          `Invalid Inio MCP configuration:\n- ${name} must be an https URL (http allowed only for localhost)`,
        );
      },
    );
  });

  describe('INIO_AUTH_URL normalization', () => {
    it('keeps a URL whose path already ends with /token', () => {
      const url = 'https://keycloak.example/realms/api/protocol/openid-connect/token';
      expect(loadConfig(env({ INIO_AUTH_URL: url })).authUrl).toBe(url);
    });

    it('keeps a custom token endpoint ending with /token', () => {
      const url = 'https://keycloak.example/oauth/token';
      expect(loadConfig(env({ INIO_AUTH_URL: url })).authUrl).toBe(url);
    });

    it('appends the openid-connect token path to a realm issuer', () => {
      expect(
        loadConfig(env({ INIO_AUTH_URL: 'https://keycloak.example/realms/api' })).authUrl,
      ).toBe('https://keycloak.example/realms/api/protocol/openid-connect/token');
    });

    it('handles a trailing slash on the realm issuer', () => {
      expect(
        loadConfig(env({ INIO_AUTH_URL: 'https://keycloak.example/realms/api/' })).authUrl,
      ).toBe('https://keycloak.example/realms/api/protocol/openid-connect/token');
    });

    it('collapses multiple trailing slashes on the realm issuer', () => {
      expect(loadConfig(env({ INIO_AUTH_URL: 'https://kc.example/realms/api///' })).authUrl).toBe(
        'https://kc.example/realms/api/protocol/openid-connect/token',
      );
    });

    it('keeps a token endpoint with a trailing slash, removing the slash', () => {
      expect(
        loadConfig(
          env({ INIO_AUTH_URL: 'https://kc.example/realms/api/protocol/openid-connect/token/' }),
        ).authUrl,
      ).toBe('https://kc.example/realms/api/protocol/openid-connect/token');
    });

    it('appends the token path to a local http issuer', () => {
      expect(loadConfig(env({ INIO_AUTH_URL: 'http://localhost:8080/realms/api' })).authUrl).toBe(
        'http://localhost:8080/realms/api/protocol/openid-connect/token',
      );
    });
  });

  describe('INIO_URL normalization', () => {
    it('trims a trailing slash', () => {
      expect(loadConfig(env({ INIO_URL: 'https://api.example/v1/' })).apiUrl).toBe(
        'https://api.example/v1',
      );
    });

    it('trims multiple trailing slashes', () => {
      expect(loadConfig(env({ INIO_URL: 'https://api.example/v1///' })).apiUrl).toBe(
        'https://api.example/v1',
      );
    });

    it('leaves a URL without trailing slash unchanged', () => {
      expect(loadConfig(env({ INIO_URL: 'https://api.example/v1' })).apiUrl).toBe(
        'https://api.example/v1',
      );
    });
  });

  describe.each([
    ['INIO_ALLOW_WRITES', 'allowWrites'],
    ['INIO_REVEAL_PII', 'revealPii'],
  ] as const)('%s', (name, key) => {
    it('defaults to false when unset', () => {
      expect(loadConfig(env({ [name]: undefined }))[key]).toBe(false);
    });

    it('is true for "true"', () => {
      expect(loadConfig(env({ [name]: 'true' }))[key]).toBe(true);
    });

    it('is false for "false"', () => {
      expect(loadConfig(env({ [name]: 'false' }))[key]).toBe(false);
    });

    it('treats an empty string as unset and defaults to false', () => {
      expect(loadConfig(env({ [name]: '' }))[key]).toBe(false);
    });

    it.each(['TRUE', 'True', '1', 'yes', 'on', ' true'])('rejects %j', (value) => {
      expect(errorOf(env({ [name]: value })).message).toContain(name);
    });
  });

  it.each(['INIO_ALLOW_WRITES', 'INIO_REVEAL_PII'])('lists the allowed values for %s', (name) => {
    expect(errorOf(env({ [name]: 'yes' })).message).toBe(
      `Invalid Inio MCP configuration:\n- ${name} must be one of: false, true`,
    );
  });

  describe('MCP_TRANSPORT', () => {
    it('lists stdio and http as allowed when rejected', () => {
      expect(errorOf(env({ MCP_TRANSPORT: 'sse' })).message).toMatch(
        /^- MCP_TRANSPORT must be one of: stdio, http$/m,
      );
    });

    it('defaults to stdio', () => {
      expect(loadConfig(env({ MCP_TRANSPORT: undefined })).transport).toBe('stdio');
    });

    it('treats an empty string as unset and defaults to stdio', () => {
      expect(loadConfig(env({ MCP_TRANSPORT: '' })).transport).toBe('stdio');
    });

    it('accepts stdio', () => {
      expect(loadConfig(env({ MCP_TRANSPORT: 'stdio' })).transport).toBe('stdio');
    });

    it('accepts http with a valid token', () => {
      expect(loadConfig(httpEnv()).transport).toBe('http');
    });

    it('omits the http key for stdio', () => {
      expect('http' in loadConfig(env())).toBe(false);
    });

    it.each(['sse', 'HTTP', 'websocket'])('rejects %j', (value) => {
      expect(errorOf(env({ MCP_TRANSPORT: value })).message).toContain('MCP_TRANSPORT');
    });
  });

  describe('INIO_REQUEST_TIMEOUT_MS', () => {
    const MESSAGE = 'INIO_REQUEST_TIMEOUT_MS must be an integer from 1000 to 600000';

    it('defaults to 30000 when unset', () => {
      expect(loadConfig(env({ INIO_REQUEST_TIMEOUT_MS: undefined })).requestTimeoutMs).toBe(30000);
    });

    it('treats an empty string as unset', () => {
      expect(loadConfig(env({ INIO_REQUEST_TIMEOUT_MS: '' })).requestTimeoutMs).toBe(30000);
    });

    it.each([
      ['1000', 1000],
      ['600000', 600000],
      ['90000', 90000],
    ])('accepts %s', (value, expected) => {
      expect(loadConfig(env({ INIO_REQUEST_TIMEOUT_MS: value })).requestTimeoutMs).toBe(expected);
    });

    it.each(['999', '600001', '1.5', 'abc', '-1', '0', '1e4', ' 5000', '5000ms'])(
      'rejects %j',
      (value) => {
        expect(errorOf(env({ INIO_REQUEST_TIMEOUT_MS: value })).message).toContain(MESSAGE);
      },
    );

    it('reports the problem in the standard config error format', () => {
      expect(errorOf(env({ INIO_REQUEST_TIMEOUT_MS: 'abc' })).message).toBe(
        `Invalid Inio MCP configuration:\n- ${MESSAGE}`,
      );
    });
  });

  describe('INIO_WRITE_TOOLS', () => {
    const w = (o: Record<string, string | undefined>) => env({ INIO_ALLOW_WRITES: 'true', ...o });
    const ALL = [
      'cancel_customer_pause',
      'create_credit_invoice',
      'create_customer',
      'create_customer_pause',
      'create_payment',
      'match_credit_invoice',
      'reset_invoice_stage',
      'update_customer',
      'update_customer_pause',
      'update_invoice_due_date',
      'update_invoice_stop_until_dates',
    ];

    it('exports the 11 write tool names', () => {
      expect([...WRITE_TOOL_NAMES].sort()).toEqual(ALL);
    });

    it.each([undefined, '', '   ', ' , ,'])('allows all write tools when it is %j', (v) => {
      expect(loadConfig(w({ INIO_WRITE_TOOLS: v })).writeTools).toEqual(new Set(ALL));
    });

    it('allows all write tools by default even when writes are off', () => {
      expect(loadConfig(env()).writeTools).toEqual(new Set(ALL));
    });

    it('parses a comma-separated list, trimming names and dropping empty entries', () => {
      const c = loadConfig(
        w({ INIO_WRITE_TOOLS: ' create_customer_pause ,, cancel_customer_pause,' }),
      );
      expect(c.writeTools).toEqual(new Set(['create_customer_pause', 'cancel_customer_pause']));
    });

    it('is case-sensitive', () => {
      const msg = errorOf(w({ INIO_WRITE_TOOLS: 'Create_Payment' })).message;
      expect(msg).toContain('INIO_WRITE_TOOLS');
      expect(msg).toContain('Create_Payment');
    });

    it('rejects an unknown name, listing it and the valid names', () => {
      const msg = errorOf(w({ INIO_WRITE_TOOLS: 'create_payment,nope' })).message;
      expect(msg).toContain('INIO_WRITE_TOOLS');
      expect(msg).toContain('nope');
      for (const n of ALL) expect(msg).toContain(n);
    });

    it('joins several unknown names and the valid names with ", "', () => {
      const msg = errorOf(w({ INIO_WRITE_TOOLS: 'nope1,nope2' })).message;
      expect(msg).toContain('nope1, nope2');
      expect(msg).toContain(WRITE_TOOL_NAMES.join(', '));
    });

    it('rejects a read tool name and lists it as unknown', () => {
      const msg = errorOf(w({ INIO_WRITE_TOOLS: 'get_invoice' })).message;
      expect(msg).toContain('INIO_WRITE_TOOLS');
      expect(msg).toContain('get_invoice');
    });

    it('needs INIO_ALLOW_WRITES=true', () => {
      for (const allow of [undefined, 'false']) {
        expect(
          errorOf(env({ INIO_ALLOW_WRITES: allow, INIO_WRITE_TOOLS: 'create_payment' })).message,
        ).toContain('INIO_WRITE_TOOLS needs INIO_ALLOW_WRITES=true');
      }
    });

    it('does not need INIO_ALLOW_WRITES when it is empty', () => {
      expect(() => loadConfig(env({ INIO_WRITE_TOOLS: '' }))).not.toThrow();
    });

    it('collects its problems with others in one error', () => {
      const msg = errorOf(env({ INIO_URL: undefined, INIO_WRITE_TOOLS: 'create_payment' })).message;
      expect(msg).toContain('INIO_URL is required');
      expect(msg).toContain('INIO_WRITE_TOOLS needs INIO_ALLOW_WRITES=true');
    });
  });

  describe('INIO_MAX_PAYMENT_AMOUNT', () => {
    it.each([undefined, ''])('is undefined when %j', (v) => {
      expect(loadConfig(env({ INIO_MAX_PAYMENT_AMOUNT: v })).maxPaymentAmount).toBeUndefined();
      expect('maxPaymentAmount' in loadConfig(env({ INIO_MAX_PAYMENT_AMOUNT: v }))).toBe(false);
    });

    it.each([
      ['500', 500],
      ['0.01', 0.01],
      ['1234.5', 1234.5],
      ['99.99', 99.99],
    ])('accepts %s', (v, n) => {
      expect(loadConfig(env({ INIO_MAX_PAYMENT_AMOUNT: v })).maxPaymentAmount).toBe(n);
    });

    it.each(['0', '-5', 'abc', '1.234', 'Infinity', 'NaN', '1e400', '500 EUR', '0.001'])(
      'rejects %j naming the variable',
      (v) => {
        expect(errorOf(env({ INIO_MAX_PAYMENT_AMOUNT: v })).message).toContain(
          'INIO_MAX_PAYMENT_AMOUNT',
        );
      },
    );

    it('does not echo the rejected value', () => {
      expect(errorOf(env({ INIO_MAX_PAYMENT_AMOUNT: SECRET })).message).not.toContain(SECRET);
    });
  });

  describe('INIO_LOG_LEVEL', () => {
    const LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

    it('defaults to info when unset', () => {
      expect(loadConfig(env({ INIO_LOG_LEVEL: undefined })).logLevel).toBe('info');
    });

    it('treats an empty string as unset and defaults to info', () => {
      expect(loadConfig(env({ INIO_LOG_LEVEL: '' })).logLevel).toBe('info');
    });

    it.each(LEVELS)('accepts %s', (level) => {
      expect(loadConfig(env({ INIO_LOG_LEVEL: level })).logLevel).toBe(level);
    });

    it.each(['INFO', 'verbose', 'warning', ' info', '30'])('rejects %j', (value) => {
      expect(errorOf(env({ INIO_LOG_LEVEL: value })).message).toContain('INIO_LOG_LEVEL');
    });

    it('lists the allowed values in the exact message when rejected', () => {
      expect(errorOf(env({ INIO_LOG_LEVEL: 'verbose' })).message).toBe(
        'Invalid Inio MCP configuration:\n' +
          '- INIO_LOG_LEVEL must be one of: fatal, error, warn, info, debug, trace, silent',
      );
    });

    it('does not echo the rejected value', () => {
      expect(errorOf(env({ INIO_LOG_LEVEL: SECRET })).message).not.toContain(SECRET);
    });
  });

  describe('secret never leaks into errors', () => {
    it('omits the secret when another var is invalid', () => {
      const msg = errorOf(env({ INIO_ALLOW_WRITES: 'maybe', INIO_CLIENT_ID: undefined })).message;
      expect(msg).not.toContain(SECRET);
    });

    it('omits the secret when the secret value is also used as an invalid INIO_URL', () => {
      const msg = errorOf(env({ INIO_URL: SECRET })).message;
      expect(msg).toContain('INIO_URL');
      expect(msg).not.toContain(SECRET);
    });

    it('omits the secret when it is used as an invalid INIO_AUTH_URL', () => {
      const msg = errorOf(env({ INIO_AUTH_URL: SECRET })).message;
      expect(msg).toContain('INIO_AUTH_URL');
      expect(msg).not.toContain(SECRET);
    });

    it('omits a URL-shaped secret when it is used as an http INIO_URL', () => {
      const urlSecret = 'http://leak-me.example/abc123';
      const msg = errorOf(env({ INIO_CLIENT_SECRET: urlSecret, INIO_URL: urlSecret })).message;
      expect(msg).toContain('INIO_URL');
      expect(msg).not.toContain(urlSecret);
      expect(msg).not.toContain('leak-me');
    });

    it('omits the secret when it is used as an invalid flag value', () => {
      const msg = errorOf(env({ INIO_REVEAL_PII: SECRET, MCP_TRANSPORT: SECRET })).message;
      expect(msg).toContain('INIO_REVEAL_PII');
      expect(msg).toContain('MCP_TRANSPORT');
      expect(msg).not.toContain(SECRET);
    });
  });

  describe('http transport', () => {
    const msgOf = (o: Record<string, string | undefined>) => errorOf(httpEnv(o)).message;

    it('returns defaults for port, host and origins', () => {
      expect(loadConfig(httpEnv()).http).toEqual({
        port: 3000,
        host: '127.0.0.1',
        authToken: TOKEN,
        allowedOrigins: [],
      });
    });

    it('uses explicit PORT and HOST', () => {
      expect(loadConfig(httpEnv({ PORT: '8080', HOST: '0.0.0.0' })).http).toMatchObject({
        port: 8080,
        host: '0.0.0.0',
      });
    });

    it.each([undefined, ''])('requires MCP_AUTH_TOKEN when it is %j', (v) => {
      expect(msgOf({ MCP_AUTH_TOKEN: v })).toContain(
        '- MCP_AUTH_TOKEN is required when MCP_TRANSPORT=http',
      );
    });

    it.each([
      ['32 spaces', ' '.repeat(32)],
      ['a trailing newline', TOKEN + '\n'],
      ['an inner space', TOKEN.slice(0, 16) + ' ' + TOKEN.slice(16)],
    ])('rejects a token with %s without leaking it', (_n, token) => {
      const msg = msgOf({ MCP_AUTH_TOKEN: token });
      expect(msg).toContain('- MCP_AUTH_TOKEN must not contain whitespace');
      expect(msg).not.toContain(TOKEN);
    });

    it.each([
      ['32 non-Latin-1 characters', 'Ā'.repeat(32)],
      ['one accented character among ASCII', 'c'.repeat(31) + 'é'],
      ['a control character', 'abc\x00' + 'd'.repeat(28)],
    ])('rejects a token with %s without leaking it', (_n, token) => {
      const msg = msgOf({ MCP_AUTH_TOKEN: token });
      expect(msg).toContain('- MCP_AUTH_TOKEN must contain only printable ASCII characters');
      expect(msg.split('\n').filter((l) => l.includes('MCP_AUTH_TOKEN'))).toHaveLength(1);
      expect(msg).not.toContain(token);
    });

    it('accepts a 64 character hex token', () => {
      const hex = 'a3f1c2d4e5b60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
      expect(loadConfig(httpEnv({ MCP_AUTH_TOKEN: hex })).http?.authToken).toBe(hex);
    });

    it('accepts a 32 character token', () => {
      expect(loadConfig(httpEnv({ MCP_AUTH_TOKEN: 'a'.repeat(32) })).http?.authToken).toBe(
        'a'.repeat(32),
      );
    });

    it('rejects a 31 character token without leaking it', () => {
      const short = 'b'.repeat(31);
      const msg = msgOf({ MCP_AUTH_TOKEN: short });
      expect(msg).toContain('- MCP_AUTH_TOKEN must be at least 32 characters');
      expect(msg).not.toContain(short);
    });

    it.each(['0', '65536', '3.5', '-1', 'abc', ' 80'])('rejects PORT %j', (v) => {
      expect(msgOf({ PORT: v })).toContain('- PORT must be an integer from 1 to 65535');
    });

    it.each([
      ['1', 1],
      ['65535', 65535],
    ])('accepts PORT %s', (v, n) => {
      expect(loadConfig(httpEnv({ PORT: v })).http?.port).toBe(n);
    });

    it('splits, trims and filters MCP_ALLOWED_ORIGINS', () => {
      const o = loadConfig(
        httpEnv({ MCP_ALLOWED_ORIGINS: 'https://a.example, http://localhost:5173,,' }),
      ).http?.allowedOrigins;
      expect(o).toEqual(['https://a.example', 'http://localhost:5173']);
    });

    it('treats an empty MCP_ALLOWED_ORIGINS as no origins', () => {
      expect(loadConfig(httpEnv({ MCP_ALLOWED_ORIGINS: '' })).http?.allowedOrigins).toEqual([]);
    });

    it.each([
      'https://a.example/',
      'https://a.example/path',
      'ftp://a.example',
      'a.example',
      'null',
    ])('rejects origin %j', (v) => {
      expect(msgOf({ MCP_ALLOWED_ORIGINS: `https://ok.example,${v}` })).toContain(
        '- MCP_ALLOWED_ORIGINS must be a comma-separated list of http(s) origins',
      );
    });

    it('collects http problems with other problems in one error', () => {
      const msg = msgOf({ MCP_AUTH_TOKEN: undefined, PORT: '0', INIO_URL: undefined });
      expect(msg).toContain('INIO_URL is required');
      expect(msg).toContain('MCP_AUTH_TOKEN is required when MCP_TRANSPORT=http');
      expect(msg).toContain('PORT must be an integer');
    });

    it('never leaks the token or client secret in errors', () => {
      const msg = msgOf({ PORT: '0', MCP_ALLOWED_ORIGINS: 'bad' });
      expect(msg).not.toContain(TOKEN);
      expect(msg).not.toContain(SECRET);
    });

    it('does not validate http settings for stdio', () => {
      const c = loadConfig(
        env({ PORT: 'abc', MCP_ALLOWED_ORIGINS: 'bad', MCP_AUTH_TOKEN: 'x', HOST: '' }),
      );
      expect(c.transport).toBe('stdio');
      expect('http' in c).toBe(false);
    });
  });
});

describe('isLoopbackHost', () => {
  it.each(['localhost', '127.0.0.1', '[::1]', '::1'])('is true for %s', (h) => {
    expect(isLoopbackHost(h)).toBe(true);
  });
  it.each(['0.0.0.0', 'example.com', ''])('is false for %j', (h) => {
    expect(isLoopbackHost(h)).toBe(false);
  });
});

describe('startupFields', () => {
  const base = loadConfig(env());

  it('lists no write tools and no ceiling when writes are off', () => {
    expect(startupFields(base)).toEqual({
      allowWrites: false,
      revealPii: false,
      logLevel: 'info',
      writeTools: [],
    });
  });

  it('lists every write tool in registration order when writes are on', () => {
    const fields = startupFields({ ...base, allowWrites: true });
    expect(fields).toMatchObject({ allowWrites: true, writeTools: [...WRITE_TOOL_NAMES] });
    expect(fields).not.toHaveProperty('maxPaymentAmount');
  });

  it('lists only the allowlisted write tools', () => {
    const writeTools = new Set(['create_payment', 'cancel_customer_pause']);
    const fields = startupFields({ ...base, allowWrites: true, writeTools });
    expect(fields.writeTools).toEqual(['cancel_customer_pause', 'create_payment']);
  });

  it('includes maxPaymentAmount when set', () => {
    expect(startupFields({ ...base, allowWrites: true, maxPaymentAmount: 500 })).toMatchObject({
      maxPaymentAmount: 500,
    });
  });

  it('lists no write tools when writes are off even if the allowlist is set', () => {
    const writeTools = new Set(['create_payment']);
    expect(startupFields({ ...base, writeTools }).writeTools).toEqual([]);
  });
});

describe('loadConfig OAuth resource server', () => {
  const ISSUER = 'https://idp.example/realms/mcp';
  const PUBLIC = 'https://mcp.example/mcp';
  const oauthEnv = (o: Record<string, string | undefined> = {}) =>
    httpEnv({ MCP_OAUTH_ISSUER: ISSUER, MCP_PUBLIC_URL: PUBLIC, ...o });
  const lines = (o: Record<string, string | undefined>) =>
    errorOf(oauthEnv(o)).message.split('\n').slice(1);

  it('leaves http.oauth absent when MCP_OAUTH_ISSUER is unset', () => {
    expect(loadConfig(httpEnv()).http).not.toHaveProperty('oauth');
  });

  it('treats an empty MCP_OAUTH_ISSUER as unset', () => {
    const config = loadConfig(httpEnv({ MCP_OAUTH_ISSUER: '' }));
    expect(config.http).not.toHaveProperty('oauth');
  });

  it('still requires MCP_AUTH_TOKEN when OAuth is off', () => {
    expect(errorOf(httpEnv({ MCP_AUTH_TOKEN: undefined })).message).toContain(
      '- MCP_AUTH_TOKEN is required when MCP_TRANSPORT=http',
    );
  });

  it('parses issuer and public URL, audience defaulting to the public URL', () => {
    expect(loadConfig(oauthEnv()).http?.oauth).toEqual({
      issuer: ISSUER,
      resourceUrl: PUBLIC,
      audience: PUBLIC,
    });
  });

  it('uses an explicit MCP_OAUTH_AUDIENCE', () => {
    const aud = 'https://api.example/inio';
    expect(loadConfig(oauthEnv({ MCP_OAUTH_AUDIENCE: aud })).http?.oauth?.audience).toBe(aud);
  });

  it('makes MCP_AUTH_TOKEN optional when OAuth is on', () => {
    const http = loadConfig(oauthEnv({ MCP_AUTH_TOKEN: undefined })).http;
    expect(http?.authToken).toBeUndefined();
  });

  it('keeps a valid MCP_AUTH_TOKEN next to OAuth', () => {
    expect(loadConfig(oauthEnv()).http?.authToken).toBe(TOKEN);
  });

  it('still validates MCP_AUTH_TOKEN when set next to OAuth', () => {
    expect(lines({ MCP_AUTH_TOKEN: 'short' })).toEqual([
      '- MCP_AUTH_TOKEN must be at least 32 characters',
    ]);
  });

  it.each(['http://idp.example/realms/mcp', 'not a url', 'ftp://idp.example/x'])(
    'rejects issuer %j',
    (issuer) => {
      expect(lines({ MCP_OAUTH_ISSUER: issuer })).toEqual([
        '- MCP_OAUTH_ISSUER must be an https URL (http allowed only for localhost)',
      ]);
    },
  );

  it.each(['http://localhost:8080/realms/mcp', 'http://127.0.0.1:8080/realms/mcp'])(
    'allows http issuer %s on loopback',
    (issuer) => {
      expect(loadConfig(oauthEnv({ MCP_OAUTH_ISSUER: issuer })).http?.oauth?.issuer).toBe(issuer);
    },
  );

  it('requires MCP_PUBLIC_URL when the issuer is set', () => {
    expect(lines({ MCP_PUBLIC_URL: undefined })).toEqual([
      '- MCP_PUBLIC_URL is required when MCP_OAUTH_ISSUER is set',
    ]);
  });

  it.each(['http://mcp.example/mcp', 'not a url', '/mcp'])('rejects public URL %j', (u) => {
    expect(lines({ MCP_PUBLIC_URL: u })).toEqual([
      '- MCP_PUBLIC_URL must be an https URL (http allowed only for localhost)',
    ]);
  });

  it('allows an http public URL on localhost', () => {
    const u = 'http://localhost:3000/mcp';
    expect(loadConfig(oauthEnv({ MCP_PUBLIC_URL: u })).http?.oauth?.resourceUrl).toBe(u);
  });

  it.each([
    'https://mcp.example',
    'https://mcp.example/',
    'https://mcp.example/mcp/x',
    'https://mcp.example/xmcp',
  ])('rejects public URL %s whose path does not end in /mcp', (u) => {
    expect(lines({ MCP_PUBLIC_URL: u })).toEqual(['- MCP_PUBLIC_URL must end with /mcp']);
  });

  it('accepts a public URL with a longer path ending in /mcp', () => {
    const u = 'https://mcp.example/v1/mcp';
    expect(loadConfig(oauthEnv({ MCP_PUBLIC_URL: u })).http?.oauth?.resourceUrl).toBe(u);
  });

  it('reports every OAuth problem on its own line', () => {
    expect(
      lines({ MCP_OAUTH_ISSUER: 'http://idp.example/r', MCP_PUBLIC_URL: 'https://m.example/' }),
    ).toEqual([
      '- MCP_OAUTH_ISSUER must be an https URL (http allowed only for localhost)',
      '- MCP_PUBLIC_URL must end with /mcp',
    ]);
  });

  it('rejects MCP_PUBLIC_URL without MCP_OAUTH_ISSUER', () => {
    expect(errorOf(httpEnv({ MCP_PUBLIC_URL: PUBLIC })).message).toBe(
      'Invalid Inio MCP configuration:\n- MCP_PUBLIC_URL requires MCP_OAUTH_ISSUER',
    );
  });

  it('rejects MCP_OAUTH_AUDIENCE without MCP_OAUTH_ISSUER', () => {
    expect(errorOf(httpEnv({ MCP_OAUTH_AUDIENCE: PUBLIC })).message).toBe(
      'Invalid Inio MCP configuration:\n- MCP_OAUTH_AUDIENCE requires MCP_OAUTH_ISSUER',
    );
  });

  describe('MCP_OAUTH_ALLOW_UNTYPED_TOKENS', () => {
    it('sets allowUntypedTokens when true', () => {
      const oauth = loadConfig(oauthEnv({ MCP_OAUTH_ALLOW_UNTYPED_TOKENS: 'true' })).http?.oauth;
      expect(oauth?.allowUntypedTokens).toBe(true);
    });

    it.each([undefined, 'false'])('leaves allowUntypedTokens absent when %s', (v) => {
      const oauth = loadConfig(oauthEnv({ MCP_OAUTH_ALLOW_UNTYPED_TOKENS: v })).http?.oauth;
      expect(oauth).not.toHaveProperty('allowUntypedTokens');
    });

    it('rejects an invalid value', () => {
      expect(lines({ MCP_OAUTH_ALLOW_UNTYPED_TOKENS: 'yes' })).toEqual([
        '- MCP_OAUTH_ALLOW_UNTYPED_TOKENS must be one of: false, true',
      ]);
    });

    it('requires MCP_OAUTH_ISSUER', () => {
      expect(errorOf(httpEnv({ MCP_OAUTH_ALLOW_UNTYPED_TOKENS: 'true' })).message).toBe(
        'Invalid Inio MCP configuration:\n- MCP_OAUTH_ALLOW_UNTYPED_TOKENS requires MCP_OAUTH_ISSUER',
      );
    });

    it('reports allowUntypedTokens in startupFields when on', () => {
      const fields = startupFields(
        loadConfig(oauthEnv({ MCP_OAUTH_ALLOW_UNTYPED_TOKENS: 'true' })),
      );
      expect(fields).toHaveProperty('oauth', { issuer: ISSUER, allowUntypedTokens: true });
    });

    it('omits allowUntypedTokens from startupFields by default', () => {
      expect(startupFields(loadConfig(oauthEnv()))).toHaveProperty('oauth', { issuer: ISSUER });
    });
  });

  describe('startupFields', () => {
    it('reports oauth with the issuer only when OAuth is on', () => {
      const fields = startupFields(
        loadConfig(oauthEnv({ MCP_OAUTH_AUDIENCE: 'https://a.example/x' })),
      );
      expect(fields).toHaveProperty('oauth', { issuer: ISSUER });
      expect(JSON.stringify(fields)).not.toContain(TOKEN);
    });

    it('omits oauth when OAuth is off', () => {
      expect(startupFields(loadConfig(httpEnv()))).not.toHaveProperty('oauth');
    });
  });
});
