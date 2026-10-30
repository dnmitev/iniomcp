---
phase: 06-http-auth-write-outcomes
plan: 02
subsystem: api
tags: [write-tools, error-handling, idempotency, mcp]

requires:
  - phase: 04-write-tools
    provides: 11 opt-in write tools, uncertainOutcome for status 0, isUnreadableSuccess
provides:
  - Check-before-retry hint on every non-GET 5xx, from the client
  - acceptedUnreadable() and writeFailure() in src/tools/result.ts, used by all 11 write tools
affects: [07-docs-install-trust, R8 write attribution]

tech-stack:
  added: []
  patterns:
    - "Write tools catch through writeFailure(err); failed shape checks after a resolved write return acceptedUnreadable()"
    - "Tool-specific hints add only a check pointer; the client owns the 'may or may not' sentence"

key-files:
  created: []
  modified: [src/inio-client.ts, src/tools/result.ts, src/tools/pauses.ts, src/tools/cancel-customer-pause.ts, src/tools/create-customer-pause.ts, src/tools/update-customer-pause.ts, src/tools/update-invoice-due-date.ts, src/tools/update-invoice-stop-until-dates.ts, src/tools/update-customer.ts, src/tools/match-credit-invoice.ts, src/tools/reset-invoice-stage.ts, src/tools/create-payment.ts, src/tools/create-customer.ts, src/tools/create-credit-invoice.ts, .oxlintrc.json]

key-decisions:
  - "Status 0 or >= 500 on a write = uncertain, hint from the client (extends the Phase 4 decision to all tools)"
  - "pauseResult(payload, revealPii, afterWrite=false): write callers get the note, get_customer_pause keeps its error"

patterns-established:
  - "Accepted write with an unreadable answer is never a failure in any write tool"

duration: ~1h15m
completed: 2026-10-30T11:45:00Z
description: "All 11 write tools report accepted-but-unreadable writes as success plus a check-first note, and every write 5xx carries the check-before-retry hint from the client"
type: Summary
about: "inio-mcp"
---

# Phase 6 Plan 02: Write-outcome uncertainty in the client — Summary

**All 11 write tools report accepted-but-unreadable writes as success plus a check-first note, and every write that fails with status 0 or 5xx tells the model to check before retrying (F-04-002, absorbs F-00-003).**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~1h15m |
| Tasks | 3 of 3 completed |
| TDD rounds | QA red, dev green, QA stale-test and lint fix, review (2 majors), QA red plus dev fix, re-review, 2 mutation rounds |
| Files modified | 33 in the working tree, including 06-01 (06-02 alone: 14 src files, about 14 test files, .oxlintrc.json) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: 5xx on a write carries the hint | Pass | POST and PATCH 500/502/503, with and without an envelope; code, correlationId and fieldErrors kept. GET 5xx and 4xx writes carry no hint. A missing period is added before the hint. |
| AC-2: Timeouts and network errors unchanged | Pass | The sentence appears exactly once. |
| AC-3: Accepted write with an unreadable answer is success plus a note, in every write tool | Pass | All 11 tools are covered by client-throws-2xx tests, plus bad-shape tests where the tool has a shape check. The create_credit_invoice and create_customer notes now say "Do not retry" plus how to check (reviewer major). |
| AC-4: Tool-specific guidance kept, no duplicated sentence | Pass | create_payment and create_customer: "may or may not" appears once, followed by the get_invoice / get_customer pointer. |
| AC-5: Existing behaviour unchanged elsewhere | Pass | Unit 1875, integration 47. 409, FEATURE_DISABLED, 429 and the read tools are unchanged. The get_customer_pause bad payload is still an error. |

## Verification Results

| Check | Result |
|-------|--------|
| `npm run lint` | clean (oxlint plus Prettier) |
| `npm run typecheck` | clean |
| `npm test` | 27 files, 1875 passed (+62 over 06-01) |
| `npm run test:integration` | 2 files, 47 passed |
| Stryker (round 2) | inio-client 100, create-credit-invoice 100, create-payment 100, pauses and every pause/due-date/stop-until/update-customer/match tool 100, reset-invoice-stage 98.46, result 99.37, create-customer 97.62 |
| Reviewer | APPROVE (round 2) |

## Accomplishments

- No write tool can report a landed payment, credit, stage reset, pause or customer change as "failed" any more. This removes the main reason a model would retry, which could duplicate money movements or end-customer distributions.
- The check-before-retry rule lives in one place (the client) with one tool-side helper, so new write tools get it by using `writeFailure`.
- reset_invoice_stage separates its by-number lookup from the write, so an unreadable lookup can never be mistaken for an accepted reset.

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/inio-client.ts` | Modified | 5xx on non-GET: hint appended, with a missing period added first |
| `src/tools/result.ts` | Modified | `acceptedUnreadable()`, `writeFailure(err)` |
| `src/tools/pauses.ts` | Modified | `pauseResult(..., afterWrite)` |
| 7 write tools (3 pause tools, due-date, stop-until-dates, update-customer, match-credit-invoice) | Modified | Catch through `writeFailure` |
| `update-customer.ts`, `match-credit-invoice.ts`, `reset-invoice-stage.ts` | Modified | Shape-check failure becomes `acceptedUnreadable()`; reset's lookup gets its own try/catch |
| `create-payment.ts`, `create-customer.ts`, `create-credit-invoice.ts` | Modified | Hints reduced to a check pointer; unreadable notes say "Do not retry" plus how to check |
| `test/unit/helpers/write-tool.ts` | Created | `expectAcceptedNote` |
| `test/unit/*` (about 14 files) | Modified | AC-1..AC-5 tests; stale "fail on bad pause payload" tests converted |
| `.oxlintrc.json` | Modified | `vitest/expect-expect` accepts `expectAcceptedNote` |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| The client owns the uncertain-outcome sentence for status 0 and ≥ 500 | One rule for 11 tools; tools add only a check pointer | New write tools inherit it |
| `afterWrite` boolean on `pauseResult` | Smallest change: 3 write callers and 1 read caller (the reviewer agreed) | get_customer_pause keeps its error |
| Lint config change instead of per-test asserts | Standard `assertFunctionNames` option for a shared assertion helper | Root `.oxlintrc.json` touched (outside test/, accepted by the lead) |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 4 | Reviewer majors (2) and minors (2), all within scope |
| Scope additions | 1 | `.oxlintrc.json` rule option |
| Deferred | 2 | Minor wording items |

**Total impact:** Essential fixes, no scope creep.

### Auto-fixed Issues

1. **AC-3 gap: the create_credit_invoice note had no check pointer (reviewer major).** It now says "Do not retry; check the invoice first."
2. **AC-3 gap: the create_customer note had no check pointer (reviewer major).** It now says "Do not retry; call get_customer by number first."
3. **Wording: the 5xx message ran into the hint without a period.** Fixed with `message.replace(/\.?$/, '.')`.
4. **A test assertion was lost:** match_credit_invoice's "no read-back on unreadable answer" assertion was restored.

### Deferred Items

- **5xx punctuation edge cases.** API messages ending in "!" or "?", with trailing whitespace, or empty get slightly odd punctuation before the hint. Cosmetic.
- **`acceptedUnreadable()` echoes no identifier.** For create_customer_pause, the model gets no pause id to check with. The plan made this optional; revisit with R8 (write attribution).

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Three cancel-customer-pause tests contradicted AC-3 (they expected a failure on bad payload after a write) | QA converted them to `expectAcceptedNote` |
| The new helper-only tests tripped `vitest/expect-expect` | `assertFunctionNames` option |

## Next Phase Readiness

**Ready:**
- PROJECT.md line 50 ("accepted writes never reported as failed; uncertain outcomes tell the model to check before retrying") is now true for all 11 write tools.
- Phase 7 (R1 and R7 docs) can describe the post-Phase 6 behaviour.

**Concerns:**
- None blocking.

**Blockers:**
- None

---
*Phase: 06-http-auth-write-outcomes, Plan: 02*
*Completed: 2026-10-30*
