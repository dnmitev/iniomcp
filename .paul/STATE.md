---
description: "inio-mcp — current position and accumulated context"
type: ProjectState
about: "inio-mcp"
---

# Project State

## Project Reference

See: .paul/PROJECT.md (updated 2026-10-28)

**Core value:** Inio clients can query (and optionally act on) their own Inio data from any AI assistant with four env vars and `npx`.
**Current focus:** v0.1 — Phase 2 Read tools

## Current Position

Milestone: v0.1 Initial Release
Phase: 2 of 5 (Read tools) — In progress
Plan: 02-03 created, awaiting approval
Status: PLAN created, ready for APPLY
Last activity: 2026-10-28 — PR #5 merged; created .paul/phases/02-read-tools/02-03-PLAN.md

Progress:
- Milestone: [███░░░░░░░] 33%
- Phase 2: [██████░░░░] 67%

## Loop Position

Current loop state:
```
PLAN ──▶ APPLY ──▶ UNIFY
  ✓        ○        ○     [Plan created, awaiting approval]
```

## Accumulated Context

### Decisions
See PROJECT.md Key Decisions.

| Decision | Phase | Impact |
|----------|-------|--------|
| 2026-10-28: Vitest instead of Jest (ESM-native) | Phase 1 | Test runner, Stryker vitest-runner; deviates from the Inio product monorepo |
| 2026-10-28: TypeScript 7, npm, tsc (no Yarn/tsup), oxlint (no ESLint) | Phase 1 | Stryker TS checker dropped; tsconfig rewrite disabled |
| 2026-10-28: Integration mock = node:http fake API + synthetic fixture (not Prism; spec envelopes wrong) | Phase 1 | Live suite guards fixture drift; each Phase 2 tool adds a route + fixture |
| 2026-10-28: MCP SDK v2, pino stderr logs, text-only results, wide PII redaction | Phase 1 | ~2,245 tokens/invoice measured; trimming in Phase 2 |
| 2026-10-28: Phase 2 split into 3 plans (customers + plumbing; invoices/pauses/retries; 429 + integration + Desktop) | Phase 2 | 02-02 reuses result.ts |
| 2026-10-28: Trimming = summary fields in lists, compact (no empties) detail | Phase 2 | Compact before redact |
| 2026-10-28: 429 = one retry honoring Retry-After (cap 5 s), then RATE_LIMITED | Phase 2 | Built in 02-03 |
| 2026-10-28: Sort/order as curated enums validated locally (API 500s on bad values) | Phase 2 | Pattern for list_invoices |
| 2026-10-28: Free-text identifiers reject only control characters | Phase 2 | Encoding handles the rest |
| 2026-10-28: Single invoice status sent twice (upstream 500 workaround) | Phase 2 | Remove when API is fixed |
| 2026-10-28: QA and mutation-tester agents on Sonnet | Phase 2 | Token cost; reviewer/developer stay on Opus |
| 2026-10-28: workflowsSettings opt-in (includeWorkflowSettings) on get_invoice/get_customer | Phase 2 | Stage distribution details stay one flag away |

### Deferred Issues

| Issue | Origin | Effort | Revisit |
|-------|--------|--------|---------|
| Stryker TS checker / tsconfig handling disabled (no TS 7 JS API) | 01-01 | S | Stryker supports TS 7 |
| Moderate `qs` advisory in Stryker dev deps | 01-01 | S | Stryker upgrade |
| Move Logger type to src/logger.ts | 01-02 | S | Next touch of logging |
| Stryker CLI --mutate ignored (full runs) | 01-02 | S | If mutation runs get slow |

### Blockers/Concerns
- Phase 1: Fixtures can drift from the real API; run the live suite before releases.
- Phase 2: Upstream API bugs worked around (invoice status 500, retry-attempts page ignored); report to the API team.
- Stryker incremental cache can report stale survivors; use --force after test changes.

### Git State
Branch: feat/02-03-hardening
Feature branches merged: PR #3 (d6af7bf), PR #4 (e8acb80), PR #5 (fa88562)

## Session Continuity

Last session: 2026-10-28
Stopped at: Plan 02-03 created
Next action: Review and approve plan, then /paul:apply .paul/phases/02-read-tools/02-03-PLAN.md
Resume file: .paul/phases/02-read-tools/02-03-PLAN.md

---
*STATE.md — Updated after every significant action*
