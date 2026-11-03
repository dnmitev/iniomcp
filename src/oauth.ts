import type { AuthInfo } from '@modelcontextprotocol/server';
import type { JWTPayload } from 'jose';
import { createRemoteJWKSet, customFetch, errors, jwtVerify } from 'jose';
import { z } from 'zod';
import { isAllowedUrl } from './config.ts';

export type OAuthConfig = {
  issuer: string;
  resourceUrl: string;
  audience: string;
  allowUntypedTokens?: true;
};

// Asymmetric only: HS* would let anyone holding the public key forge tokens, "none" is never listed.
const ALGORITHMS = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
];
const DISCOVERY_TIMEOUT_MS = 5000;
const CLOCK_TOLERANCE_S = 30;
const PRM_PREFIX = '/.well-known/oauth-protected-resource';

export const protectedResourceMetadata = ({ issuer, resourceUrl }: OAuthConfig) => ({
  resource: resourceUrl,
  authorization_servers: [issuer],
  bearer_methods_supported: ['header'],
  resource_name: 'Inio MCP',
});

/** RFC 9728 metadata URL for a resource: the well-known prefix goes between origin and path. */
export function resourceMetadataUrl(resourceUrl: string): string {
  const { origin, pathname } = new URL(resourceUrl);
  return origin + PRM_PREFIX + pathname;
}

// Explicit typ markers decide first: a non-access typ rejects (ID tokens can carry our audience).
// With no marker at all, accept only when allowUntypedTokens (providers that omit typ).
function assertAccessToken(
  payload: JWTPayload,
  headerTyp: string | undefined,
  allowUntyped: boolean,
): void {
  const typ = payload['typ'];
  const payloadTyp = typeof typ === 'string' ? typ.toLowerCase() : typ;
  const header = headerTyp?.toLowerCase();
  const headerIsAccess = header === 'at+jwt' || header === 'application/at+jwt';
  const rejected =
    (typ !== undefined && payloadTyp !== 'bearer') ||
    (header !== undefined && !headerIsAccess && header !== 'jwt');
  const ok = !rejected && (headerIsAccess || payloadTyp === 'bearer' || allowUntyped);
  if (!ok) {
    throw new errors.JWTClaimValidationFailed(
      'token is not an access token',
      payload,
      'typ',
      'check_failed',
    );
  }
}

/** Verifies JWT access tokens against the issuer's JWKS (found through OIDC discovery, fetched once). Throws on any failure. */
export function createTokenVerifier({
  issuer,
  audience,
  resourceUrl,
  allowUntypedTokens = false,
  fetch = globalThis.fetch,
}: {
  issuer: string;
  audience: string;
  resourceUrl: string;
  allowUntypedTokens?: boolean;
  fetch?: typeof globalThis.fetch;
}) {
  let jwks: Promise<ReturnType<typeof createRemoteJWKSet>> | undefined;

  const discover = async () => {
    // AbortController + setTimeout (not AbortSignal.timeout) so the deadline follows injected/fake timers.
    const ctl = new AbortController();
    const timer = setTimeout(
      () => ctl.abort(new Error('OIDC discovery timed out')),
      DISCOVERY_TIMEOUT_MS,
    );
    let body: unknown;
    try {
      const res = await fetch(`${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`, {
        signal: ctl.signal,
        redirect: 'manual',
      });
      if (!res.ok) throw new Error(`OIDC discovery failed with status ${res.status}`);
      body = await res.json();
    } finally {
      clearTimeout(timer);
    }
    const doc = z.object({ issuer: z.string(), jwks_uri: z.string() }).safeParse(body);
    if (!doc.success || doc.data.issuer !== issuer) {
      throw new Error('OIDC discovery document does not match the configured issuer');
    }
    if (!isAllowedUrl(doc.data.jwks_uri)) throw new Error('OIDC jwks_uri must be an https URL');
    return createRemoteJWKSet(new URL(doc.data.jwks_uri), {
      [customFetch]: async (url, init) => {
        const r = await fetch(url, init);
        if (!r.ok) throw new Error(`JWKS fetch failed with status ${r.status}`);
        return r;
      },
    });
  };

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      // A failed discovery is retried by the next token.
      jwks ??= discover().catch((err: unknown) => {
        jwks = undefined;
        throw err;
      });
      const { payload, protectedHeader } = await jwtVerify(token, await jwks, {
        issuer,
        audience,
        algorithms: ALGORITHMS,
        clockTolerance: CLOCK_TOLERANCE_S,
        requiredClaims: ['exp'],
      });
      assertAccessToken(payload, protectedHeader.typ, allowUntypedTokens);
      const { sub, preferred_username: name, azp, client_id: cid, scope, exp } = payload;
      const clientId = [azp, cid].find((v) => typeof v === 'string');
      return {
        token,
        clientId: typeof clientId === 'string' ? clientId : '',
        scopes: typeof scope === 'string' ? scope.split(' ').filter(Boolean) : [],
        ...(exp !== undefined && { expiresAt: exp }),
        resource: new URL(resourceUrl),
        extra: {
          ...(typeof sub === 'string' && { sub }),
          ...(typeof name === 'string' && { preferred_username: name }),
        },
      };
    },
  };
}
