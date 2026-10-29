import { describe, expect, it } from 'vitest';
import { loadConfig, type Config } from '../../src/config.ts';

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
      });
    });

    it('ignores unrelated env vars', () => {
      const config = loadConfig(
        env({ PATH: '/usr/bin', HOME: '/home/x', INIO_UNKNOWN: 'whatever' }),
      );
      expect(config).toEqual(loadConfig(env()));
      expect(Object.keys(config).sort()).toEqual([
        'allowWrites',
        'apiUrl',
        'authUrl',
        'clientId',
        'clientSecret',
        'logLevel',
        'requestTimeoutMs',
        'revealPii',
        'transport',
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
    it('lists only stdio as allowed when rejected', () => {
      expect(errorOf(env({ MCP_TRANSPORT: 'sse' })).message).toMatch(
        /MCP_TRANSPORT must be one of: stdio$/m,
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

    it('rejects http as not supported yet', () => {
      expect(errorOf(env({ MCP_TRANSPORT: 'http' })).message).toContain(
        'MCP_TRANSPORT=http is not supported yet; only stdio is available.',
      );
    });

    it('does not leak the client secret when rejecting http', () => {
      expect(errorOf(env({ MCP_TRANSPORT: 'http' })).message).not.toContain(SECRET);
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
});
