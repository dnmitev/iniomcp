---
phase: 02-read-tools
plan: 03
subsystem: api
tags: [rate-limiting, retry-after, token-budget, integration-tests, claude-desktop]

requires:
  - phase: 02-read-tools (02-02)
    provides: all seven read tools
provides:
  - 429 handling (one retry honoring Retry-After, capped at 5 s, then RATE_LIMITED)
  - includeWorkflowSettings on get_invoice and get_customer (default off)
  - Integration coverage for every read tool and both 429 paths
  - README Tools section
affects: [phase 3 packaging and release]

tech-stack:
  added: []
  patterns:
    - "Time is injected (sleep, now) so retry waits are tested without real delays"
    - "A 429 retry reuses the call's token; only 401 invalidates"
    - "Large optional sections are opt-in flags whose description says when to use them"
    - "Fake API is strict about id vs number paths so wrong paths fail"

key-files:
  created: [test/integration/fixtures/customer.json, test/integration/fixtures/service-line.json, test/integration/fixtures/pauses.json, test/integration/fixtures/retry-attempts.json]
  modified: [src/inio-client.ts, src/tools/get-invoice.ts, src/tools/get-customer.ts, test/unit/inio-client.test.ts, test/unit/get-invoice.test.ts, test/unit/get-customer.test.ts, test/unit/server.test.ts, test/live/server.live.test.ts, test/integration/fake-inio-api.ts, test/integration/server.integration.test.ts, README.md]

key-decisions:
  - "workflowsSettings opt-in (user's middle ground): dropped by default, includeWorkflowSettings for stage distribution, fees and timing"
  - "Retry-After 0 waits 0 ms; missing or invalid waits 1 s"
  - "Final 429 logs only the upstream error line (no wait happens)"

duration: ~2h
started: 2026-10-28T23:00:00Z
completed: 2026-10-29T01:00:00Z
description: "429 retry with Retry-After, opt-in workflowsSettings (customer detail ~70% smaller), integration coverage for all seven tools, verified in Claude Desktop"
type: Summary
about: "inio-mcp"
---

# Phase 2 Plan 03: Rate Limits, Opt-in Settings, Integration Coverage Summary

**A 429 from the Inio API now waits for Retry-After (capped at 5 s) and retries once. A second 429 becomes `RATE_LIMITED` with the API's retry hint. `get_invoice` and `get_customer` leave out `workflowsSettings` unless the question is about stage distribution, fees or timing. The integration suite covers all seven tools against the built server. Claude Desktop answered invoice, customer, pause, retry-attempt and distribution questions with the right tools.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~2h |
| Tasks | 3 auto (tasks 1-2 through one /tdd loop, task 3 QA-led) + 1 checkpoint |
| Tests | 749 unit (from 704), 20 integration (from 10), 13 live (from 11) |
| Mutation (`--force`) | inio-client 100, get-customer 98.2, get-invoice 98.4; whole tree 99.1 |
| Commits | `bc4da90` (plan), `571b0ae` (tasks 1-2), `7549e12` (task 3) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: 429 handling | Pass (refined) | Retry-After 0 waits 0 ms; the final 429 logs only the `upstream error` line; the 429 retry reuses the token |
| AC-2: Opt-in workflowsSettings | Pass (widened) | The live suite found workflowsSettings on `serviceLine` too; the flag now covers customer and service line |
| AC-3: Integration coverage | Pass | 10 new tests; strict id/number routes; RATE-ONCE resettable; raw PII values asserted absent |
| AC-4: Claude Desktop | Pass | Approved by the user; tool-call log lines confirmed |

## Verification Results

- `npm run lint && npm run typecheck && npm test && npm run build`: exit 0, 749 tests
- `npm run test:integration` (alone): 20/20
- `INIO_LIVE=1 npm run test:live`: 13/13
- Token cost (live, approxTokens):

| Call | Default | includeWorkflowSettings |
|------|---------|-------------------------|
| get_customer | 333 | 1,128 |
| get_invoice | 1,708 | 2,046 |

get_customer is ~70% smaller by default. get_invoice is ~17% smaller: most of what remains is histories, invoiceItems and per-currency amounts.

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| workflowsSettings opt-in, not dropped | User: stage settings (distribution per invoicing1-4) answer real questions | The flag description steers the model; verified in Desktop |
| Token reused on 429 retry | The cache already expires tokens 60 s early; the wait is ≤5 s | One token request per call unless a 401 |
| `now` injected next to `sleep` | HTTP-date Retry-After needs a testable clock | No fake timers in production code |

## Deviations from Plan

| Type | Count | Impact |
|------|-------|--------|
| Spec widening | 1 | serviceLine.workflowsSettings also stripped (caught by the live suite) |
| Refinements from review | 4 | Final-429 logging; fresh-token assertion; null-body 429 tests; stricter fake API |
| Shortfall | 1 | get_invoice saving 17%, not ~50% as the plan expected |

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Live suite: get_customer still showed workflowsSettings by default | Found it on serviceLine; spec widened, unit tests first, then fix |
| Integration expectations went stale after the default change | QA rebuilt the expected text; integration was not run between tasks 2 and 3 |
| `{ metadata: undefined }` in Claude Desktop logs | Desktop's own message logging, not the server |

## Next Phase Readiness

**Ready:**
- Phase 2 goal met. Phase 3 can package what exists: seven read tools, a stable error format, rate-limit handling.

**Concerns:**
- get_invoice is ~1,700 tokens by default; histories and invoiceItems could become opt-in like workflowsSettings if real usage shows they're rarely needed.
- Upstream workarounds (status duplication, retry-attempts limit only) should be reported to the API team.
- Pre-existing survivors: `config.ts:47`, `tool-logging.ts:26`.

**Blockers:** None

---
*Phase: 02-read-tools, Plan: 03*
*Completed: 2026-10-29*
