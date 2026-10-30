---
description: "inio-mcp — current position and accumulated context"
type: ProjectState
about: "inio-mcp"
---

# Project State

## Project Reference

See: .paul/PROJECT.md (updated 2026-10-30)

**Core value:** Inio clients can query (and optionally act on) their own Inio data from any AI assistant with four env vars and `npx`.
**Current focus:** Awaiting next milestone (v0.1 complete, 0.3.1)

## Current Position

Milestone: Awaiting next milestone
Phase: None active
Plan: None
Status: Milestone v0.1 Initial Release complete — ready for next
Last activity: 2026-10-30 — Milestone completed

Progress:
- v0.1 Initial Release: [██████████] 100% ✓

## Loop Position

Current loop state:
```
PLAN ──▶ APPLY ──▶ UNIFY
  ○        ○        ○     [Milestone complete - ready for next]
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
| 2026-10-30: HTTP auth = one static bearer token (MCP_AUTH_TOKEN, ≥32 chars); one instance = one tenant; no OAuth/PRM in v0.1 | Phase 5 | All four clients accept a fixed header; spec makes auth optional |
| 2026-10-30: Node bridge via @modelcontextprotocol/node (toNodeHandler; pulls hono) | Phase 5 | Official adapter over hand-written SSE conversion |
| 2026-10-30: Phase 5 = 05-01 transport+auth+Origin (TDD); 05-02 Docker HTTP, docs, release 0.3.0 | Phase 5 | devops-reviewer on 05-02 |
| 2026-10-30: MCP_AUTH_TOKEN rejects whitespace; Bearer accepts 1+ spaces; Origin allowlist by hostname | Phase 5 | 05-01 review fixes |
| 2026-10-30: HttpConfig type narrows config.http (no runtime guard) | Phase 5 | Pattern for HTTP code |
| 2026-10-30: 05-02: graceful shutdown built; health endpoint skipped (YAGNI, no unauthenticated route); body limit = SDK 413 at 4 MB | Phase 5 | Closes 05-01 deferred items |
| 2026-10-30: Docker image sets HOST=0.0.0.0 + EXPOSE 3000; stdio stays default | Phase 5 | Token still required for HTTP |
| 2026-10-30: Deferred triage: ENEEDAUTH closed (no recurrence through 0.3.0); 5 quick items into 05-03 + release 0.3.1 | Phase 5 | Milestone closes with a short deferred list |
| 2026-10-29: npm bootstrap = manual 0.1.0-rc.0 under "next" (manual-rc) | Phase 3 | First CI release with provenance |
| 2026-10-29: 0.1.0 also published manually (no provenance); first CI release is 0.1.1 | Phase 3 | Plan 03-02 amended |

### Deferred Issues

| Issue | Origin | Effort | Revisit |
|-------|--------|--------|---------|
| Stryker TS checker / tsconfig handling disabled (no TS 7 JS API) | 01-01 | S | Stryker supports TS 7 |
| INIO_REVEAL_LINKS: show invoice links without revealing other PII | 03-01 | S | When users ask for links |
| Health endpoint for HTTP mode (skipped: would be unauthenticated) | 05-02 | S | If an orchestrator needs it |
| Per-user tokens or MCP OAuth for HTTP | 05-01 | M | If teams ask |
| Double-signal shutdown tests are race-prone smoke tests | 05-02 | S | If shutdown logic changes |
| Upstream: allocation lookup for reverse_payment; JSON error envelope on reverse-payment (Jira AS-7101) | 04-04 | - | When AS-7101 is fixed |

### Blockers/Concerns
- Phase 1: Fixtures can drift from the real API; run the live suite before releases.
- Phase 2: Upstream API bugs worked around (invoice status 500, retry-attempts page ignored); logged as Jira AS-7100.
- Stryker incremental cache can report stale survivors; use --force after test changes. Use MUTATE=src/a.ts for targeted runs; the report still lists cached rows for other files.
- Release live gate can fail on test-environment latency (0.2.0 attempt 1: list_customers hit the 30 s timeout); re-run the job.
- Phase 4: Public API has no role checks; anything enabled is allowed. Defaults keep end customers out of it unless asked.
- Phase 4: Claude declines to send an SSN, so consumer customers cannot be created from Claude (documented).
- Phase 4: No public endpoint exposes paymentAllocationId, so payments cannot be reversed via the API (AS-7101). The two 0.01 probe payments on test invoice 20260925-07 stay; negligible.
- get_invoice ~1,700 tokens by default (histories, invoiceItems); consider opt-in like workflowsSettings after real usage.

### Git State
Branch: paul/milestone-v0.1 (main 736b6a0); milestone tag milestone-v0.1 (local, not pushed)
Releases: v0.3.1 (npm latest, GHCR 0.3.1/0.3/latest, 2026-10-30; cleanup); v0.3.0 (shared HTTP server); v0.2.0 before

## Session Continuity

Last session: 2026-10-30
Stopped at: Milestone v0.1 Initial Release complete
Next action: /paul:discuss-milestone or /paul:milestone
Resume file: .paul/MILESTONES.md
Resume context:
- 0.3.1 on npm latest + GHCR + GitHub Release (stdio and shared HTTP server, 18 tools with writes on)

---
*STATE.md — Updated after every significant action*
