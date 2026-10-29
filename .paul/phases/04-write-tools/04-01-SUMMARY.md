---
phase: 04-write-tools
plan: 01
subsystem: api
tags: [write-tools, mcp-annotations, audit, customer-pauses, invoice-dates, field-errors]

requires:
  - phase: 03-packaging-release
    provides: client with timeout/retries, 0.1.2
provides:
  - client post/patch with audit header, write-timeout uncertainty message, fieldErrors
  - write gate (INIO_ALLOW_WRITES) and destructive annotations
  - create/update/cancel_customer_pause, update_invoice_due_date, update_invoice_stop_until_dates
  - npm run smoke:writes (identifiers from the conversation)
affects: [04-02, 04-03 (same plumbing and patterns)]

tech-stack:
  added: []
  patterns:
    - "Write tools get the full client; read tools get Pick<InioClient,'get'>"
    - "Write then read back; a successful write is always reported as updated, even if the read-back fails"
    - "API field errors shown, values of sensitive fields redacted, max 10"
    - "Live write checks take customer/invoice from the caller, never from configuration"

key-files:
  created: [src/tools/create-customer-pause.ts, src/tools/update-customer-pause.ts, src/tools/cancel-customer-pause.ts, src/tools/update-invoice-due-date.ts, src/tools/update-invoice-stop-until-dates.ts, src/tools/invoice-ref.ts, src/tools/pauses.ts, scripts/live-write-smoke.mjs, .paul/phases/04-write-tools/04-API-NOTES.md]
  modified: [src/inio-client.ts, src/tools/result.ts, src/redact.ts, src/server.ts, src/tools/get-invoice.ts, src/tools/get-invoice-retry-attempts.ts, src/tools/get-customer-pause.ts, test/integration/*, README.md, CHANGELOG.md, package.json, .env.example]

key-decisions:
  - "Safety = INIO_ALLOW_WRITES + destructiveHint + echo; no confirm parameter"
  - "x-user-real-name: inio-mcp on every write for audit"
  - "Stop-until bare 404 → FEATURE_DISABLED"
  - "Live write checks via npm run smoke:writes with arguments (user decision)"

duration: ~5h
completed: 2026-10-29
description: "Write plumbing and the first five opt-in write tools (customer pauses, invoice due date and stop-until dates), verified live and in Claude Desktop"
type: Summary
about: "inio-mcp"
---

# Phase 4 Plan 01: Write Plumbing, Pause and Invoice Date Tools Summary

**With `INIO_ALLOW_WRITES=true` the server registers five write tools, annotated as destructive so clients can ask for confirmation:**
- `create_customer_pause`
- `update_customer_pause`
- `cancel_customer_pause`
- `update_invoice_due_date`
- `update_invoice_stop_until_dates`

**Writes are attributed to `inio-mcp` in Inio's audit fields. A write timeout says the change may or may not have been applied. API field errors reach the assistant with personal data redacted. The date tools read the invoice back and always report a successful change as `updated`. Verified live and in Claude Desktop.**

## Performance

| Metric | Value |
|--------|-------|
| Tasks | 3 auto + checkpoint; 2–3 review rounds per task |
| Tests | 1126 unit (from 809), 31 integration (from 21), 13 live read |
| Mutation (`--force`) | 99.4 overall; all new tool files 100; invoice-ref 97.3 (known equivalent) |
| Commits | `d48ee1c` (plan), `1fc58f8` (tasks 1–2), `662292d` (task 3) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Write plumbing | Pass | POST/PATCH share 401/429/timeout handling. The audit header, content type, auth and accept headers cannot be overridden by callers in any letter case. Body and query are never logged. |
| AC-2: Write gate and annotations | Pass | 7 tools when unset or false, 12 when true. Read tools are typed to `get` only. |
| AC-3: Pause tools | Pass | Local date and order checks; API rules spelled out in the descriptions. |
| AC-4: Invoice date tools | Pass (amended) | Returns `{ updated, invoice, … }` plus the read-back, or a read-back note. A bare 404 means FEATURE_DISABLED. |
| AC-5: Integration, live, docs | Pass (amended) | `npm run smoke:writes -- <customerNo> [invoiceNo]` replaces the env-based live suite. README section with an undo column. |
| Checkpoint: Claude Desktop | Pass | Approved by the user. |

## Verification Results

- **Live smoke** (`TESTC1790312809183` / `20260925-07`):
  - Pause create, update, cancel and list all passed.
  - Stop-until was rejected by API rules: the invoice is in debt collection and its earlier steps have passed. This shows the feature is enabled, since the API returned rule errors, not a 404.
- **API date format:** pause dates come back as timestamps (`…T00:00:00.000Z`).

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Annotations and echo, no confirm parameter | User's choice: the clients own the confirmation | README avoids promising confirmation ("can ask") |
| Read back after date writes, never fail after a successful write | A false failure on an irreversible postpone would invite a second postpone | Pattern for 04-02/04-03 |
| Field errors redacted by sensitive key, capped at 10 | API messages may echo rejected values | — |
| Identifiers from the conversation for live checks | User decision | No test data in `.env` |

## Deviations from Plan

| Type | Count | Impact |
|------|-------|--------|
| Spec amendments | 2 | Date tool result shape; live suite replaced by the smoke script |
| Review-driven | 10+ | Reserved headers, field-error redaction, read-back contract, descriptions, FEATURE_DISABLED, cleanup |

## Next Phase Readiness

**Ready:** 04-02 (update customer, reset invoice stage, credit invoices) reuses the client writes, the gate, the read-back helper and field errors.

**Concerns:**
- No public role checks: anything enabled is allowed for the credentials (documented).
- Reset stage and credit invoices can reach end customers (redistribution) and waive fees. 04-02 needs clear descriptions and probably explicit `redistribute` handling.
- To smoke-test stop-until live, an open invoice that has not escalated is needed.

**Blockers:** None

---
*Phase: 04-write-tools, Plan: 01*
*Completed: 2026-10-29*
