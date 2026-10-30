---
phase: 05-http-hardening
plan: 01
subsystem: api
tags: [mcp, streamable-http, bearer-auth, origin-validation, createMcpHandler, toNodeHandler]

requires:
  - phase: 04-write-tools
    provides: server.ts tool registration, token provider shared by create_payment/create_customer
provides:
  - MCP_TRANSPORT=http with a required static bearer token (MCP_AUTH_TOKEN)
  - src/http.ts (createHttpHandler, startHttpServer, HttpConfig)
  - createServerFactory (one token provider and Inio client across per-request servers)
affects: [05-02 Docker HTTP mode, README, release 0.3.0]

tech-stack:
  added: ["@modelcontextprotocol/node 2.1.2 (pulls hono 4.13.14, @hono/node-server 2.1.5)"]
  patterns:
    - "Web-standard handler (Request → Response) for unit tests; toNodeHandler only at the edge"
    - "Checks in order: path, then bearer, then Origin, then MCP"

key-files:
  created: [src/http.ts, test/unit/http.test.ts, test/integration/http.integration.test.ts]
  modified: [src/config.ts, src/server.ts, src/index.ts, package.json, test/unit/config.test.ts, test/unit/server.test.ts]

key-decisions:
  - "Static bearer token, constant-time compare of SHA-256 digests; 401 + WWW-Authenticate: Bearer"
  - "MCP_AUTH_TOKEN ≥32 chars and no whitespace (reviewer finding)"
  - "Origin allowlist matches by hostname (SDK originValidationResponse); bearer is the real barrier"
  - "Auth before Origin, so unauthenticated callers learn nothing"
  - "createServerFactory: tools per request, token provider and client once"

patterns-established:
  - "HttpConfig = Config & { http: NonNullable<Config['http']> }; narrow in index.ts, no runtime guard"

duration: ~7h (with checkpoint)
started: 2026-10-30T07:48:52+02:00
completed: 2026-10-30T15:00:00+02:00
description: "Streamable HTTP transport on /mcp behind a static bearer token and Origin check, sharing one Inio token across requests"
type: Summary
about: "inio-mcp"
---

# Phase 5 Plan 01: HTTP transport with static bearer auth Summary

**`MCP_TRANSPORT=http` serves `/mcp` over Streamable HTTP.**
- Every request needs `Authorization: Bearer <MCP_AUTH_TOKEN>`; a foreign browser Origin gets 403.
- One Inio token serves all requests.
- The server refuses to start in HTTP mode without a strong token.

## Performance

| Metric | Value |
|--------|-------|
| Tasks | 3 of 3 (2 via /tdd, 1 human check) |
| Tests | 1768 unit (from 1707), 47 integration (from 44), package 16 passed / 7 skipped |
| Mutation (`--force`) | config.ts 99.4; server.ts ≥90 (2 survivors killed after round 1); http.ts 93.6 raw (100 excluding 1 equivalent and 2 accepted gaps) |
| Files changed | 9 (+868 / −56) |
| Commits | `57b74a5` (plan), `fc9c2e7` (Task 1), `db0fd5f` (Task 2), `ea0161d` (dev script) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: HTTP config validated | Pass | Exact messages; stdio has no `http` key and skips HTTP validation; whitespace rejection added |
| AC-2: No request reaches MCP without the token | Pass | 401 + `WWW-Authenticate: Bearer`; tools/call body shows no Inio fetch on rejection; the reviewer probed HEAD, OPTIONS, `//mcp`, `/%6Dcp`, absolute-URI and query strings and none got through |
| AC-3: Foreign browser origins refused | Pass | `null` and foreign origins get 403; absent, localhost and allowlisted hostnames pass; no token + foreign Origin gets 401 |
| AC-4: One Inio token shared | Pass | Two servers from one factory make one token fetch, including create_payment/create_customer; writes and redaction behave as on stdio |
| AC-5: Only /mcp served; startup log | Pass | 404 elsewhere; spawned process logs `transport: http`, host and port, and no token |
| Human check (Claude Code) | Pass | Approved 2026-10-30 |

## Accomplishments

- A team can share one instance per tenant. Members hold only the MCP token, and the Inio client secret stays on the server.
- The SDK's `createMcpHandler` keeps 2025-era clients working through its stateless fallback.
- The shutdown path is tested: `close()` ends in-flight requests and keep-alive sockets, and a port in use rejects.

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/http.ts` | Created (71 lines) | Handler with path, bearer and Origin checks; `startHttpServer` with `close()` |
| `src/config.ts` | Modified | `transport: stdio\|http`, `http` block, generic `integer` helper, origin validation |
| `src/server.ts` | Modified | `createServerFactory`; `createServer` wraps it |
| `src/index.ts` | Modified | Branches on `config.http`; HTTP startup log |
| `package.json` / lock | Modified | `@modelcontextprotocol/node`; `dev` script loads `.env` |
| `test/unit/http.test.ts` | Created | Handler, lifecycle and spawned-process tests |
| `test/integration/http.integration.test.ts` | Created | Real HTTP server against Keycloak and the fake API |
| `test/unit/config.test.ts`, `test/unit/server.test.ts` | Modified | HTTP config cases; factory and shared-token cases |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Reject whitespace in MCP_AUTH_TOKEN | A token of 32 spaces, or one with a trailing newline, passed but could never match a header | New error line in config |
| Accept `Bearer` with 1+ spaces (`/^Bearer +(\S+)$/i`) | RFC 7235 allows 1*SP; the old regex failed closed but was brittle | — |
| Origin matched by hostname only (`ponytail:` comment) | Reuses the SDK helper; bearer is the barrier | Any scheme or port on an allowed host passes Origin |
| `HttpConfig` type instead of a runtime `assertHttp` | The guard was unreachable (equivalent mutants) | index.ts passes `{ ...config, http }` |
| `close()` also calls the MCP handler's `close()` | Reviewer: tear down in-flight server instances | Not observable in tests (accepted gap) |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 3 | Whitespace token, multi-space Bearer, stale error listener |
| Scope additions | 1 | `dev` script loads `.env` (one line, found at the checkpoint) |
| Deferred | 3 | Below |

**Total impact:** Small hardening fixes from review; no scope creep.

### Auto-fixed Issues

1. **Config: whitespace-only token accepted.** Found by the reviewer in Task 1. Fixed with a `/\s/` check before the length check, with 3 tests. Commit `fc9c2e7`.
2. **Auth: `Bearer` followed by two spaces rejected.** Found by the reviewer in Task 2. Fixed with a new regex and tests. Commit `db0fd5f`.
3. **Lifecycle: the listen-time `error` listener stayed attached after startup.** Found by the reviewer. Fixed with `server.off('error', …)` after listen. Commit `db0fd5f`.

### Deferred Items

- Dockerfile comment says stdio only; no `EXPOSE`; container needs `HOST=0.0.0.0` (devops reviewer). Goes to 05-02.
- Group `@modelcontextprotocol/node` with `@modelcontextprotocol/server` in Dependabot (devops reviewer). Goes to 05-02.
- Graceful shutdown on SIGTERM, health endpoint and body-size limit: out of scope here; 05-02 decides for Docker.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Stale spawn test expected "http not supported yet" | QA rewrote it to expect the missing-token error at process level |
| HTTP integration test built Config with the realm URL (no token path) | QA appended `/protocol/openid-connect/token` |
| http.ts mutation 69.6, then 77.4 | Body-text, anchored-scheme, port-in-use and in-flight-close tests; unreachable guards removed; 93.6 |
| Checkpoint start failed: `INIO_ALLOW_WRITES must be one of` | The user's shell had `INIO_ALLOW_WRITES=true~` (a typo); the strict check worked as designed. `npm run dev` didn't load `.env`, fixed in `ea0161d` |
| `src/index.ts` excluded from Stryker (`stryker.config.mjs`) | Covered by the spawn tests; unchanged policy |

## Next Phase Readiness

**Ready:**
- HTTP transport is usable from the CLI. 05-02 adds Docker HTTP mode, README client snippets for Claude Code, Desktop, Cursor and VS Code, CHANGELOG and release 0.3.0.

**Concerns:**
- No TLS in-process. The README must tell operators to put a reverse proxy in front of the server.
- `src/http.ts` imports `Logger` from pino while server.ts uses the one from auth.ts. Fold this into the deferred "Move Logger type to src/logger.ts".

**Blockers:** None

---
*Phase: 05-http-hardening, Plan: 01*
*Completed: 2026-10-30*
