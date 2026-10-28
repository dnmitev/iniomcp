---
phase: 02-read-tools
plan: 01
subsystem: api
tags: [mcp-tools, pagination, query-params, compaction, pii-redaction, customers]

requires:
  - phase: 01-foundation
    provides: API client, get_invoice pattern, redaction, tool logging, live suite
provides:
  - client.get(path, { query, headers }) with query strings kept out of logs
  - src/tools/result.ts: errorText, ok, fail, compact, present, PageInput, toPage
  - list_customers (filters, curated sort, paging, summary items)
  - get_customer (by id or number; customer, serviceLine, effectivePause)
  - get_invoice on the shared helpers, empty values dropped
affects: [02-02 invoice/pause/retry tools, 02-03 integration coverage]

tech-stack:
  added: []
  patterns:
    - "Detail tools: ok(present(payload, revealPii)) — compact before redact"
    - "List tools: compact each item in the toPage mapper, redact the page once (present would drop items: [])"
    - "Sort and order validated locally with enums; the API answers bad values with HTTP 500"
    - "Free-text identifiers reject only control characters; encoding is left to URLSearchParams and pathSegment"
    - "Tool titles and input descriptions pinned through listTools in server.test.ts"

key-files:
  created: [src/tools/result.ts, src/tools/list-customers.ts, src/tools/get-customer.ts, test/unit/result.test.ts, test/unit/list-customers.test.ts, test/unit/get-customer.test.ts, .paul/phases/02-read-tools/02-API-NOTES.md]
  modified: [src/inio-client.ts, src/tools/get-invoice.ts, src/server.ts, test/unit/inio-client.test.ts, test/unit/get-invoice.test.ts, test/unit/server.test.ts, test/live/server.live.test.ts, test/integration/server.integration.test.ts]

key-decisions:
  - "list_customers gets sort/order/serviceLineId after reading temporal-monorepo (originally out of scope)"
  - "nextOffset only when the page is non-empty and more remain"
  - "Customer numbers: any characters except control characters, 1-50"

duration: ~3h
started: 2026-10-28T16:45:00Z
completed: 2026-10-28T19:45:00Z
description: "Shared read-tool plumbing (query params, pagination, compaction) plus list_customers and get_customer, verified live"
type: Summary
about: "inio-mcp"
---

# Phase 2 Plan 01: Read-Tool Plumbing and Customer Tools Summary

**The client takes query parameters and extra headers, and logs only the path. Shared helpers in `src/tools/result.ts` handle errors, compaction (before redaction), pagination and list payload validation. `list_customers` and `get_customer` are built on them and verified against the test environment, and `get_invoice` now drops empty values.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~3h |
| Tasks | 2 of 2, each through /tdd (two review/mutation rounds each) |
| Tests | 507 unit (from 316), 10 integration, 5 live |
| Mutation | inio-client 100, result 100, list-customers 100, get-customer 97.9, get-invoice 97.9, server 90.9; whole tree 98.9 |
| Commits | `b398a55` (plan), `95bb187` (task 1), `120a8ed` (task 2) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Query parameters and headers | Pass | Undefined values dropped, empty strings kept; caller cannot override authorization or accept in any case; 401 retry reuses URL and headers; logs carry the path only |
| AC-2: Compact results | Pass | null/undefined/""/[]/{} removed at any depth, false and 0 kept; compact before redact; get_invoice error texts unchanged |
| AC-3: Pagination contract | Pass (tightened) | nextOffset also requires a non-empty page (avoids an endless loop on an empty page) |
| AC-4: list_customers | Pass (amended) | Added serviceLineId, sort enum (customerName, customerNo, createdAt, updatedAt) and order (requires sort, default asc) |
| AC-5: get_customer | Pass | `externalCustomer` renamed to `customer`; bad payload gives `UPSTREAM_ERROR: Unexpected customer payload from the Inio API.` |
| AC-6: Server and live suite | Pass | Three tools listed; live: summary-only items, lookup by id and number, PII keys redacted |

## Verification Results

- `npm run lint && npm run typecheck && npm test && npm run build`: exit 0, 507 tests
- `npm run test:integration`: 10/10 (run alone; it reported all tests skipped while Stryker ran in parallel)
- `INIO_LIVE=1 npm run test:live`: 5/5
- Token cost (live, test environment, 6 customers):

| Call | Bytes | approxTokens |
|------|-------|--------------|
| list_customers (default limit 25, 6 returned) | 1,423 | 356 (~60 per item) |
| list_customers limit 1 | 291 | 73 |
| get_customer | 4,512 | 1,128 (raw result 4,964 bytes) |
| get_invoice (fixture) | 5,161 (was 5,696) | 1,291 (was 1,424) |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Sort/order/serviceLineId added to list_customers | User pointed to temporal-monorepo: sort accepts any Customer column, bad sort or order gives 500 | Curated enum + local validation is the pattern for 02-02 |
| List page not passed through `present` | compact would drop `items: []` on an empty page | Items compacted in the mapper, page redacted once |
| Customer numbers reject only control characters | Values are encoded by URLSearchParams/pathSegment; nothing reaches a header; real numbers may contain æ, +, # | Same rule for future free-text identifiers |
| No shared id/number schema helper | get_invoice number allows 100 characters, get_customer 50 | Revisit if 02-02 adds more by-number tools |

## Deviations from Plan

| Type | Count | Impact |
|------|-------|--------|
| Scope additions | 2 | sort/order/serviceLineId on list_customers; 02-API-NOTES.md for 02-02 |
| Boundary touch | 1 | Integration test EXPECTED now built with `present()` (get_invoice output changed by design); fake API untouched |
| Auto-fixed | 1 | Empty-page nextOffset loop (reviewer) |
| Deferred | 0 | — |

Closed deferred item: "Strip query strings from logged paths" (01-02).

### Accepted equivalent mutants

- `get-invoice.ts:42`, `get-customer.ts:49`: `number ?? ''` is unreachable after the exactly-one refine.
- `server.ts:14`: `'utf8'` in readFileSync; a Buffer parses to the same JSON.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Stryker incremental cache reported stale survivors | Re-ran with `--force`; CI should not persist `reports/stryker-incremental.json` across test changes |
| Integration suite skipped all tests when run alongside Stryker | Re-ran alone: 10/10 |
| QA reported a duplicated Task 2 block in the plan | Checked; the file was fine |

## Next Phase Readiness

**Ready:**
- 02-02 adds invoice, pause and retry tools using result.ts with no new shared code.
- API behavior for those endpoints is in `.paul/phases/02-read-tools/02-API-NOTES.md`.

**Concerns:**
- Suspected API bugs: invoice `status=open` may return 500; retry-attempts `page` has no effect and `totalItems` is the page length. Verify live in 02-02.
- get_customer is ~1,100 tokens, mostly `workflowsSettings`; invoice list items are ~9 KB raw, so invoice summaries matter.
- Out-of-scope survivors: `config.ts:47` flag default, `tool-logging.ts:26` text-type check.

**Blockers:** None

---
*Phase: 02-read-tools, Plan: 01*
*Completed: 2026-10-28*
