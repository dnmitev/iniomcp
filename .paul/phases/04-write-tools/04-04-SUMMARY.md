---
phase: 04-write-tools
plan: 04
subsystem: api
tags: [write-tools, customers, refactor, pii]

requires:
  - phase: 04-write-tools
    provides: 04-03 clientIdOf, uncertain-outcome hint, isUnreadableSuccess
provides:
  - create_customer (B with orgNr+vatNo, C with SSN; clientId from token; 409 on duplicate)
  - customer-fields.ts (shared address and email schemas, distinctEmails)
  - result.ts clientIdOf and isUncertainOutcome (shared by create_payment and create_customer)
  - live finding: payment id is not a paymentAllocationId (reverse_payment out of v0.1)
affects: [Phase 5, v0.1 release notes]

tech-stack:
  added: []
  patterns:
    - "Identity numbers validated by customer type with whole-object refines"
    - "Share field schemas, not whole objects, when create needs full and update needs partial shapes"

key-files:
  created:
    - src/tools/create-customer.ts
    - src/tools/customer-fields.ts
  modified:
    - src/tools/result.ts
    - src/tools/create-payment.ts
    - src/tools/update-customer.ts
    - src/server.ts
    - README.md
    - CHANGELOG.md

key-decisions:
  - "reverse_payment and create_invoice out of v0.1"
  - "AC-1 amended: SSN required for C; orgNr and vatNo required for B (spec)"
  - "Keep consumer (C) support although Claude declines to send an SSN; documented"

duration: ~1 session
completed: 2026-10-29
description: "create_customer write tool with identity numbers by customer type and clientId from the token; shared customer and token helpers; 18 tools with writes on"
type: Summary
about: "inio-mcp"
---

# Phase 4 Plan 04: create_customer Summary

**`create_customer` creates one customer per call: a business (B) with orgNr and vatNo, or a consumer (C) with SSN. The tenant clientId comes from the token. A duplicate customerNo returns 409, so a retry cannot create a second customer. A customer that was created is never reported as failed. The server lists 18 tools with writes on. Payment reversal and invoice creation are documented as not available.**

## Performance

| Metric | Value |
|--------|-------|
| Completed | 2026-10-29 |
| Tasks | 2 auto + 1 human-verify checkpoint, all completed |
| Files | 13 changed (+167 / −73), 3 new (src 140 + 33 lines, test 735 lines) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Input | Pass (amended) | Identity numbers are required by type, per the spec. Addresses must be full. The schema is strict; workflowsSettings, clientId, customerTag1 and null emails are rejected. Emails must differ, ignoring case |
| AC-2: Request and result | Pass | `POST /customers [{...input, clientId}]`. An unreadable 2xx is success with a note. A 409 says "already exists, use get_customer". Status 0 or ≥ 500 gets the hint |
| AC-3: Shared helpers | Pass | clientIdOf and isUncertainOutcome are in result.ts; the field schemas and distinctEmails are in customer-fields.ts. update_customer and create_payment behave as before (their tests are untouched; the reviewer checked the schemas) |
| AC-4: Gate, integration, docs | Pass | 18 tools with writes on, 7 without. 2 integration tests (create, 409). README row and "Not available" note. CHANGELOG |

## Verification Results

- `npm run lint`, `npm run typecheck`: clean.
- `npm test`: 26 files, 1697 tests passed.
- `npm run test:integration`: 44 passed.
- Mutation (Stryker --force):

  | File | Score |
  |---|---|
  | create-customer.ts | 94.44 |
  | customer-fields.ts | 93.55 |
  | result.ts | 99.36 |
  | update-customer.ts | 100 |
  | create-payment.ts | 100 |

  The null-email and phone-anchor survivors were then killed; this was confirmed by flipping each by hand. The remaining survivors change only description labels, plus the equivalent case-fold mutant.
- Reviewer: APPROVE, with 2 minors.
- Claude Desktop: approved with a business (B) customer (create, then a duplicate gives "already exists").

## Deviations from Plan

| Type | Count | Impact |
|------|-------|--------|
| Spec fixes | 2 | Identity numbers required by type; SSN limitation documented |
| Deferred | 1 | Email maxLength 150 |

1. **AC-1 amended.** openapi/inio.json marks SSN as required for C, and orgNr and vatNo as required for B. The plan had them optional.
2. **Claude declines to send an SSN**, even a fake one, so consumer customers cannot be created from Claude. The user kept C support, since other clients may send an SSN. The tool description and README tell the model to direct the user to the back office instead.
3. **Description wording** (reviewer minor): a retry with the same customerNo is rejected, but after an unclear outcome the model should check get_customer first.
4. **Deferred:** the distribution emails have no `.max(150)`. Adding it would change update_customer's schema, which AC-3 forbids.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Typecheck error in a mixed-row `it.each` table in the test file | QA typed the table (`Row[]`) without casts |
| Desktop reported no create_customer tool | The chat had started before the server restart; the server listed 18 tools. A new chat worked |

## Next Phase Readiness

**Ready:**
- Phase 4 is complete with 10 write tools behind INIO_ALLOW_WRITES. 04-01 to 04-04 are not yet released.

**Concerns:**
- Two 0.01 probe payments remain on test invoice 20260925-07; reverse them in the back office.
- Ask the API team for an allocation lookup (reverse_payment) and to fix the bare `{message}` error on reverse-payment.

**Blockers:** None

---
*Phase: 04-write-tools, Plan: 04*
*Completed: 2026-10-29*
