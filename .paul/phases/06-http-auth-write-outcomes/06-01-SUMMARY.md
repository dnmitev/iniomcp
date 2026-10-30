---
phase: 06-http-auth-write-outcomes
plan: 01
subsystem: api
tags: [http, auth, mcp, node-http, dos, shutdown]

requires:
  - phase: 05-http-hardening
    provides: static bearer auth, Origin allowlist, graceful shutdown, toNodeHandler bridge
provides:
  - Path and bearer gate on the Node IncomingMessage before any body byte is buffered
  - 256 KiB request body cap (413)
  - Startup warning for non-loopback HTTP hosts
  - Drain-then-force shutdown with a 500 ms grace period
affects: [07-docs-install-trust, R8 write attribution, R9 per-request identity]

tech-stack:
  added: []
  patterns:
    - "One reject(path, authorization) helper shared by the Node callback and the web handle"
    - "URL.parse (not new URL) for raw request targets in synchronous Node callbacks"

key-files:
  created: []
  modified: [src/http.ts, src/index.ts, src/config.ts, test/unit/http.test.ts, test/unit/config.test.ts]

key-decisions:
  - "Auth before body; 256 KiB body cap (supersedes 05-02 'SDK 413 at 4 MB')"
  - "DRAIN_GRACE_MS = 500 (plan said ~1 s)"
  - "No req.destroy(); Connection: close is enough"

patterns-established:
  - "Rejections in the Node callback never touch req; respond with Connection: close"

duration: ~1h45m
started: 2026-10-30T11:05:00Z
completed: 2026-10-30T12:50:00Z
description: "HTTP mode answers 404/401 before reading the body, caps bodies at 256 KiB, warns on non-loopback bind and drains on shutdown; F-04-007 memory growth no longer scales with upload size"
type: Summary
about: "inio-mcp"
---

# Phase 6 Plan 01: Authenticate before reading the body — Summary

**HTTP mode answers 404/401 before reading the body, caps authenticated bodies at 256 KiB, warns on non-loopback bind and drains on shutdown. Memory under unauthenticated uploads no longer grows with upload size (F-04-007).**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~1h45m |
| Tasks | 3 of 3 completed |
| TDD rounds | QA red, dev green, 2 review rounds, 3 mutation rounds |
| Files modified | 5 (src 3, test 2; +407 / −18) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Unauthenticated requests rejected before the body is read | Pass | 401 + `WWW-Authenticate: Bearer`, `Content-Type: text/plain`, `Connection: close` arrive while a 1 MiB upload is still open; socket closes. Constant-time digest compare unchanged. |
| AC-2: Wrong paths rejected before the body is read | Pass | 404 while the upload is open; also for malformed targets (`http://[/mcp`, `http://h:99999/mcp`), and the server keeps answering. |
| AC-3: Authenticated bodies capped | Pass | 300 KiB → 413, handler not called; initialize + tools/call round trip still works. |
| AC-4: Non-loopback bind visible at startup | Pass | One warn line with `"host":"0.0.0.0"` and "the bearer token is the only barrier"; none for 127.0.0.1, localhost or stdio. |
| AC-5: Shutdown drains before forcing | Pass (with note) | `close()` lets a request whose upstream answers in 200 ms finish with 200; idle keep-alive sockets close in < 250 ms; a hung request is cut at 500 ms. The spawned SIGTERM test still accepts finished-or-closed (it pins exit 0, not drain). |
| AC-6: Existing behaviour unchanged | Pass | Unit 1813, integration 47, Docker package 27 all green. |

## Verification Results

| Check | Result |
|-------|--------|
| `npm run lint` | oxlint clean, Prettier clean |
| `npm run typecheck` | clean |
| `npm test` | 27 files, 1813 tests passed (+25) |
| `npm run test:integration` | 2 files, 47 tests passed |
| `npm run test:package` (image built locally) | 2 files, 27 tests passed |
| Stryker `src/http.ts` | 91.67 (95.65 excl. agreed equivalents) |
| Stryker `src/config.ts` | 99.44 (100 excl. equivalent) |
| Reviewer | APPROVE (round 2) |

**F-04-007 probe** (50 concurrent unauthenticated POSTs to `/mcp`, dummy credentials, no Inio calls, RSS of the server process):

| Build | Body size | RSS idle → peak | Delta | Responses |
|-------|-----------|-----------------|-------|-----------|
| Before (736b6a0, 0.3.1) | 4 MiB | 94.7 → 393.3 MB | +298.5 MB | 50 × 401 |
| After | 1 MiB | 95.4 → 128.0 MB | +32.6 MB | 401 or reset |
| After | 4 MiB (3 runs) | ~94 → 119-134 MB | +24.6 to +39.1 MB | 401 or reset |
| After | 16 MiB | 94.4 → 144.1 MB | +49.7 MB | 401 or reset |
| After | 64 MiB | 94.8 → 120.2 MB | +25.4 MB | 401 or reset |

The delta no longer scales with body size, so the body is not read. What remains is per-connection overhead and noise.

## Accomplishments

- An unauthenticated client can no longer make the server buffer request bodies. F-04-007 is closed, and the D-007 "auth before body" control is now true in code.
- A malformed request target can no longer crash the process. The reviewer found this regression during the loop; it never shipped.
- Shutdown now drains: it closes idle connections at once, gives in-flight requests 500 ms, then forces the rest. Errors from closing the MCP handler reach the caller, which logs `shutdown failed` and exits 1.

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/http.ts` | Modified | `reject()` gate in the Node callback and `handle`; `MAX_REQUEST_BODY_BYTES` 256 KiB; async drain-then-force `close()` with `DRAIN_GRACE_MS` 500 |
| `src/index.ts` | Modified | Non-loopback warn after HTTP start |
| `src/config.ts` | Modified | Exported `isLoopbackHost`; `::1` added to the loopback set |
| `test/unit/http.test.ts` | Modified | Open-upload 401/404, malformed targets, 413, warn lines, drain and shutdown timing |
| `test/unit/config.test.ts` | Modified | `isLoopbackHost` cases |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Auth and path checked on the Node request before `toNodeHandler`; body cap 256 KiB | F-04-007; MCP JSON-RPC requests are a few KiB | Supersedes 05-02 "body limit = SDK 413 at 4 MB". Raise the cap if a tool ever takes large input (`ponytail:` note in code). |
| `DRAIN_GRACE_MS = 500` | An existing test needs `close()` under 1000 ms with a hung request; 1 s measured 1002 ms | Hard exit in `index.ts` stays at 2 s |
| `req.destroy()` dropped | `Connection: close` already closes the socket (tests prove it); plan said do not touch `req` | Clients still uploading after the 401 often see a TCP reset instead of the 401. Acceptable: not reading the body is the point. |
| `URL.parse` on the Node path, `new URL` on the web path | Raw targets can be malformed; a web `Request` URL is always valid | Removes unkillable fallback branches |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 3 | Essential (1 blocker, 1 major from review, 1 lint) |
| Spec deviations | 3 | Grace 500 ms, no `req.destroy()`, RSS target |
| Deferred | 1 | Spawned drain test stays weak |

**Total impact:** Essential fixes, no scope creep.

### Auto-fixed Issues

**1. Security: process crash on a malformed request target (reviewer blocker)**
- **Found during:** Task 3 (review round 1)
- **Issue:** `new URL(req.url)` ran synchronously in the `createServer` callback, outside the SDK adapter's try/catch. `GET http://[/mcp` threw `ERR_INVALID_URL` and killed the process. This was a regression introduced by the gate.
- **Fix:** `URL.parse(...)?.pathname ?? ''`, so the request gets a 404.
- **Verification:** Raw-socket tests for both targets; the server answers afterwards.

**2. Reliability: unhandled rejection from `mcp.close()` on shutdown (reviewer major)**
- **Fix:** `close()` awaits `Promise.all([serverClosed, mcpClose])`; the cut timer is cleared in `finally`.

**3. Lint errors in the new tests (conditional expects, type assertion)**
- **Fix:** Unconditional assertions; address narrowing as used elsewhere in the file.

### Spec deviations

- **AC-5 / Task 2: grace period.** 500 ms instead of about 1 s (see Decisions).
- **Task 1: rejection handling.** `req.destroy()` was dropped (see Decisions).
- **Task 3: RSS target.** The plan said "within about 20 MB of idle". Measured +25 to +50 MB, flat from 1 to 64 MiB bodies, against +298 MB before. The property that matters, not buffering the body, holds.

### Deferred Items

- The spawned SIGTERM drain test accepts finished-or-closed. Drain is proven through a direct `close()` test instead. Revisit if the shutdown logic changes; this joins the existing "race-prone shutdown tests" deferred item.

### Accepted equivalent mutants

`reject`'s `authorization ?? ''` sentinel; the Node-path `req.url ?? '/'` and `?.pathname ?? ''` sentinels; both `closeIdleConnections()` calls (Node's `server.close()` already closes idle connections); `cut.unref()` (always cleared); the config `flag` default `'false'`. `src/index.ts` is excluded from Stryker and covered only by spawned-process tests.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| AC-5 could not go red (the old `closeAllConnections()` already exits fast) | Added a direct `close()` drain test (200 ms upstream) that would fail without the grace period |
| Stryker ignores `MUTATE` and mutates all of `src/` | Read only the changed files' rows |

## Next Phase Readiness

**Ready:**
- HTTP transport hardened. Plan 06-02 (R5, uncertain write outcomes in `src/inio-client.ts`) does not touch these files.

**Concerns:**
- Docker logs the non-loopback warning on every start by design (it binds 0.0.0.0). Phase 7 docs should say so.
- Phase 7 docs should mention the 256 KiB cap and the 401-before-body behaviour.

**Blockers:**
- None

---
*Phase: 06-http-auth-write-outcomes, Plan: 01*
*Completed: 2026-10-30*
