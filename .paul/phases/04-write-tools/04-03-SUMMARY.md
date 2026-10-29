---
phase: 04-write-tools
plan: 03
subsystem: api
tags: [write-tools, payments, idempotency, jwt-claims, mutation-testing]

requires:
  - phase: 04-write-tools
    provides: 04-02 never-fail-after-write pattern, readBackInvoice, create_credit_invoice 2xx handling
provides:
  - create_payment (curated types, explicit full payment, clientId from token)
  - isUnreadableSuccess shared in result.ts
  - live finding: no public endpoint exposes paymentAllocationId
affects: [04-04 (create_customer, reverse_payment probe, create_invoice decision)]

tech-stack:
  added: []
  patterns:
    - "Tenant clientId is decoded from the access token's inio_client_id on every call; never logged"
    - "Uncertain outcomes (status 0 or >= 500) on non-idempotent writes get a check-before-retry hint"
    - "An amount-or-explicit-flag XOR stops the API's 'no amount = full' default from being triggered by accident"

key-files:
  created:
    - src/tools/create-payment.ts
  modified:
    - src/tools/result.ts
    - src/tools/create-credit-invoice.ts
    - src/server.ts
    - README.md
    - CHANGELOG.md

key-decisions:
  - "04-03 = create_payment only; reverse_payment and create_customer moved to 04-04"
  - "Payment types curated to direct_payment, good_will, bank, reminder_fee_waiver"
  - "5xx also counts as an uncertain outcome for payments (reviewer minor)"

duration: ~1 session
completed: 2026-10-29
description: "create_payment write tool: four curated transaction types, explicit full payment, clientId from the token, never reports an accepted payment as failed; 17 tools with writes on"
type: Summary
about: "inio-mcp"
---

# Phase 4 Plan 03: create_payment Summary

**`create_payment` records one payment per call for `direct_payment`, `good_will`, `bank` or `reminder_fee_waiver`. A full payment must be explicit. The tenant's `clientId` comes from the token. An accepted payment is never reported as failed, and uncertain outcomes tell the model to check `remainingAmount` before any retry. The server lists 17 tools with writes on.**

## Performance

| Metric | Value |
|--------|-------|
| Completed | 2026-10-29 |
| Tasks | 2 auto + 1 human-verify checkpoint, all completed |
| Files | 12 changed (+167 / −39), 2 new (src 137 lines, test 710 lines) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Input | Pass | Strict schema. Exactly one of amount and fullPayment. A breakdown is allowed only for direct_payment and good_will. Positive amounts with at most 2 decimals. credit_loss, cancelled, clientId and unknown keys are rejected locally |
| AC-2: Request | Pass | `POST /payments [{ clientId, invoiceNo, transactionType, amount?, ... }]`; no amount for fullPayment. A missing or malformed claim fails before the POST |
| AC-3: Result | Pass | Read-back of remainingAmount and paymentStatus. An unreadable 2xx (including an InioApiError with a 2xx status) is success with a "Do not retry" note. Status 0 and ≥ 500 get the check-before-retry hint |
| AC-4: Gate, description, integration, docs | Pass | 17 tools with writes on, 7 without. destructiveHint true, idempotentHint false. 2 integration tests check clientId from the Keycloak token. README and CHANGELOG updated |

## Verification Results

- `npm run lint` and `npm run typecheck`: clean.
- `npm test`: 25 files, 1552 tests passed.
- `npm run test:integration`: 42 passed.
- Mutation (Stryker --force, round 2):

  | File | Score |
  |---|---|
  | create-payment.ts | 98.35 |
  | result.ts | 100 |
  | create-credit-invoice.ts | 100 |

  The `>= 500` bound was confirmed killed by a manual flip after the 500 and 499 tests were added. One equivalent mutant remains: the `?? ''` fallback for a token payload.
- Reviewer: APPROVE, with 4 minors.
- Claude Desktop checkpoint: approved by the user.

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/tools/create-payment.ts` | Created | The tool: input schema, claim decoding, POST, read-back, uncertain hint |
| `src/tools/result.ts` | Modified | `isUnreadableSuccess` (an InioApiError with a 2xx status) |
| `src/tools/create-credit-invoice.ts` | Modified | Uses `isUnreadableSuccess`; behaviour unchanged |
| `src/server.ts` | Modified | Registers create_payment with the token provider (writes only) |
| `test/unit/create-payment.test.ts` | Created | Unit tests, including through the real client |
| `test/unit/server.test.ts`, `create-credit-invoice.test.ts` | Modified | 17 tools, annotations, 200/299/300 bounds |
| `test/integration/*` | Modified | POST /payments route and 2 tests |
| `README.md`, `CHANGELOG.md` | Modified | Docs |
| `.paul/phases/04-write-tools/04-API-NOTES.md` | Modified | Live findings: token claim, no allocation ids |

## Deviations from Plan

| Type | Count | Impact |
|------|-------|--------|
| Scope additions | 2 | Small and safety-positive |
| Deferred | 0 | — |

1. **5xx counts as uncertain** (reviewer minor). The plan named only timeouts and lost responses. A 502, 503 or 504 from the gateway is just as unknown, so status ≥ 500 gets the same hint. The 500 and 499 bounds are tested.
2. **Shared `isUnreadableSuccess`.** The plan allowed extracting it; create_credit_invoice uses it now, and its 200/300 bounds are pinned for both tools.
3. Reviewer minors not taken:
   - A 2xx whose body times out still reports TIMEOUT with the hint. That is existing client code and an acceptable uncertain report.
   - The timeout hint appears twice. Cosmetic.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| QA ran eslint (not configured) instead of `npm run lint` | The lead ran oxlint; QA fixed 3 errors |
| A real-client test assumed `fetch(Request)`; the client calls `fetch(url, init)` | The lead caught it before green; QA rewrote the test to the inio-client.test.ts pattern |

## Next Phase Readiness

**Ready:**
- 04-04 has the patterns it needs (claim helper, uncertain hint, never fail after write).

**Concerns:**
- reverse_payment needs a live write probe: does a payment id from create_payment work as a `paymentAllocationId`? Without it, payments made here cannot be reversed with these tools.
- create_invoice sends to the end customer at once; decide in 04-04 whether to include it.

**Blockers:** None

---
*Phase: 04-write-tools, Plan: 03*
*Completed: 2026-10-29*
