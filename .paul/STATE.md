---
description: "inio-mcp — current position and accumulated context"
type: ProjectState
about: "inio-mcp"
---

# Project State

## Project Reference

See: .paul/PROJECT.md (updated 2026-10-28)

**Core value:** Inio clients can query (and optionally act on) their own Inio data from any AI assistant with four env vars and `npx`.
**Current focus:** v0.1 — Phase 5 HTTP hardening

## Current Position

Milestone: v0.1 Initial Release
Phase: 5 of 5 (HTTP hardening)
Plan: Not started
Status: Ready to plan
Last activity: 2026-10-29 — Phase 4 complete, transitioned to Phase 5

Progress:
- Milestone: [████████░░] 80%
- Phase 5: [░░░░░░░░░░] 0%

## Loop Position

Current loop state:
```
PLAN ──▶ APPLY ──▶ UNIFY
  ○        ○        ○     [Ready for first PLAN]
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
| 2026-10-28: QA and mutation-tester agents on Sonnet | Phase 2 | Token cost; reviewer stays on Opus |
| 2026-10-29: senior-developer agent on Sonnet, medium effort | Phase 4 | Patterns settled; reviewer stays on Opus |
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
| 2026-10-29: Writes never fail after the POST resolves; unreadable 2xx = success + note (AC-3 amended) | Phase 4 | Apply to payments in 04-03 (no idempotency) |
| 2026-10-29: Phase 4 gets a 4th plan: 04-03 create_payment only; 04-04 create_customer (+ reverse_payment if probe works, create_invoice reconsidered) | Phase 4 | Smaller money-path plan |
| 2026-10-29: Payment types curated (direct_payment, good_will, bank, reminder_fee_waiver); full payment must be explicit | Phase 4 | No credit_loss/cancelled until asked |
| 2026-10-29: clientId for payments from token claim inio_client_id | Phase 4 | No config var |
| 2026-10-29: Non-idempotent writes: status 0 or >= 500 = uncertain, hint to check before retry | Phase 4 | create_payment; reuse in 04-04 |
| 2026-10-29: reverse_payment out of v0.1 (payment id is not an allocation id; probe) | Phase 4 | Ask API team for allocation lookup |
| 2026-10-29: create_invoice out of v0.1 (reaches end customer at once) | Phase 4 | Revisit after usage |
| 2026-10-29: create_customer accepts SSN (C) and orgNr/vatNo (B); no workflowsSettings | Phase 4 | 04-04 |
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
| Distribution emails lack maxLength 150 (update_customer, create_customer) | 04-04 | S | Next schema change to customers |
| Ask API team: allocation lookup for reverse_payment; JSON error envelope on reverse-payment | 04-04 | - | Upstream |

### Blockers/Concerns
- Phase 1: Fixtures can drift from the real API; run the live suite before releases.
- Phase 2: Upstream API bugs worked around (invoice status 500, retry-attempts page ignored); report to the API team.
- Stryker incremental cache can report stale survivors; use --force after test changes.
- Phase 4: Public API has no role checks; anything enabled is allowed. Defaults keep end customers out of it unless asked.
- Phase 4: Claude declines to send an SSN, so consumer customers cannot be created from Claude (documented).
- Phase 4: No public endpoint exposes paymentAllocationId, so payments cannot be reversed via the API; test invoice 20260925-07 carries two 0.01 probe payments (reverse in back office).
- get_invoice ~1,700 tokens by default (histories, invoiceItems); consider opt-in like workflowsSettings after real usage.

### Git State
Branch: feat/04-04-plan
Releases: v0.1.2 (npm latest); 0.2.0 (Phase 4 write tools) in release PR

## Session Continuity

Last session: 2026-10-29
Stopped at: Phase 4 complete, ready to plan Phase 5
Next action: merge release PR, tag v0.2.0, approve live gate; then /paul:plan for Phase 5
Resume file: .paul/ROADMAP.md

---
*STATE.md — Updated after every significant action*
