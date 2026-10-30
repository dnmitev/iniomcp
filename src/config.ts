export type Config = {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  apiUrl: string;
  allowWrites: boolean;
  revealPii: boolean;
  transport: 'stdio' | 'http';
  http?: { port: number; host: string; authToken: string; allowedOrigins: string[] };
  logLevel: LogLevel;
  requestTimeoutMs: number;
};

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

type Env = Record<string, string | undefined>;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export const isLoopbackHost = (host: string): boolean => LOCAL_HOSTS.has(host);
const TOKEN_PATH = '/protocol/openid-connect/token';

/** Parses and validates Inio MCP settings. Error messages name vars only, never values. */
export function loadConfig(env: Env): Config {
  const problems: string[] = [];

  const required = (name: string): string => {
    const value = env[name];
    if (!value) problems.push(`${name} is required`);
    return value ?? '';
  };

  const url = (name: string): string => {
    const value = required(name);
    if (value && !isAllowedUrl(value)) {
      problems.push(`${name} must be an https URL (http allowed only for localhost)`);
    }
    return value;
  };

  const oneOf = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
    const raw = env[name];
    if (!raw) return fallback;
    const value = allowed.find((a) => a === raw);
    if (value) return value;
    problems.push(`${name} must be one of: ${allowed.join(', ')}`);
    return fallback;
  };

  const transport = oneOf('MCP_TRANSPORT', ['stdio', 'http'], 'stdio');

  const integer = (name: string, fallback: number, min: number, max: number): number => {
    const raw = env[name];
    if (!raw) return fallback;
    const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (value >= min && value <= max) return value;
    problems.push(`${name} must be an integer from ${min} to ${max}`);
    return fallback;
  };

  const authToken = (): string => {
    const value = env.MCP_AUTH_TOKEN ?? '';
    if (!value) problems.push('MCP_AUTH_TOKEN is required when MCP_TRANSPORT=http');
    else if (/\s/.test(value)) problems.push('MCP_AUTH_TOKEN must not contain whitespace');
    else if (!/^[\x21-\x7e]+$/.test(value)) {
      problems.push('MCP_AUTH_TOKEN must contain only printable ASCII characters');
    } else if (value.length < 32) problems.push('MCP_AUTH_TOKEN must be at least 32 characters');
    return value;
  };

  const origins = (name: string): string[] => {
    const list = (env[name] ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    if (!list.every(isHttpOrigin)) {
      problems.push(`${name} must be a comma-separated list of http(s) origins`);
    }
    return list;
  };

  const flag = (name: string): boolean => oneOf(name, ['false', 'true'], 'false') === 'true';

  const config: Config = {
    clientId: required('INIO_CLIENT_ID'),
    clientSecret: required('INIO_CLIENT_SECRET'),
    authUrl: toTokenUrl(url('INIO_AUTH_URL')),
    apiUrl: url('INIO_URL').replace(/\/+$/, ''),
    allowWrites: flag('INIO_ALLOW_WRITES'),
    revealPii: flag('INIO_REVEAL_PII'),
    transport,
    logLevel: oneOf('INIO_LOG_LEVEL', LOG_LEVELS, 'info'),
    requestTimeoutMs: integer('INIO_REQUEST_TIMEOUT_MS', 30_000, 1000, 600_000),
  };
  if (transport === 'http') {
    config.http = {
      port: integer('PORT', 3000, 1, 65_535),
      host: env.HOST || '127.0.0.1',
      authToken: authToken(),
      allowedOrigins: origins('MCP_ALLOWED_ORIGINS'),
    };
  }

  if (problems.length > 0) {
    throw new Error(`Invalid Inio MCP configuration:\n- ${problems.join('\n- ')}`);
  }
  return config;
}

function isHttpOrigin(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const { protocol, origin } = new URL(value);
  return (protocol === 'http:' || protocol === 'https:') && origin === value;
}

function isAllowedUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const { protocol, hostname } = new URL(value);
  return protocol === 'https:' || (protocol === 'http:' && LOCAL_HOSTS.has(hostname));
}

/** Accepts a token endpoint as-is, or a Keycloak realm issuer and appends the token path. */
function toTokenUrl(value: string): string {
  const trimmed = value.replace(/\/+$/, '');
  return trimmed.endsWith('/token') ? trimmed : trimmed + TOKEN_PATH;
}
