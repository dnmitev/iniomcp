---
phase: 10-write-bounds-attribution-release-hygiene
plan: 01
subsystem: write-safety
tags: [config, allowlist, payment-ceiling, zod, descriptions]

requires:
  - phase: 04-write-tools
    provides: the 11 write tools and INIO_ALLOW_WRITES
provides:
  - INIO_WRITE_TOOLS allowlist (opt-in, validated)
  - INIO_MAX_PAYMENT_AMOUNT ceiling on create_payment (opt-in)
  - Later-effect sentences in four write tool descriptions
affects: [10-02 write attribution, 11 Helm values, v0.4 per-user roles]

key-files:
  modified: [src/config.ts, src/server.ts, src/tools/create-payment.ts, src/tools/cancel-customer-pause.ts, src/tools/update-invoice-stop-until-dates.ts, src/tools/update-customer.ts, src/tools/reset-invoice-stage.ts, README.md, docs/hosting.md]

key-decisions:
  - "Both settings off by default; INIO_WRITE_TOOLS without INIO_ALLOW_WRITES=true is a startup error"
  - "Ceiling compares in cents; fullPayment reads remainingAmount first (number or numeric string, per spec) and refuses if above or unreadable"
  - "Write registration via a name→register map filtered by config.writeTools"

duration: ~2h
completed: 2026-11-02T17:30:00Z
description: "Opt-in write-tool allowlist and payment ceiling; write descriptions state later effects"
type: Summary
about: "inio-mcp"
---

# Phase 10 Plan 01: Write bounds Summary

**Admins can register only the write tools a team needs (`INIO_WRITE_TOOLS`) and cap single payments (`INIO_MAX_PAYMENT_AMOUNT`); both are off by default. Four write tools now say what happens afterwards.**

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Write-tool allowlist | Pass | Trimmed, case-sensitive; unknown/read names and missing INIO_ALLOW_WRITES fail at start with the valid list |
| AC-2: Payment ceiling | Pass | Amount and {capital, fee} checked in cents before any POST; fullPayment GETs remainingAmount (number or numeric string) first; description sentence only when set |
| AC-3: Later effects | Pass, reworded | Pause cancel ("whatever the pause held back … resumes"), stop-until clear, update_customer (only when distribution/postal address changes), stage reset |
| AC-4: Documented | Pass | README variables + "do not auto-approve write tools"; hosting guide "Limit what the team can change" |

## Verification

| Check | Result |
|-------|--------|
| lint, typecheck | Clean |
| `npm test` | 2045 passed (was 1978; +67) |
| `npm run test:integration` | 48 passed |
| Reviewer | 2 major + 5 minor → all fixed → APPROVE |
| Mutation (3 rounds, `--force`) | create-payment.ts 100, config.ts 99.56, server.ts 97.30, reset-invoice-stage.ts 98.46, other description-only tools 100 |

Remaining survivors are equivalent: `flag()` default literal, `readFileSync` encoding, unreachable `number ?? ''` in reset-invoice-stage.

## Deviations from Plan

1. **(major, review) remainingAmount is a string in the spec.** The first version accepted only numbers, so a full payment would always be refused with a ceiling set. Now a zod `Remaining` schema accepts a finite number or a numeric string.
2. **(review) Description wording narrowed:** cancel_customer_pause covers pause scope; update_customer applies only when distribution emails or postal address change.
3. **(review) Pre-check GET failure** includes the API error text; hosting.md env example comment moved to its own line (env files have no inline comments); server-level test proves the ceiling is wired.
4. **Mutation-driven:** remainingAmount check rewritten from hand-written guards to the zod schema (as in Phase 8's kindOf); tests pin regex edges ("450abc", "abc450", "450", arrays, objects) and the exact no-ceiling description.

## Next Phase Readiness

**Ready:** 10-02 (write attribution logging) can log the allowlist and ceiling at startup alongside allowWrites.

**Concerns:** Ceiling does not cover credit invoices (by design; documented scope limit).

**Blockers:** None

---
*Phase: 10-write-bounds-attribution-release-hygiene, Plan: 01*
*Completed: 2026-11-02*
