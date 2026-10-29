---
phase: 04-write-tools
plan: 02
subsystem: api
tags: [write-tools, customers, reset-stage, credit-invoices, mutation-testing]

requires:
  - phase: 04-write-tools
    provides: 04-01 write plumbing (audit header, write gate, annotations, readBackInvoice, smoke:writes)
provides:
  - update_customer (contact details and addresses only)
  - reset_invoice_stage (redistribute always sent, default false)
  - create_credit_invoice (distributionEnabled default false; never fails after the POST succeeds)
  - match_credit_invoice (with remainingAmount/paymentStatus read-back)
  - customer-ref.ts, lookUpInvoiceId, CreditFields, pastPaidDateRule
  - smoke:writes renames and restores the test customer
affects: [04-03 (create invoices/customers, payments)]

tech-stack:
  added: []
  patterns:
    - "Once a write's POST resolves, the tool never returns an error; an unreadable 2xx body gives success plus a note"
    - "Field limits come from openapi/inio.json inner schemas (envelopes stay untrusted)"
    - "Date rules that depend on today take an injected now (default Date.now); today = UTC date"
    - "Property descriptions are tested (non-empty, safety key phrases) so describe() mutants die"

key-files:
  created:
    - src/tools/update-customer.ts
    - src/tools/reset-invoice-stage.ts
    - src/tools/create-credit-invoice.ts
    - src/tools/match-credit-invoice.ts
    - src/tools/customer-ref.ts
  modified:
    - src/tools/invoice-ref.ts
    - src/tools/result.ts
    - src/server.ts
    - scripts/live-write-smoke.mjs
    - README.md
    - CHANGELOG.md

key-decisions:
  - "AC-3 amended: create_credit_invoice returns { created, id, invoiceNo, paymentReference, items } (spec 201 has no totals/status)"
  - "match_credit_invoice: API result is a plain id string"
  - "senior-developer agent on Sonnet, medium effort"

duration: ~1 session
completed: 2026-10-29
description: "Four opt-in write tools (update_customer, reset_invoice_stage, create_credit_invoice, match_credit_invoice) with safe defaults; 16 tools with writes on"
type: Summary
about: "inio-mcp"
---

# Phase 4 Plan 02: Customer, reset-stage and credit write tools Summary

**Four more opt-in write tools: `update_customer`, `reset_invoice_stage`, `create_credit_invoice` and `match_credit_invoice`. Nothing reaches the end customer unless the model asks (`redistribute`, `distributionEnabled` default false). The server lists 16 tools with `INIO_ALLOW_WRITES=true`.**

## Performance

| Metric | Value |
|--------|-------|
| Completed | 2026-10-29 |
| Tasks | 3 auto + 1 human-verify checkpoint, all completed |
| Files changed | 19 tracked (+503 / −86) plus 9 new |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: update_customer | Pass | Strict schema (SSN, orgNr, vatNo, customerType, workflowsSettings, metadata rejected). Nulls kept. Duplicate emails rejected case-insensitively. Result has no workflowsSettings and is redacted |
| AC-2: reset_invoice_stage | Pass | By number: lookup GET, then POST by id. A failed lookup aborts before the POST. redistribute is always sent. workflowId is dropped from the plan |
| AC-3: create_credit_invoice | Pass (amended) | Result shape changed to match the spec (see Deviations). Body defaults: isReverseTaxation false, distributionEnabled false, distributionMethod '' |
| AC-4: match_credit_invoice | Pass | Read-back of remainingAmount (number or string) and paymentStatus. A failed read-back becomes a note |
| AC-5: Gate, integration, smoke, docs | Pass | 16 tools with writes on, 7 without. "Cannot be undone" wording on reset/credit/match. 9 new integration tests. Smoke renames and restores the customer. README table and CHANGELOG updated |

## Verification Results

- `npm run lint`: clean. `npm run typecheck`: clean.
- `npm test`: 24 files, 1423 tests passed.
- `npm run test:integration`: 40 passed.
- `npm run smoke:writes -- TESTC1790312809183 20260925-07`: all checks passed. update_customer and its restore were ok. The stop-until step was skipped by design: the invoice's escalations have passed.
- Mutation (Stryker --force):

  | File | Score |
  |---|---|
  | update-customer.ts | 98.81 |
  | reset-invoice-stage.ts | 98.41 |
  | customer-ref.ts | 94.44 |
  | create-credit-invoice.ts | 100 (round 2; was 84.85) |
  | match-credit-invoice.ts | 100 |
  | invoice-ref.ts | 97.62 |
  | result.ts | 100 |

- Reviewer: Task 1 APPROVE. Task 2 APPROVE after one round with 2 blockers and 3 minors, all fixed.
- Claude Desktop checkpoint: approved by the user.

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/tools/update-customer.ts` | Created (128) | PATCH a customer's contact details and addresses |
| `src/tools/reset-invoice-stage.ts` | Created (92) | Reset an invoice to invoiced/reminded; returns the API's plan |
| `src/tools/create-credit-invoice.ts` | Created (117) | Credit items of an invoice |
| `src/tools/match-credit-invoice.ts` | Created (83) | Match a credit invoice against a debit invoice, then read it back |
| `src/tools/customer-ref.ts` | Created (21) | Shared customer id/number ref and path |
| `src/tools/invoice-ref.ts` | Modified | lookUpInvoiceId, CreditFields, pastPaidDateRule |
| `src/tools/result.ts` | Modified | exactlyOneRef / EXACTLY_ONE_REF moved here |
| `src/tools/get-invoice.ts`, `get-customer.ts`, 04-01 tools | Modified | Use the shared helpers; behaviour unchanged |
| `src/server.ts` | Modified | Registers the four tools inside the allowWrites block |
| `test/unit/*` | 4 created, server.test.ts modified | Unit tests per tool, gate and annotation tests |
| `test/integration/fake-inio-api.ts`, `server.integration.test.ts` | Modified | Routes and tests for the four tools |
| `scripts/live-write-smoke.mjs` | Modified | Reversible update_customer step, restored in finally |
| `README.md`, `CHANGELOG.md` | Modified | Write-tools table rows, Unreleased entry |

## Deviations from Plan

| Type | Count | Impact |
|------|-------|--------|
| Spec fixes | 2 | Essential: wrong response shapes in AC-3 and in an assumption about match |
| Scope additions | 2 | Small: spec field limits; describe-text tests |
| Deferred | 0 | — |

1. **AC-3 result shape (spec issue, blocker found by the reviewer).**
   - The plan expected totalAmount, currency, status and invoiceItems. The spec 201 returns `{ id, invoiceNo, paymentReference, creditInvoiceItems }`.
   - Built as planned, every real credit would have been reported as failed after posting. A retry with a new number would then credit twice.
   - Fix: AC-3 is amended. The tool parses leniently and never fails once the POST resolves; an unreadable body gives `{ created: true, creditInvoiceNo, note }`.
2. **match_credit_invoice response.**
   - The API returns a plain id string (the spec's inner `result`), not an object.
   - A non-string response fails with "Unexpected credit invoice id from the Inio API." and the read-back is skipped.
3. **Field limits from the spec (not in the plan):**
   - additionalInformation: 1–100
   - paymentReference: 1–20, optional input that the plan's API facts listed but AC-3 left out
   - description: ≤ 100
   - creditInvoiceNo: ≤ 50
4. **Read-back remainingAmount** accepts a number as well as a string. The integration fixture has a number.
5. **Shared helpers extracted.** The 04-01 tools changed only their imports. Reviewer confirmed: no behaviour change.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Uncommitted src/ prep changes and a doubled edit in server.ts at the start of Task 1 suggested a concurrent editor | The user closed the other sessions. The tree was verified (gate green, single registrations) |
| Lint failures in QA test files: an unsafe type assertion, then Prettier formatting | QA removed the assertion. The lead ran prettier on the two test files |
| describe() StringLiteral mutants survived (create 84.85) | QA added property-description tests; round 2 reached 100 |

## Next Phase Readiness

**Ready:**
- Write patterns are settled (ref helpers, read-back, never-fail-after-write, injected now) for 04-03: creating customers and invoices, and payments.

**Concerns:**
- Payments (04-03) have no idempotency: a resend creates duplicate payments. Apply the never-fail-after-write rule there as well.
- Equivalent mutants remain:
  - the `number ?? ''` fallbacks (unreachable)
  - update-customer.ts:87, where the lower-case/upper-case fold in the duplicate check is equivalent
- Survivors in config.ts, tool-logging.ts and server.ts predate this plan.

**Blockers:** None

---
*Phase: 04-write-tools, Plan: 02*
*Completed: 2026-10-29*
