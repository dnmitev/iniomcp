import { errors } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTokenVerifier,
  protectedResourceMetadata,
  resourceMetadataUrl,
} from '../../src/oauth.ts';
import {
  AUDIENCE,
  createFakeIdp,
  DISCOVERY_URL,
  ISSUER,
  JWKS_URL,
  makeKey,
  unsignedToken,
} from './helpers/fake-idp.ts';

afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const idp = await createFakeIdp();
  const verifier = createTokenVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    resourceUrl: AUDIENCE,
    fetch: idp.fetch,
  });
  return { idp, verify: (t: string) => verifier.verifyAccessToken(t) };
}

describe('protectedResourceMetadata', () => {
  it('describes the resource with the issuer as its only authorization server', () => {
    expect(
      protectedResourceMetadata({
        issuer: ISSUER,
        resourceUrl: AUDIENCE,
        audience: 'https://other.example/a',
      }),
    ).toEqual({
      resource: AUDIENCE,
      authorization_servers: [ISSUER],
      bearer_methods_supported: ['header'],
      resource_name: 'Inio MCP',
    });
  });
});

describe('resourceMetadataUrl', () => {
  it.each([
    ['https://mcp.example/mcp', 'https://mcp.example/.well-known/oauth-protected-resource/mcp'],
    [
      'https://mcp.example/v1/mcp',
      'https://mcp.example/.well-known/oauth-protected-resource/v1/mcp',
    ],
    ['http://localhost:3000/mcp', 'http://localhost:3000/.well-known/oauth-protected-resource/mcp'],
  ])('inserts the well-known prefix between origin and path of %s', (input, expected) => {
    expect(resourceMetadataUrl(input)).toBe(expected);
  });
});

describe('createTokenVerifier accepts', () => {
  it('a valid RS256 token and returns AuthInfo built from its claims', async () => {
    const { idp, verify } = await setup();
    const token = await idp.sign({
      typ: 'at+jwt',
      claims: { sub: 'user-1', preferred_username: 'alice', azp: 'web', scope: 'a b' },
      exp: 4_000_000_000,
    });
    const info = await verify(token);
    expect(info).toEqual({
      token,
      clientId: 'web',
      scopes: ['a', 'b'],
      expiresAt: 4_000_000_000,
      resource: new URL(AUDIENCE),
      extra: { sub: 'user-1', preferred_username: 'alice' },
    });
  });

  it('a valid ES256 token', async () => {
    const { idp, verify } = await setup();
    const ec = await makeKey('ec1', 'ES256');
    idp.keys.push(ec);
    const token = await idp.sign({
      typ: 'at+jwt',
      alg: 'ES256',
      kid: 'ec1',
      key: ec.privateKey,
      claims: { sub: 's' },
    });
    expect((await verify(token)).extra).toEqual({ sub: 's' });
  });

  it('a token whose aud array contains the audience', async () => {
    const { idp, verify } = await setup();
    const token = await idp.sign({ typ: 'at+jwt', aud: ['account', AUDIENCE] });
    expect((await verify(token)).token).toBe(token);
  });

  it('client_id when azp is absent', async () => {
    const { idp, verify } = await setup();
    expect(
      (await verify(await idp.sign({ typ: 'at+jwt', claims: { client_id: 'cid' } }))).clientId,
    ).toBe('cid');
  });

  it('azp over client_id', async () => {
    const { idp, verify } = await setup();
    const info = await verify(
      await idp.sign({ typ: 'at+jwt', claims: { client_id: 'cid', azp: 'az' } }),
    );
    expect(info.clientId).toBe('az');
  });

  it('an empty clientId, no scopes and only present claims in extra', async () => {
    const { idp, verify } = await setup();
    const info = await verify(await idp.sign({ typ: 'at+jwt' }));
    expect(info.clientId).toBe('');
    expect(info.scopes).toEqual([]);
    expect(info.extra).toEqual({});
  });

  it('a token without preferred_username: extra carries sub only', async () => {
    const { idp, verify } = await setup();
    expect((await verify(await idp.sign({ typ: 'at+jwt', claims: { sub: 'u' } }))).extra).toEqual({
      sub: 'u',
    });
  });
});

const requestUrl = (i: Parameters<typeof globalThis.fetch>[0]): string =>
  typeof i === 'string' ? i : i instanceof URL ? i.href : i.url;

describe('createTokenVerifier rejects', () => {
  it('a token from another issuer', async () => {
    const { idp, verify } = await setup();
    await expect(
      verify(await idp.sign({ typ: 'at+jwt', iss: 'https://evil.example/realms/mcp' })),
    ).rejects.toThrow(errors.JOSEError);
  });

  it('a token without iss', async () => {
    const { idp, verify } = await setup();
    await expect(verify(await idp.sign({ typ: 'at+jwt', iss: null }))).rejects.toThrow(
      errors.JOSEError,
    );
  });

  it('a token for another audience', async () => {
    const { idp, verify } = await setup();
    await expect(
      verify(await idp.sign({ typ: 'at+jwt', aud: 'https://other.example/mcp' })),
    ).rejects.toThrow(errors.JOSEError);
  });

  it('a token without aud', async () => {
    const { idp, verify } = await setup();
    await expect(verify(await idp.sign({ typ: 'at+jwt', aud: null }))).rejects.toThrow(
      errors.JOSEError,
    );
  });

  it('an expired token', async () => {
    const { idp, verify } = await setup();
    const past = Math.floor(Date.now() / 1000) - 120;
    await expect(verify(await idp.sign({ typ: 'at+jwt', exp: past }))).rejects.toThrow(
      errors.JOSEError,
    );
  });

  it('a token without exp', async () => {
    const { idp, verify } = await setup();
    const { SignJWT } = await import('jose');
    const key = idp.keys[0];
    if (!key) throw new Error('no key');
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: key.kid })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .sign(key.privateKey);
    await expect(verify(token)).rejects.toThrow(errors.JOSEError);
  });

  it('a token that is not valid yet (nbf)', async () => {
    const { idp, verify } = await setup();
    const future = Math.floor(Date.now() / 1000) + 120;
    await expect(verify(await idp.sign({ typ: 'at+jwt', nbf: future }))).rejects.toThrow(
      errors.JOSEError,
    );
  });

  it('a token signed with another key under a known kid', async () => {
    const { idp, verify } = await setup();
    const other = await makeKey('k1');
    await expect(verify(await idp.sign({ typ: 'at+jwt', key: other.privateKey }))).rejects.toThrow(
      errors.JOSEError,
    );
  });

  it('an unsigned alg none token', async () => {
    const { verify } = await setup();
    await expect(verify(unsignedToken())).rejects.toThrow(errors.JOSEError);
  });

  it('an HS256 token signed with a shared secret', async () => {
    const { idp, verify } = await setup();
    const secret = new TextEncoder().encode('0123456789abcdef0123456789abcdef');
    await expect(
      verify(await idp.sign({ typ: 'at+jwt', alg: 'HS256', key: secret })),
    ).rejects.toThrow(errors.JOSEError);
  });

  it.each(['', 'garbage', 'a.b.c', 'a.b'])('unparseable token %j', async (t) => {
    const { verify } = await setup();
    await expect(verify(t)).rejects.toThrow(errors.JOSEError);
  });

  it('a token for an unknown kid that the provider does not publish', async () => {
    const { idp, verify } = await setup();
    const other = await makeKey('nope');
    await expect(
      verify(await idp.sign({ typ: 'at+jwt', kid: 'nope', key: other.privateKey })),
    ).rejects.toThrow(errors.JOSEError);
  });

  it('every token while the provider is unreachable', async () => {
    const { idp, verify } = await setup();
    idp.state.down = true;
    await expect(verify(await idp.sign({ typ: 'at+jwt' }))).rejects.toThrow('connect ECONNREFUSED');
  });

  it('every token when the discovery document names a different issuer', async () => {
    const idp = await createFakeIdp();
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) =>
      requestUrl(input) === DISCOVERY_URL
        ? Promise.resolve(
            Response.json({ issuer: 'https://evil.example/realms/mcp', jwks_uri: JWKS_URL }),
          )
        : idp.fetch(input, init),
    );
    const verifier = createTokenVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      resourceUrl: AUDIENCE,
      fetch,
    });
    await expect(verifier.verifyAccessToken(await idp.sign({ typ: 'at+jwt' }))).rejects.toThrow(
      'OIDC discovery document does not match the configured issuer',
    );
  });
});

describe('createTokenVerifier with a non-URL audience', () => {
  it('accepts the token and reports the resource URL, not the audience, as resource', async () => {
    const idp = await createFakeIdp();
    const verifier = createTokenVerifier({
      issuer: ISSUER,
      audience: 'inio-mcp',
      resourceUrl: AUDIENCE,
      fetch: idp.fetch,
    });
    const info = await verifier.verifyAccessToken(
      await idp.sign({ typ: 'at+jwt', aud: 'inio-mcp' }),
    );
    expect(info.resource).toEqual(new URL(AUDIENCE));
  });
});

describe('createTokenVerifier discovery hardening', () => {
  const make = (fetch: typeof globalThis.fetch, issuer = ISSUER) =>
    createTokenVerifier({ issuer, audience: AUDIENCE, resourceUrl: AUDIENCE, fetch });

  it('fetches discovery with redirect manual and an abort signal', async () => {
    const { idp, verify } = await setup();
    await verify(await idp.sign({ typ: 'at+jwt' }));
    const init = idp.idpCalls(DISCOVERY_URL)[0]?.[1];
    expect(init?.redirect).toBe('manual');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('gives up on a provider that never answers within 5 s, then retries discovery', async () => {
    vi.useFakeTimers();
    const idp = await createFakeIdp();
    const token = await idp.sign({ typ: 'at+jwt' });
    const verifier = make(idp.fetch);
    idp.state.hangDiscovery = true;
    const first = verifier.verifyAccessToken(token);
    const settled = first.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await settled).toMatchObject({ message: expect.stringMatching(/timed out/) });
    expect(vi.getTimerCount()).toBe(0);
    idp.state.hangDiscovery = false;
    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({ token });
    expect(idp.idpCalls(DISCOVERY_URL)).toHaveLength(2);
  });

  it('rejects an http jwks_uri for an https issuer', async () => {
    const idp = await createFakeIdp();
    idp.state.jwksUri = 'http://idp.example/realms/mcp/certs';
    await expect(
      make(idp.fetch).verifyAccessToken(await idp.sign({ typ: 'at+jwt' })),
    ).rejects.toThrow(/jwks_uri/);
    expect(idp.idpCalls(idp.state.jwksUri)).toHaveLength(0);
  });

  it.each(['http://localhost:8080/certs', 'http://127.0.0.1:8080/certs'])(
    'allows %s as jwks_uri when the issuer is localhost',
    async (jwksUri) => {
      const idp = await createFakeIdp();
      const issuer = 'http://localhost:8080/realms/mcp';
      const jwk = idp.keys[0]?.jwk;
      const fetch = vi.fn<typeof globalThis.fetch>((input) => {
        const url = requestUrl(input);
        if (url === `${issuer}/.well-known/openid-configuration`) {
          return Promise.resolve(Response.json({ issuer, jwks_uri: jwksUri }));
        }
        if (url === jwksUri) return Promise.resolve(Response.json({ keys: [jwk] }));
        return Promise.reject(new Error(`unexpected fetch ${url}`));
      });
      const token = await idp.sign({ typ: 'at+jwt', iss: issuer });
      await expect(make(fetch, issuer).verifyAccessToken(token)).resolves.toMatchObject({ token });
    },
  );
});

describe('createTokenVerifier token type', () => {
  it.each(['ID', 'Refresh', 'Offline', 'id'])(
    'rejects a token whose typ claim is %s',
    async (typ) => {
      const { idp, verify } = await setup();
      await expect(verify(await idp.sign({ claims: { typ } }))).rejects.toThrow(
        errors.JWTClaimValidationFailed,
      );
    },
  );

  it.each(['Bearer', 'bearer', 'BEARER'])('accepts a typ claim of %s', async (typ) => {
    const { idp, verify } = await setup();
    const info = await verify(await idp.sign({ claims: { typ } }));
    expect(info.resource).toEqual(new URL(AUDIENCE));
  });

  it('PR47-typ:reject-no-typ-claim: rejects a token without a typ claim', async () => {
    const { idp, verify } = await setup();
    await expect(verify(await idp.sign())).rejects.toThrow(errors.JWTClaimValidationFailed);
  });

  it.each(['at+jwt', 'AT+JWT', 'application/at+jwt'])('accepts header typ %s', async (typ) => {
    const { idp, verify } = await setup();
    await expect(verify(await idp.sign({ typ }))).resolves.toMatchObject({ clientId: '' });
  });

  it.each(['JWT', 'jwt'])('PR47-typ:reject-header-typ-%s: rejects header typ %s', async (typ) => {
    const { idp, verify } = await setup();
    await expect(verify(await idp.sign({ typ }))).rejects.toThrow(errors.JWTClaimValidationFailed);
  });

  it.each(['id_token+jwt', 'JOSE', 'logout+jwt'])('rejects header typ %s', async (typ) => {
    const { idp, verify } = await setup();
    await expect(verify(await idp.sign({ typ }))).rejects.toThrow(errors.JOSEError);
  });
});

describe('createTokenVerifier network use', () => {
  it('leaves no pending timer after a successful discovery', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const idp = await createFakeIdp();
    const verifier = createTokenVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      resourceUrl: AUDIENCE,
      fetch: idp.fetch,
    });
    await verifier.verifyAccessToken(await idp.sign({ typ: 'at+jwt' }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fetches the discovery document once across many verifications', async () => {
    const { idp, verify } = await setup();
    await verify(await idp.sign({ typ: 'at+jwt' }));
    await verify(await idp.sign({ typ: 'at+jwt' }));
    await verify(await idp.sign({ typ: 'at+jwt' }));
    expect(idp.idpCalls(DISCOVERY_URL)).toHaveLength(1);
  });

  it('fetches the discovery document once for concurrent verifications', async () => {
    const { idp, verify } = await setup();
    const tokens = await Promise.all([
      idp.sign({ typ: 'at+jwt' }),
      idp.sign({ typ: 'at+jwt' }),
      idp.sign({ typ: 'at+jwt' }),
    ]);
    await Promise.all(tokens.map(verify));
    expect(idp.idpCalls(DISCOVERY_URL)).toHaveLength(1);
  });

  it('caches the JWKS across verifications', async () => {
    const { idp, verify } = await setup();
    await verify(await idp.sign({ typ: 'at+jwt' }));
    await verify(await idp.sign({ typ: 'at+jwt' }));
    expect(idp.idpCalls(JWKS_URL)).toHaveLength(1);
  });

  it('requests discovery and JWKS from the issuer with GET', async () => {
    const { idp, verify } = await setup();
    await verify(await idp.sign({ typ: 'at+jwt' }));
    expect(idp.idpCalls().map(([i]) => requestUrl(i))).toEqual([DISCOVERY_URL, JWKS_URL]);
  });

  it('refetches the JWKS on an unknown kid after key rotation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { idp, verify } = await setup();
    await verify(await idp.sign({ typ: 'at+jwt' }));
    const rotated = await makeKey('k2');
    idp.keys.unshift(rotated);
    // jose waits out its cooldown before reloading on a miss
    vi.setSystemTime(Date.now() + 60_000);
    const token = await idp.sign({ typ: 'at+jwt', kid: 'k2' });
    await expect(verify(token)).resolves.toMatchObject({ token });
    expect(idp.idpCalls(JWKS_URL)).toHaveLength(2);
    expect(idp.idpCalls(DISCOVERY_URL)).toHaveLength(1);
  });
});

describe('createTokenVerifier discovery URL and failures', () => {
  const make = (fetch: typeof globalThis.fetch, issuer = ISSUER) =>
    createTokenVerifier({ issuer, audience: AUDIENCE, resourceUrl: AUDIENCE, fetch });

  it('strips every trailing slash of the issuer before appending the well-known path', async () => {
    const idp = await createFakeIdp();
    const issuer = `${ISSUER}///`;
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) =>
      requestUrl(input) === DISCOVERY_URL
        ? Promise.resolve(Response.json({ issuer, jwks_uri: JWKS_URL }))
        : idp.fetch(input, init),
    );
    const token = await idp.sign({ typ: 'at+jwt', iss: issuer });
    await expect(make(fetch, issuer).verifyAccessToken(token)).resolves.toMatchObject({ token });
    expect(requestUrl(fetch.mock.calls[0]?.[0] ?? '')).toBe(DISCOVERY_URL);
  });

  it.each([500, 404])('rejects naming the status when discovery answers %i', async (status) => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response('x', { status })),
    );
    const idp = await createFakeIdp();
    await expect(make(fetch).verifyAccessToken(await idp.sign({ typ: 'at+jwt' }))).rejects.toThrow(
      `OIDC discovery failed with status ${status}`,
    );
  });

  it('rejects a mismatching discovery issuer with the issuer-mismatch message', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json({ issuer: 'https://evil.example', jwks_uri: JWKS_URL })),
    );
    const idp = await createFakeIdp();
    await expect(make(fetch).verifyAccessToken(await idp.sign({ typ: 'at+jwt' }))).rejects.toThrow(
      /does not match the configured issuer/,
    );
  });

  it('rejects a discovery document without jwks_uri as an issuer mismatch', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json({ issuer: ISSUER })),
    );
    const idp = await createFakeIdp();
    await expect(make(fetch).verifyAccessToken(await idp.sign({ typ: 'at+jwt' }))).rejects.toThrow(
      /does not match the configured issuer/,
    );
  });

  it('retries discovery on the next token after a failure', async () => {
    const idp = await createFakeIdp();
    let fail = true;
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) =>
      fail && requestUrl(input) === DISCOVERY_URL
        ? Promise.resolve(new Response('x', { status: 500 }))
        : idp.fetch(input, init),
    );
    const verifier = make(fetch);
    const token = await idp.sign({ typ: 'at+jwt' });
    await expect(verifier.verifyAccessToken(token)).rejects.toThrow('status 500');
    fail = false;
    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({ token });
    expect(fetch.mock.calls.filter(([i]) => requestUrl(i) === DISCOVERY_URL)).toHaveLength(2);
  });

  it('fails with a plain Error naming the status when the JWKS endpoint answers non-2xx', async () => {
    const { idp, verify } = await setup();
    idp.state.jwksStatus = 503;
    const err = await verify(await idp.sign({ typ: 'at+jwt' })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(errors.JOSEError);
    expect(err).toHaveProperty('message', 'JWKS fetch failed with status 503');
  });
});

describe('createTokenVerifier claims mapping', () => {
  it.each([
    ['a  b ', ['a', 'b']],
    ['', []],
    ['single', ['single']],
  ])('splits scope %j into %j', async (scope, expected) => {
    const { idp, verify } = await setup();
    expect((await verify(await idp.sign({ typ: 'at+jwt', claims: { scope } }))).scopes).toEqual(
      expected,
    );
  });

  it('yields no scopes when scope is missing or not a string', async () => {
    const { idp, verify } = await setup();
    expect((await verify(await idp.sign({ typ: 'at+jwt' }))).scopes).toEqual([]);
    expect(
      (await verify(await idp.sign({ typ: 'at+jwt', claims: { scope: ['a'] } }))).scopes,
    ).toEqual([]);
  });

  it('omits sub from extra when the token has none', async () => {
    const { idp, verify } = await setup();
    const info = await verify(
      await idp.sign({ typ: 'at+jwt', claims: { preferred_username: 'alice' } }),
    );
    expect(info.extra).toStrictEqual({ preferred_username: 'alice' });
  });

  it('omits preferred_username from extra when absent', async () => {
    const { idp, verify } = await setup();
    const info = await verify(await idp.sign({ typ: 'at+jwt', claims: { sub: 'u' } }));
    expect(info.extra).toStrictEqual({ sub: 'u' });
  });

  it('omits a non-string preferred_username and a non-string sub', async () => {
    const { idp, verify } = await setup();
    const info = await verify(
      await idp.sign({ typ: 'at+jwt', claims: { sub: 5, preferred_username: 7 } }),
    );
    expect(info.extra).toStrictEqual({});
  });

  it('reports expiresAt equal to the exp claim', async () => {
    const { idp, verify } = await setup();
    const exp = Math.floor(Date.now() / 1000) + 777;
    expect((await verify(await idp.sign({ typ: 'at+jwt', exp }))).expiresAt).toBe(exp);
  });

  it('ignores a non-string azp and falls back to client_id', async () => {
    const { idp, verify } = await setup();
    const info = await verify(
      await idp.sign({ typ: 'at+jwt', claims: { azp: 1, client_id: 'cid' } }),
    );
    expect(info.clientId).toBe('cid');
  });
});

describe('createTokenVerifier algorithms', () => {
  it.each([
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
  ])('accepts %s', async (alg) => {
    const { idp, verify } = await setup();
    const key = await makeKey(`k-${alg}`, alg);
    idp.keys.push(key);
    const token = await idp.sign({ typ: 'at+jwt', alg, kid: key.kid, key: key.privateKey });
    await expect(verify(token)).resolves.toMatchObject({ token });
  });

  it.each(['HS256', 'HS384', 'HS512'])('rejects %s', async (alg) => {
    const { idp, verify } = await setup();
    const secret = new TextEncoder().encode('0123456789abcdef0123456789abcdef0123456789abcdef');
    await expect(verify(await idp.sign({ typ: 'at+jwt', alg, key: secret }))).rejects.toThrow(
      errors.JOSEError,
    );
  });

  it('rejects alg none', async () => {
    const { verify } = await setup();
    await expect(verify(unsignedToken())).rejects.toThrow(errors.JOSEError);
  });
});

describe('PR47-typ: ID token rejection (bug fix)', () => {
  it('PR47-typ:reject-id-token-no-typ: rejects an ID token with no typ claim (valid sig/iss/aud/exp)', async () => {
    const { idp, verify } = await setup();
    const token = await idp.sign({
      claims: { sub: 'user-1', email: 'user@example.com' },
    });
    await expect(verify(token)).rejects.toThrow(errors.JWTClaimValidationFailed);
  });

  it('PR47-typ:reject-id-token-jwt-header: rejects an ID token with header typ JWT (valid sig/iss/aud/exp)', async () => {
    const { idp, verify } = await setup();
    const token = await idp.sign({
      typ: 'JWT',
      claims: { sub: 'user-1', email: 'user@example.com' },
    });
    await expect(verify(token)).rejects.toThrow(errors.JWTClaimValidationFailed);
  });

  it('PR47-typ:accept-at-jwt-header: accepts an access token with header typ at+jwt', async () => {
    const { idp, verify } = await setup();
    const token = await idp.sign({
      typ: 'at+jwt',
      claims: { sub: 'user-1', scope: 'openid profile' },
    });
    await expect(verify(token)).resolves.toMatchObject({ token });
  });

  it('PR47-typ:accept-bearer-payload: accepts an access token with payload typ Bearer', async () => {
    const { idp, verify } = await setup();
    const token = await idp.sign({
      claims: { sub: 'user-1', typ: 'Bearer', scope: 'openid profile' },
    });
    await expect(verify(token)).resolves.toMatchObject({ token });
  });

  it('PR47-typ:reject-id-payload: rejects a token with payload typ ID', async () => {
    const { idp, verify } = await setup();
    const token = await idp.sign({
      claims: { sub: 'user-1', typ: 'ID' },
    });
    await expect(verify(token)).rejects.toThrow(errors.JWTClaimValidationFailed);
  });
});
