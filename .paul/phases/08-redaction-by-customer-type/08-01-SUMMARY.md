---
phase: 08-redaction-by-customer-type
plan: 01
subsystem: privacy
tags: [redaction, gdpr, customerType, zod, cache]

requires:
  - phase: 07-docs-install-trust
    provides: REDACTION_NOTE, README redacted-fields guard
provides:
  - Per-object redaction mode from customerType (B business, else consumer)
  - get_invoice customer-type lookup with a shared cache
  - Reviewed response-key list (unit on fixtures, live on the real API)
affects: [09-docs-overhaul, v0.4 hosted]

tech-stack:
  added: []
  patterns:
    - "redact(value, type) walks with a mode; an object's own customerType switches it for its subtree"
    - "Strict side by default: unknown type, failed lookup or odd payload = consumer"

key-files:
  created: [test/response-keys.ts, test/unit/response-keys.test.ts]
  modified: [src/redact.ts, src/tools/result.ts, src/tools/get-invoice.ts, src/server.ts, README.md]

key-decisions:
  - "Business: only invoice links and SSN redacted; consumer/unknown: today's keys + customerName, city, yourReference"
  - "`note` stays visible (collides with the tools' own status field)"
  - "errorText stays strict for both modes (field messages for the new keys hidden too)"
  - "get_invoice reads externalCustomer.customerType via a zod schema; caches only valid payloads; clear-all at 1000"

patterns-established:
  - "New response keys need a personal-data decision (test/response-keys.ts)"

duration: ~2h
started: 2026-11-02T10:30:00Z
completed: 2026-11-02T12:40:00Z
description: "Redaction by customer type: businesses open except invoice links and SSN, consumers stricter; get_invoice looks up the type"
type: Summary
about: "inio-mcp"
---

# Phase 8 Plan 01: Redaction by customer type Summary

**Redaction now follows `customerType`: business customers come back in full except invoice links and SSN; consumers and unknown types keep today's redaction plus name, city and `yourReference`; `get_invoice` looks up the invoice's customer (cached) to pick the mode.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~2h |
| Tasks | 3 completed (one TDD loop) |
| Files modified | 21 (+967 / −115) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Business returned in full except links | Pass, amended | SSN also redacted for B (sole trader's ID; reviewer finding, lead decision) |
| AC-2: Consumers/unknown stricter | Pass, amended | customerName, city, yourReference added; `note` dropped (see deviations); nested customerType overrides parent |
| AC-3: get_invoice uses the customer's type | Pass | Lookup by customerId via `externalCustomer.customerType`; cache shared per factory, clear at 1000; failure → consumer; no lookup with revealPii |
| AC-4: Note, README and keys in sync | Pass | REDACTION_NOTE rewritten; README has business and consumer blocks guarded by test; errorText strict in both modes |
| AC-5: Unreviewed keys fail | Pass | test/response-keys.ts; unit on fixtures, live on raw API payloads; fixture customerType "Company" → "B" |

## Accomplishments

- Business data (company, contact, address) reaches the assistant as-is, which makes it usable as an integration layer; consumer personal data stays redacted.
- Safe defaults everywhere: missing or odd `customerType`, a failed customer lookup or an unexpected payload all fall back to consumer rules.
- New upstream response keys now fail the unit test (fixtures) and the live release gate until someone decides whether they are personal data.

## Verification

| Check | Result |
|-------|--------|
| `npm run lint`, `npm run typecheck` | Clean |
| `npm test` | 1974 passed (was 1895; +79) |
| `npm run test:integration` | 48 passed (was 47; +1, plus updated request expectations) |
| Live suite | Typechecks; runs at release |
| Reviewer | APPROVE (6 minors, resolved or accepted below) |
| Mutation (round 2, `--force`) | redact.ts 100, result.ts 99.37, server.ts 96.77, get-invoice.ts 95.45 (round 1: 84.71) |

Remaining survivors are equivalent: `catch` emptied in kindOf (undefined → present's consumer default), `!parsed.success` guard (TypeError → catch → consumer), unreachable `number ?? ''`, JWT `?? ''` fallback in result.ts, `readFileSync` encoding in server.ts.

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/redact.ts` | Modified | `redact(value, type)`, `BUSINESS_SENSITIVE_KEYS` (pdfurl, digitalinvoiceurl, ssn), consumer keys + customername/city/yourreference, new REDACTION_NOTE |
| `src/tools/result.ts` | Modified | `present`/`presentRaw` take an optional type |
| `src/tools/get-invoice.ts` | Modified | `kindOf` lookup with zod `CustomerPayload`, shared cache, cap |
| `src/server.ts` | Modified | One cache per server factory |
| `README.md` | Modified | Data protection rewritten (business and consumer blocks), tools sentence, INIO_REVEAL_PII row |
| `test/response-keys.ts`, `test/unit/response-keys.test.ts` | Created | Reviewed key sets + drift check |
| `test/unit/*` (redact, result, get-invoice, get-customer, list-customers, update-customer, server, descriptions) | Modified | New contract, per-type cases |
| `test/integration/*` (fake API, customer fixture, server test) | Modified | Customer-by-id route, B fixture, lookup and cache tests |
| `test/live/server.live.test.ts` | Modified | Type-aware redaction checks, key drift, client-based raw GET |

## Deviations from Plan

| Type | Count | Impact |
|------|-------|--------|
| Spec amendments (lead decisions) | 4 | Narrow; safer or less surprising |
| Refactor beyond plan | 1 | Simpler kindOf, higher mutation score |
| Deferred | 1 | Cache TTL |

1. **`note` not redacted for consumers.** The write tools return their own `note` status message through `present()`; redacting `note` hid it. Consumer free-text `note` stays visible, documented in README.
2. **SSN redacted for businesses.** Reviewer: an SSN on a B record is a sole trader's personal ID, never business data. README business block and REDACTION_NOTE say so.
3. **errorText stricter.** It uses the consumer predicate, so per-field error messages for customerName, city and yourReference are now hidden too (both modes).
4. **Customer payload shape.** Real `GET /customers/<id>` is `{ externalCustomer, serviceLine, effectivePause }`; the type is read from `externalCustomer.customerType` (plan assumed flat).
5. **`presentPage` type parameter removed** (no caller; per-item customerType drives lists). **kindOf** rewritten with a zod schema after mutation round 1 found 11 equivalent survivors in hand-written guards.

### Deferred Items
- Cached customer types never expire; a B→C change applies after restart (README states it). Add a TTL if it matters in hosted use.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Customer fixture had `customerType: "Company"` (not in spec enum) | Corrected to "B" |
| Integration request counts changed by the extra customer GET | Tests updated to the intended behaviour (audit header absent on both GETs; one token fetch) |
| Live get_customer assertions assumed consumer redaction | Now depend on the live customer's type |

## Next Phase Readiness

**Ready:**
- Docs overhaul (Phase 9) can describe the two redaction modes from the README section written here.

**Concerns:**
- Live suite not run yet; first run at the 0.5.0 release gate exercises the key-drift check against the real API and may surface keys to review.
- Out-of-scope mutation survivors remain in http.ts, tool-logging.ts, create-customer.ts, customer-fields.ts (pre-existing).

**Blockers:** None

---
*Phase: 08-redaction-by-customer-type, Plan: 01*
*Completed: 2026-11-02*
