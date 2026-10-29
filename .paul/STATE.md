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
Phase: 4 of 5 (Write tools, opt-in) — In progress
Plan: 04-02 approved
Status: Applying 04-02
Last activity: 2026-10-29 — PR #27 merged; created .paul/phases/04-write-tools/04-02-PLAN.md

Progress:
- Milestone: [██████▒░░░] 67%
- Phase 4: [███░░░░░░░] 33%

## Loop Position

Current loop state:
```
PLAN ──▶ APPLY ──▶ UNIFY
  ✓        ◉        ○     [Applying]
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
| 2026-10-29: Image on Node 26 LTS; npm engines >=24; CI on 24 and 26 | Phase 3 | Dependabot skips node/@types/node majors |
| 2026-10-29: Request timeout 30 s default (INIO_REQUEST_TIMEOUT_MS) | Phase 3 | MCP clients time out at ~60 s |
| 2026-10-29: Phase 4 order low-risk first (pauses, dates → customer/reset/credit → create/payments) | Phase 4 | 3 plans |
| 2026-10-29: Write safety = INIO_ALLOW_WRITES + annotations + echo; no confirm flag | Phase 4 | Clients confirm via destructiveHint |
| 2026-10-29: 04-02 defaults: reset redistribute=false, credit distributionEnabled=false, update_customer contact+address only | Phase 4 | Nothing reaches end customers unless asked |
| 2026-10-29: Live write checks via `npm run smoke:writes -- <customerNo> [invoiceNo]`; identifiers from the conversation, not env | Phase 4 | Never in release gate; self-cleaning |
| 2026-10-29: npm bootstrap = manual 0.1.0-rc.0 under "next" (manual-rc) | Phase 3 | First CI release with provenance |
| 2026-10-29: 0.1.0 also published manually (no provenance); first CI release is 0.1.1 | Phase 3 | Plan 03-02 amended |

### Deferred Issues

| Issue | Origin | Effort | Revisit |
|-------|--------|--------|---------|
| Stryker TS checker / tsconfig handling disabled (no TS 7 JS API) | 01-01 | S | Stryker supports TS 7 |
| Moderate `qs` advisory in Stryker dev deps | 01-01 | S | Stryker upgrade |
| Move Logger type to src/logger.ts | 01-02 | S | Next touch of logging |
| INIO_REVEAL_LINKS: show invoice links without revealing other PII | 03-01 | S | When users ask for links |
| Trusted publisher first run failed ENEEDAUTH until npm settings fixed; consider verbose npm log on failure | 03-02 | S | If it recurs |
| Stryker CLI --mutate ignored (full runs) | 01-02 | S | If mutation runs get slow |

### Blockers/Concerns
- Phase 1: Fixtures can drift from the real API; run the live suite before releases.
- Phase 2: Upstream API bugs worked around (invoice status 500, retry-attempts page ignored); report to the API team.
- Stryker incremental cache can report stale survivors; use --force after test changes.
- Phase 4: Public API has no role checks; anything enabled is allowed. Reset stage / credit invoices can re-send to end customers and waive fees (04-02).
- get_invoice ~1,700 tokens by default (histories, invoiceItems); consider opt-in like workflowsSettings after real usage.

### Git State
Branch: feat/04-02-plan
Releases: v0.1.2 (npm latest); 04-01 merged as #27, unreleased

## Session Continuity

Last session: 2026-10-28
Stopped at: Plan 04-02 created
Next action: Continue /paul:apply .paul/phases/04-write-tools/04-02-PLAN.md
Resume file: .paul/phases/04-write-tools/04-02-PLAN.md

---
*STATE.md — Updated after every significant action*
