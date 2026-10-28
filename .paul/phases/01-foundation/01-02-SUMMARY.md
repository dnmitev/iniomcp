---
phase: 01-foundation
plan: 02
subsystem: api
tags: [mcp-sdk-v2, oauth2-client-credentials, zod, pino, pii-redaction, stdio]

requires:
  - phase: 01-foundation (01-01)
    provides: toolchain, CI, TDD agent team, loadConfig
provides:
  - Token provider (client_credentials, cache, single-flight, invalidate)
  - Inio API client (401 retry, envelope unwrap, InioApiError, NETWORK_ERROR, safe path segments)
  - PII redaction (keys, key patterns, embedded emails)
  - get_invoice tool (UUID or invoice number)
  - createServer + stdio entry point
  - pino logging with redaction, per tool-call metrics (bytes, approxTokens), upstream warn lines
affects: [01-03 integration tests, phase 2 read tools, phase 3 packaging]

tech-stack:
  added: ["@modelcontextprotocol/server@2.4", "@modelcontextprotocol/client@2.4 (dev)", zod@4, pino@10]
  patterns:
    - client.get returns unknown; tools validate the payload they rely on
    - every tool handler wrapped with withToolLogging
    - errors as tool results "<CODE>: <message> (correlationId <id>)"
    - redaction applied to every tool result unless revealPii

key-files:
  created: [src/auth.ts, src/inio-client.ts, src/redact.ts, src/logger.ts, src/tool-logging.ts, src/server.ts, src/tools/get-invoice.ts]
  modified: [src/index.ts, src/config.ts, package.json, vitest.config.ts, docs/PLANNING.md]

key-decisions:
  - "MCP TypeScript SDK v2 split packages, not legacy @modelcontextprotocol/sdk 1.x"
  - "No OpenAPI codegen: openapi-typescript needs the TS JS API (absent in TS 7)"
  - "Success results are compact JSON text only (no structuredContent) to save context tokens"
  - "PII redaction widened beyond IBAN/SSN; digitalInvoiceURL treated as a credential"
  - "pino to stderr; OpenTelemetry deferred to HTTP mode"

patterns-established:
  - "Lead orchestrates /tdd per task: QA red → dev green → reviewer + mutation in parallel → QA round 2 → dev"

duration: ~2h
started: 2026-10-28T13:00:00Z
completed: 2026-10-28T15:00:00Z
description: "Working get_invoice over MCP SDK v2 stdio: cached client-credentials auth, typed API errors, default-on PII redaction, pino logs with per-call token metrics; verified live against the test environment"
type: Summary
about: "inio-mcp"
---

# Phase 1 Plan 02: Walking Skeleton Summary

**`node src/index.ts` with the four `INIO_*` variables serves `get_invoice` over stdio. It uses cached client-credentials auth, maps API errors to readable results, redacts PII by default, and writes pino JSON logs to stderr with per-call token metrics. A live run against the test environment returned a redacted invoice, about 2,245 tokens each.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~2h |
| Tasks | 3 of 3, each through /tdd with two rounds |
| Tests | 316 (from 80) |
| Mutation score | 98.3% overall; the remaining survivors are equivalent |
| Commits | `635f1b1`, `7ad0b13`, `b0810b6` (+ summary) |
| PR | https://github.com/dnmitev/iniomcp/pull/2 (CI green, 1m28s) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Token provider | Pass | form POST, cache boundary at expiry−60 s, single-flight, invalidate, exact error texts, no secret/body leakage |
| AC-2: API client | Pass | Bearer + Accept, single 401 retry, `result` unwrap, `InioApiError`, `UPSTREAM_ERROR`, `NETWORK_ERROR` (added), `.`/`..` rejected |
| AC-3: PII redaction | Pass (widened) | Exact keys, `email`/`phone` key patterns, `addressLine*`, `zipCode`, `digitalInvoiceURL`, embedded emails in any string |
| AC-4: get_invoice | Pass (amended) | Text only, no structuredContent (token decision); strict input with exact zod messages; error formatting |
| AC-5: stdio server | Pass | A spawned process lists exactly `get_invoice`; empty env exits 1 with nothing on stdout |
| AC-6: Logging and token metrics | Pass (amended) | `tool call` line with bytes/approxTokens; upstream `warn` line carries status/code/correlationId instead of the tool line; redaction verified |
| AC-7: Quality gates | Pass | lint, typecheck, test, build, mutation ≥ 80 (98.3), CI green |

## Live Verification (test environment)

| Call | Result |
|------|--------|
| `get_invoice { id }` | ok, 50 fields; IBAN, distribution email and digitalInvoiceURL `[redacted]` |
| `get_invoice { number }` | ok, same invoice |
| `get_invoice { number: "does-not-exist-123" }` | `NOT_FOUND: … (correlationId …)` |

Logs: one token fetch, then cache hits. Upstream calls took 56–230 ms. The 404 produced a `warn` line. The secret was absent from stderr. The real API wraps responses in a single envelope; the nested envelopes in the spec come from how it was generated.

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| MCP SDK v2 (`@modelcontextprotocol/server`/`client` 2.4) | Current major; v1 is legacy | `@modelcontextprotocol/node` will be needed for HTTP mode (Phase 3) |
| No OpenAPI codegen | openapi-typescript needs the TS 5 compiler API | Tools validate what they use with zod |
| Text-only success results | No duplicate payload in the model context | outputSchema/structuredContent come with trimming in Phase 2 |
| Wider default redaction | GDPR; digitalInvoiceURL opens the invoice without login | Fields such as `setupEmail` that merely contain "email" are redacted too |
| Version read at runtime from package.json | A JSON import sits outside rootDir and breaks the dist layout | Works from src/, dist/ and npx installs |
| pino on stderr; OTel later | stdio servers run on client machines with no collector | — |

## Deviations from Plan

| Type | Count | Impact |
|------|-------|--------|
| Spec amendments | 3 | AC-3 widened, AC-4 text-only, AC-6 status/correlationId moved to warn line |
| Auto-fixed | 4 | NETWORK_ERROR mapping; optional correlationId; 401 body discarded before retry; `.stryker-tmp` excluded from vitest |
| Deferred | 4 | Below |

### Deferred Items

- Strip query strings from logged `path` before any tool adds query parameters (Phase 2).
- Move the shared `Logger` type from `src/auth.ts` to `src/logger.ts`.
- Stryker `--mutate` on the CLI appears to be ignored, so every run mutates all files. A full run takes about 30 s; revisit if it slows down.
- A 401 on a request that used an old token also drops a newer token fetched concurrently, costing one extra token fetch. Acceptable for now.

## Next Phase Readiness

**Ready:** 01-03 can point the same server at Keycloak and mock-API containers, plus the human check in Claude Desktop.

**Concerns:**
- About 2,245 tokens per invoice, so Phase 2 field trimming is high value.
- Broad "email" key matching may hide non-PII settings fields in future tools.

**Blockers:** None

---
*Phase: 01-foundation, Plan: 02*
*Completed: 2026-10-28*
