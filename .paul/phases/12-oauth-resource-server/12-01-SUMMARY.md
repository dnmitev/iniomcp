---
phase: 12-oauth-resource-server
plan: 01
subsystem: http-auth
tags: [oauth, oidc, jwt, jose, rfc9728, keycloak]

provides:
  - src/oauth.ts: token verifier (OIDC discovery, JWKS, issuer/audience/exp, asymmetric algorithms only) and Protected Resource Metadata
  - HTTP mode: PRM routes, resource_metadata challenge, JWT access tokens next to the static token, identity to tools via req.auth
  - Config: MCP_OAUTH_ISSUER, MCP_PUBLIC_URL, MCP_OAUTH_AUDIENCE; MCP_AUTH_TOKEN optional when OAuth is on
  - Tool-call and write logs carry user { sub, name }
  - jose ^6.2.15 as a direct dependency
affects: [13-deploy-connect-release]

key-decisions:
  - "Static token checked first (constant-time); OAuth adds a second way in and never touches the static path"
  - "AuthInfo.resource = MCP_PUBLIC_URL; audience may be a plain client id (Keycloak audience mapper), default = MCP_PUBLIC_URL"
  - "No authorization server here: PRM points at the provider, Claude reads the provider's own discovery"
  - "Discovery: cached, 5 s timeout (AbortController so fake timers work), redirect manual, https jwks_uri only, retry after failure"
  - "JOSE errors = bad token (401, no warn); network, non-2xx JWKS, JWKSTimeout, discovery errors = provider outage (401 + one throttled warn)"
  - "preferred_username is logged as user.name (often an email); documented in Phase 13"

duration: ~2.5h
completed: 2026-11-03T18:30:00Z
description: "HTTP mode accepts OAuth access tokens from an OIDC provider next to the static token and advertises Protected Resource Metadata"
type: Summary
about: "inio-mcp"
---

# Phase 12 Plan 01: OAuth resource server Summary

**With `MCP_OAUTH_ISSUER` and `MCP_PUBLIC_URL` set, the HTTP server publishes Protected Resource Metadata, answers unauthenticated `/mcp` calls with a `resource_metadata` challenge, and accepts JWT access tokens from that provider for this resource, while the static token keeps working unchanged. Logs show which user called which tool.**

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Configuration | Pass | Opt-in; exact error lines; https rules (localhost exempt); /mcp suffix; audience default; startup logs issuer only |
| AC-2: Protected Resource Metadata | Pass | GET/HEAD on both well-known paths, ACAO *, pre-body, no fetch, not logged; 404 when OAuth is off |
| AC-3: Challenge | Pass | `Bearer resource_metadata="…"` (+ `error="invalid_token"` when a token was sent); Connection: close and throttle kept |
| AC-4: Access tokens accepted | Pass | Issuer, audience, exp/nbf, signature, 10 asymmetric algorithms; none/HS* rejected; key rotation; provider outage → 401 + one warn, static token still 200 |
| AC-5: User in logs | Pass | `user: { sub, name }` on tool-call and write lines; nothing else from the token |
| AC-6: Integration with a real provider | Pass | Keycloak test container: user token lists tools, client-credentials token without audience → 401, static token works, PRM served |

## Verification

| Check | Result |
|-------|--------|
| `npm run lint`, `typecheck` | Clean |
| `npm test` | 2283 passed (was 2110) |
| `npm run test:integration` | 54 passed (6 new OAuth tests) |
| `npm run test:package` | 16 passed, 11 Docker tests skipped locally (no image; CI runs them) |
| Mutation round 2 | oauth.ts 95.19 (round 1: 79.78), http.ts 92.67, config.ts 99.28, tool-logging.ts 100; round 3 tests killed the req.auth and clearTimeout survivors |
| reviewer | Round 1: 2 majors + 4 minors, all fixed; round 2 APPROVE (req.auth not spoofable) |

## Deviations from Plan

1. **Review fixes:**
   - The resource comes from `MCP_PUBLIC_URL`, not the audience. A non-URL audience broke every token.
   - Discovery now has a timeout. Without it a hung provider pinned sockets.
   - A JWKS 5xx and `JWKSTimeout` now count as an outage.
   - Only an https `jwks_uri` is accepted.
   - One shared node handler with `req.auth`.
   - A catch on the authenticate chain answers 500.
2. **Shared warn throttle:** the 401 and provider warns use one throttled-warn helper, each with its own state.
3. **Keycloak work, done in the owner's private provider repo at the owner's request, not in this repo:**
   - Sign-in was verified there against a real Keycloak 26.2: authorization code with PKCE, audience, refresh rotation.
   - Two requirements were found and handled: an `offline_access` scope is needed because Claude always adds it, and the client needs full scope allowed for offline tokens.

### Deferred Items
- A test that runs the Docker image with the OAuth variables set comes with the Phase 13 release, through CI.
- `preferred_username` (often an email) is logged as `user.name`. Phase 13 docs must say so; switch to `sub` only if the owner prefers.

## Next Phase Readiness

**Ready:** Phase 13 adds:
- chart values (`oauth.issuer`, `publicUrl`, `audience`);
- an Ingress / HTTPRoute path for `/.well-known/oauth-protected-resource`;
- a generic provider guide, including the `offline_access` and full-scope notes;
- a guide for Claude on the web, Desktop and mobile;
- the owner's sign-in from claude.ai;
- the release.

**Concerns:** The Ingress currently routes only `/mcp`. The 401 points Claude at the metadata URL on the same host, so that path must be routed, or sign-in fails.

**Blockers:** None

---
*Phase: 12-oauth-resource-server, Plan: 01*
*Completed: 2026-11-03*
