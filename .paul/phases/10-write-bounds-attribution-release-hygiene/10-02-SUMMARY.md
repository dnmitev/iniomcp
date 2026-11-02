---
phase: 10-write-bounds-attribution-release-hygiene
plan: 02
subsystem: observability
tags: [logging, attribution, http, audit]

requires:
  - phase: 10-write-bounds-attribution-release-hygiene
    provides: write registration map, INIO_WRITE_TOOLS, INIO_MAX_PAYMENT_AMOUNT (10-01)
provides:
  - Write calls logged with write:true, target identifiers and outcome; client app when known
  - Startup line with registered write tools and payment limit
  - Throttled 401 warnings and MCP transport errors in HTTP mode
  - acceptedUnreadable names what to check (create_customer_pause)
affects: [v0.4 per-user attribution]

key-files:
  modified: [src/tool-logging.ts, src/server.ts, src/config.ts, src/index.ts, src/http.ts, src/tools/result.ts, src/tools/pauses.ts, src/tools/create-customer-pause.ts, src/tools/*.ts (toolLog pass-through), README.md, docs/hosting.md]

key-decisions:
  - "target = only id/number/customerId/customerNo/pauseId/invoiceNo/creditInvoiceNo from args; nothing else logged"
  - "client from server.getClientVersion(): present over stdio; absent over stateless HTTP for 2025-era clients (SDK builds a server per request) — documented, no workaround"
  - "401 warn at most once per 60 s with suppressed count; one counter, no per-IP state"
  - "startupFields(config) in config.ts feeds the 'server started' line"

duration: ~2h
completed: 2026-11-02T20:00:00Z
description: "Write attribution in logs, startup write policy, throttled 401 warnings, transport errors, and accepted-unreadable naming the customer"
type: Summary
about: "inio-mcp"
---

# Phase 10 Plan 02: Write attribution Summary

**Each write call's log line now says `write: true`, which identifiers it changed (`target`) and the outcome, plus the MCP client app where the protocol provides it; startup logs the write policy; HTTP mode logs rejected requests (throttled) and transport errors.**

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Writes attributed | Pass, amended | target from an allowlist (+ creditInvoiceNo); `client` only when the SDK knows it: stdio yes, stateless HTTP no (documented, pinned by a test) |
| AC-2: Startup policy | Pass | `startupFields(config)`: writeTools (registered, ordered; [] when off), maxPaymentAmount when set and writes on |
| AC-3: 401 visible, bounded | Pass | warn with remote address and path, ≤ 1 per 60 s, `suppressed` count on the next line; no header logged; 404s silent |
| AC-4: Transport errors | Pass | createMcpHandler onerror → warn `{ err }`; SDK messages checked: no argument values |
| AC-5: Unreadable names target | Pass | create_customer_pause names `customer <id>` for both a thrown and a resolved-but-unparseable 2xx |
| AC-6: Documented | Pass | README Logs; hosting Security (no per-person attribution, client usually absent over HTTP, proxy address, held-back count) |

## Verification

| Check | Result |
|-------|--------|
| lint, typecheck | Clean |
| `npm test` | 2082 passed (was 2045; +37) |
| `npm run test:integration` | 48 passed |
| Reviewer | 2 major + 6 minor → fixed (1 deferred) → APPROVE |
| Mutation (2 rounds) | tool-logging.ts 100 (was 85.71), create-customer-pause.ts 100, config.ts 99.51, result.ts 99.38, server.ts 97.62, http.ts 94.90 |

Remaining survivors: equivalents (`??` fallbacks that cannot match, `unref`, readFileSync encoding, flag default) and http.ts:130 `closeIdleConnections()` for connections that go idle during the drain (deferred, see below).

## Deviations from Plan

1. **(major, review) Client name over HTTP.** The SDK's per-request stateless server never sees `initialize` for 2025-era clients, so `client` is absent in hosted mode. Docs corrected; an HTTP test pins the behaviour; no workaround (session map or User-Agent) without a new story.
2. **(major, review) AC-5 common path.** `pauseResult` gained a `check` so a resolved-but-unparseable pause also names the customer.
3. **Additions:** `creditInvoiceNo` as a target key; one logger source in http.ts; docs note the proxy address and the held-back count.
4. **Simplification:** `targetOf` lost a redundant non-object guard (args are schema-validated objects), taking tool-logging.ts from 85.71 to 100.
5. **Threaded `toolLog` through 18 tool files** (mechanical). Reviewer suggests a central `registerTool` wrapper instead: deferred.
6. **Deferred items closed:** pause id in accepted-unreadable; redundant `closeIdleConnections()` (first call) removed.

### Deferred Items
- Central `registerTool` wrapper in `createServerFactory` to replace per-file `withToolLogging` and `toolLog` deps (smaller code).
- Test for `closeIdleConnections()` on connections that go idle during the drain (http.ts:130 survivor).

## Next Phase Readiness

**Ready:** 10-03 (release hygiene: SHA-pinned actions, rulesets, image smoke test).

**Concerns:** Per-person attribution needs the v0.4 login; until then logs identify the client app at best.

**Blockers:** None

---
*Phase: 10-write-bounds-attribution-release-hygiene, Plan: 02*
*Completed: 2026-11-02*
