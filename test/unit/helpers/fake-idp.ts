import { exportJWK, generateKeyPair, SignJWT, type JWK, type CryptoKey } from 'jose';
import { vi } from 'vitest';

export const ISSUER = 'https://idp.example/realms/mcp';
export const AUDIENCE = 'https://mcp.example/mcp';
export const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;
export const JWKS_URL = `${ISSUER}/protocol/openid-connect/certs`;

type Key = { kid: string; privateKey: CryptoKey; jwk: JWK };
type SignOptions = {
  kid?: string;
  alg?: string;
  key?: CryptoKey | Uint8Array;
  claims?: Record<string, unknown>;
  iss?: string | null;
  aud?: string | string[] | null;
  exp?: string | number;
  nbf?: string | number;
};

export async function makeKey(kid: string, alg = 'RS256'): Promise<Key> {
  const { publicKey, privateKey } = await generateKeyPair(alg, { extractable: true });
  return { kid, privateKey, jwk: { ...(await exportJWK(publicKey)), kid, alg, use: 'sig' } };
}

export const urlOf = (input: string | URL | Request): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

/** In-memory OIDC provider: serves discovery and JWKS through an injected fetch, signs tokens. */
export async function createFakeIdp(fallback?: typeof globalThis.fetch) {
  const keys: Key[] = [await makeKey('k1')];
  const state = {
    down: false,
    /** Discovery is accepted but never answered; rejects only when init.signal aborts. */
    hangDiscovery: false,
    /** HTTP status served for the JWKS endpoint. */
    jwksStatus: 200,
    jwksUri: JWKS_URL,
  };
  const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
    const url = urlOf(input);
    if (url.startsWith(ISSUER) || url === state.jwksUri) {
      if (state.down) return Promise.reject(new Error('connect ECONNREFUSED'));
      if (state.hangDiscovery && url === DISCOVERY_URL) {
        return new Promise<Response>((_, reject) => {
          const { signal } = init ?? {};
          if (!signal) return;
          const abort = () =>
            reject(
              signal.reason instanceof Error
                ? signal.reason
                : new DOMException('aborted', 'AbortError'),
            );
          if (signal.aborted) abort();
          else signal.addEventListener('abort', abort, { once: true });
        });
      }
      if (url === JWKS_URL && state.jwksStatus !== 200) {
        return Promise.resolve(new Response('unavailable', { status: state.jwksStatus }));
      }
      const body =
        url === DISCOVERY_URL
          ? { issuer: ISSUER, jwks_uri: state.jwksUri }
          : url === JWKS_URL || url === state.jwksUri
            ? { keys: keys.map((k) => k.jwk) }
            : undefined;
      if (!body) return Promise.resolve(new Response('nope', { status: 404 }));
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    return fallback ? fallback(input, init) : Promise.reject(new Error(`unexpected fetch ${url}`));
  });
  const idpCalls = (url?: string) =>
    fetch.mock.calls.filter(([i]) => (url ? urlOf(i) === url : urlOf(i).startsWith(ISSUER)));

  async function sign(o: SignOptions = {}): Promise<string> {
    const key = keys[0];
    if (!key) throw new Error('no key');
    const alg = o.alg ?? 'RS256';
    const jwt = new SignJWT({ ...(o.claims ?? {}) })
      .setProtectedHeader({ alg, kid: o.kid ?? key.kid })
      .setIssuedAt()
      .setExpirationTime(o.exp ?? '5m');
    if (o.iss !== null) jwt.setIssuer(o.iss ?? ISSUER);
    if (o.aud !== null) jwt.setAudience(o.aud ?? AUDIENCE);
    if (o.nbf !== undefined) jwt.setNotBefore(o.nbf);
    return jwt.sign(o.key ?? key.privateKey);
  }

  return { fetch, keys, state, idpCalls, sign };
}

/** Unsigned token with alg "none". */
export function unsignedToken(): string {
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none' })}.${b64({ iss: ISSUER, aud: AUDIENCE, sub: 'x', exp: now + 300 })}.`;
}
