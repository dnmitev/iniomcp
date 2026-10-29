---
description: "inio-mcp — current position and accumulated context"
type: ProjectState
about: "inio-mcp"
---

# Project State

## Project Reference

See: .paul/PROJECT.md (updated 2026-10-28)

**Core value:** Inio clients can query (and optionally act on) their own Inio data from any AI assistant with four env vars and `npx`.
**Current focus:** v0.1 — Phase 4 Write tools (opt-in)

## Current Position

Milestone: v0.1 Initial Release
Phase: 4 of 5 (Write tools, opt-in) — Not started
Plan: Not started
Status: Ready to plan
Last activity: 2026-10-29 — 0.1.1 released; Phase 3 complete, transitioned to Phase 4

Progress:
- Milestone: [██████░░░░] 60%
- Phase 4: [░░░░░░░░░░] 0%

## Loop Position

Current loop state:
```
PLAN ──▶ APPLY ──▶ UNIFY
  ✓        ✓        ✓     [Loop complete - ready for next PLAN]
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
| 2026-10-29: 0.1.0 published as @dnmitev/inio-mcp (personal scope; @inio later) | Phase 3 | Package name changes for users when moved |
| 2026-10-29: 0.1.0 stdio only (npm and Docker); HTTP with auth in Phase 5 | Phase 3 | MCP_TRANSPORT=http rejected for now |
| 2026-10-29: Release live gate via protected 'release' environment; user adds secrets | Phase 3 | Human-action checkpoint in 03-02 |
| 2026-10-29: pdfURL and digitalInvoiceURL redacted by default (bearer links, verified public) | Phase 3 | Revealed only with INIO_REVEAL_PII=true |
| 2026-10-29: devops-reviewer agent (Sonnet) reviews all CI/CD and release changes | Phase 3 | Also for lead-written workflows |
| 2026-10-29: npm bootstrap = manual 0.1.0-rc.0 under "next" (manual-rc) | Phase 3 | First CI release with provenance |
| 2026-10-29: 0.1.0 also published manually (no provenance); first CI release is 0.1.1 | Phase 3 | Plan 03-02 amended |

### Deferred Issues

| Issue | Origin | Effort | Revisit |
|-------|--------|--------|---------|
| Stryker TS checker / tsconfig handling disabled (no TS 7 JS API) | 01-01 | S | Stryker supports TS 7 |
| Moderate `qs` advisory in Stryker dev deps | 01-01 | S | Stryker upgrade |
| Move Logger type to src/logger.ts | 01-02 | S | Next touch of logging |
| INIO_REVEAL_LINKS: show invoice links without revealing other PII | 03-01 | S | When users ask for links |
| API request timeout: default 60 s (INIO_REQUEST_TIMEOUT_MS), TIMEOUT tool error; live test timeout above it | 03-02 (v0.1.2-rc.1 live gate hit 30 s test timeouts) | S | Before Phase 4 |
| Dependabot PRs #9-#15 (major bumps); ignore majors for node image and @types/node | 03-02 | S | After 0.1.1 |
| Trusted publisher first run failed ENEEDAUTH until npm settings fixed; consider verbose npm log on failure | 03-02 | S | If it recurs |
| Stryker CLI --mutate ignored (full runs) | 01-02 | S | If mutation runs get slow |

### Blockers/Concerns
- Phase 1: Fixtures can drift from the real API; run the live suite before releases.
- Phase 2: Upstream API bugs worked around (invoice status 500, retry-attempts page ignored); report to the API team.
- Stryker incremental cache can report stale survivors; use --force after test changes.
- get_invoice ~1,700 tokens by default (histories, invoiceItems); consider opt-in like workflowsSettings after real usage.

### Git State
Branch: docs/phase-3-complete
Releases: v0.1.1-rc.1, v0.1.1 (npm latest 0.1.1, GHCR 0.1.1/0.1/latest)
Feature branches merged: PRs #3-#8, #16, #17

## Session Continuity

Last session: 2026-10-28
Stopped at: Phase 3 complete (0.1.1 released)
Next action: Merge docs/phase-3-complete PR; triage Dependabot PRs #9-#15; then /paul:plan for Phase 4
Resume file: .paul/ROADMAP.md

---
*STATE.md — Updated after every significant action*
