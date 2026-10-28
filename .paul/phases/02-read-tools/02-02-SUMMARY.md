---
phase: 02-read-tools
plan: 02
subsystem: api
tags: [mcp-tools, invoices, retry-attempts, customer-pauses, query-params, upstream-workarounds]

requires:
  - phase: 02-read-tools (02-01)
    provides: client query support, result.ts helpers, customer tools
provides:
  - Repeated query keys (string[] values)
  - list_invoices (filters, curated sort, paging, 11 summary fields)
  - get_invoice withInherited (by id, or by number via a lookup)
  - get_invoice_retry_attempts (limit only)
  - list_customer_pauses, get_customer_pause
  - presentRaw helper; all seven tools' metadata pinned
affects: [02-03 integration coverage and Desktop check, phase 3 release]

tech-stack:
  added: []
  patterns:
    - "Upstream bug workarounds live next to the call with a comment naming the upstream code"
    - "Ids taken from upstream responses are validated (UUID) before they go into a path"
    - "Wrappers with lists (pages, pauses, attempts): compact the parts, presentRaw the wrapper"

key-files:
  created: [src/tools/list-invoices.ts, src/tools/get-invoice-retry-attempts.ts, src/tools/list-customer-pauses.ts, src/tools/get-customer-pause.ts, test/unit/list-invoices.test.ts, test/unit/get-invoice-retry-attempts.test.ts, test/unit/list-customer-pauses.test.ts, test/unit/get-customer-pause.test.ts]
  modified: [src/inio-client.ts, src/tools/get-invoice.ts, src/tools/result.ts, src/tools/list-customers.ts, src/server.ts, test/unit/inio-client.test.ts, test/unit/get-invoice.test.ts, test/unit/server.test.ts, test/live/server.live.test.ts, .claude/agents/senior-qa-automation.md, .claude/agents/mutation-tester.md]

key-decisions:
  - "Single invoice status sent twice (API 500s on single or comma-separated status)"
  - "Invoice customer scoping via customerId/customerNo query filters, not the x-customer-* headers"
  - "Retry attempts expose limit only; totalItems dropped, successfullAtemptsCount renamed"
  - "QA and mutation-tester agents run on Sonnet; developer and reviewer stay on Opus"

duration: ~2h
started: 2026-10-28T20:30:00Z
completed: 2026-10-28T22:30:00Z
description: "Remaining read tools: list_invoices, get_invoice withInherited, retry attempts and customer pauses, with workarounds for two upstream API bugs, verified live"
type: Summary
about: "inio-mcp"
---

# Phase 2 Plan 02: Invoice, Retry-Attempt and Pause Tools Summary

**The server now has seven read tools. `list_invoices` works around the API's HTTP 500 on single status values by sending repeated keys. `get_invoice` can include inherited values, also by invoice number. Retry attempts expose only `limit`, because the API ignores `page`. The two pause tools drop internal workflow ids. Everything is verified against the test environment.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~2h |
| Tasks | 3 of 3 through /tdd; tasks 2 and 3 took a second review round |
| Tests | 704 unit (from 507), 10 integration, 11 live |
| Mutation (`--force`) | list-invoices, list-customer-pauses, get-customer-pause, result, inio-client 100; get-invoice 98.5; retry-attempts 98.2; server 93.3; whole tree 99.1 |
| Commits | `8d108ac` (plan, QA on Sonnet), `4f15146` (mutation-tester on Sonnet), `65e0266`, `a213c04`, `eed018f` |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Repeated query values | Pass | Each element appended in order; empty arrays and undefined skipped; logs unchanged |
| AC-2: list_invoices | Pass | Filters, refines, 11 summary fields; single status duplicated; live `status: ['open']` returns 200 |
| AC-3: get_invoice withInherited | Pass (tightened) | Upstream id must be a UUID (reviewer); path-encoded |
| AC-4: get_invoice_retry_attempts | Pass | limit 1-50 only; `attempts: []` kept; field renamed |
| AC-5: Customer pause tools | Pass (amended) | Descriptions gained the redaction sentence (reviewer) |
| AC-6: Server, metadata, live | Pass (amended) | Live uses closed and open invoices instead of "limit 2, status open" only |

## Verification Results

- `npm run lint && npm run typecheck && npm test && npm run build`: exit 0, 704 tests
- `npm run test:integration` (alone): 10/10
- `INIO_LIVE=1 npm run test:live`: 11/11
- Live API probes before planning: status 500 confirmed, repeated keys work, `sort=updatedAt` and single `paymentStatus` work
- Token cost (live):

| Call | Bytes | approxTokens |
|------|-------|--------------|
| list_invoices (25 items) | 7,218 | 1,805 (~72 per item; raw ~9 KB per item) |
| get_invoice | 8,183 | 2,046 |
| get_invoice withInherited (by number, 2 calls) | 9,003 | 2,251 |
| get_invoice_retry_attempts (ineligible) | 94 | 24 |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Duplicate a single status value | API's `parseCommaSeparated` rejects real status values; repeated keys reach the IN filter | Remove when the upstream bug is fixed |
| Query filters for customer scoping | `customerId`/`customerNo` work as columns; avoids a header path for user input | No headers sent by any tool |
| No `stage` filter | Values undocumented | Add when needed |
| Pause tools take customerId only | get_customer returns it | customerNo lookup can be added later |
| presentRaw helper | Fourth copy of "redact wrapper unless revealPii" | present/presentPage built on it, outputs unchanged |
| Sonnet for QA and mutation-tester | Token cost; reviewer and mutation gate catch weak tests | Quality held: same review/mutation results as 02-01 |

## Deviations from Plan

| Type | Count | Impact |
|------|-------|--------|
| Scope additions | 2 | Agent model changes; get_invoice number control-character rule |
| Spec tightening | 2 | UUID check on upstream id; redaction sentence in pause descriptions |
| Deferred | 0 | — |

### Accepted equivalent mutants

- `number ?? ''` in get-invoice, get-customer, get-invoice-retry-attempts (unreachable after the exactly-one refine)
- `'utf8'` in server.ts readFileSync

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| QA could not pin `withInherited` without changing one existing schema-keys test | Accepted: the key list must change by design |

## Next Phase Readiness

**Ready:**
- Every read endpoint in PLANNING.md has a tool. 02-03 adds 429 handling, fake-API routes and fixtures for the new tools, and the Claude Desktop check.

**Concerns:**
- Detail tools are large: get_invoice ~2,050 tokens, get_customer ~1,130, mostly `workflowsSettings`. Trimming beyond compaction needs a decision.
- No test invoice has retry attempts; the attempt shape is only checked against the spec.
- Pre-existing survivors: `config.ts:47` flag default, `tool-logging.ts:26`.

**Blockers:** None

---
*Phase: 02-read-tools, Plan: 02*
*Completed: 2026-10-28*
