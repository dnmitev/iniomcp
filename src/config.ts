export type Config = {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  apiUrl: string;
  allowWrites: boolean;
  revealPii: boolean;
  transport: 'stdio' | 'http';
  logLevel: LogLevel;
};

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

type Env = Record<string, string | undefined>;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
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

  const flag = (name: string): boolean => oneOf(name, ['false', 'true'], 'false') === 'true';

  const config: Config = {
    clientId: required('INIO_CLIENT_ID'),
    clientSecret: required('INIO_CLIENT_SECRET'),
    authUrl: toTokenUrl(url('INIO_AUTH_URL')),
    apiUrl: url('INIO_URL').replace(/\/+$/, ''),
    allowWrites: flag('INIO_ALLOW_WRITES'),
    revealPii: flag('INIO_REVEAL_PII'),
    transport: oneOf('MCP_TRANSPORT', ['stdio', 'http'], 'stdio'),
    logLevel: oneOf('INIO_LOG_LEVEL', LOG_LEVELS, 'info'),
  };

  if (problems.length > 0) {
    throw new Error(`Invalid Inio MCP configuration:\n- ${problems.join('\n- ')}`);
  }
  return config;
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
