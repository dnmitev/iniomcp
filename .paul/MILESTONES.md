# Milestones

Completed milestone log for this project.

| Milestone | Completed | Duration | Stats |
|-----------|-----------|----------|-------|
| v0.1 Initial Release | 2026-10-30 | 3 days | 5 phases, 16 plans |
| v0.2 Audit Quick Wins | 2026-10-30 | 1 day | 2 phases, 4 plans |

---

## ✅ v0.2 Audit Quick Wins

**Completed:** 2026-10-30 (archived 2026-11-02)
**Duration:** 1 day (2026-10-30)
**Released as:** 0.4.0 (npm `@dnmitev/inio-mcp` with provenance, `ghcr.io/dnmitev/inio-mcp` sha256:c7c188c1…6dfcf)
**Source:** AEGIS audit `aegis-iniomcp-20261030`, remediation items R1, R4, R5, R7

### Stats

| Metric | Value |
|--------|-------|
| Phases | 2 |
| Plans | 4 |
| Files changed | 62 (+2,651 / −255, v0.3.1..v0.4.0) |
| Tests | 1895 unit, 47 integration, 27 Docker |
| Mutation | ≥ 91.7 on every changed file |
| Releases | 0.4.0 |

### Key Accomplishments

- HTTP mode answers 404/401 before reading the body, caps bodies at 256 KiB, warns on non-loopback bind, and drains for 500 ms on shutdown. RSS under unauthenticated 4 MiB uploads went from +298 MB to flat (F-04-007).
- No write tool reports a landed write as failed. The client appends a check-before-retry hint to write 5xx, and accepted-but-unreadable writes return success plus a note in all 11 write tools (F-04-002).
- Tool descriptions and the README state exactly which fields are redacted (`REDACTION_NOTE`), and a test guards the README list against `SENSITIVE_KEYS` (R1).
- Install examples are pinned to the release, plaintext-secret warnings are added, and the README gains Data protection, Release model and Pinning sections (R7).

### Key Decisions

- Auth and path checked before the body is read; body cap 256 KiB (supersedes the SDK 4 MB limit)
- The client owns the check-before-retry sentence; tools use `writeFailure` / `acceptedUnreadable`
- Docs claim npm provenance only; image provenance moves to R6
- v0.2 released as 0.4.0; README pins bumped before the tag

### Deferred to later

- R2 redaction (consumer-only names), R3 write allowlist and payment ceiling, R6 release-path hardening, R8 write attribution, R10 docs drift
- Redundant `closeIdleConnections()` in `src/http.ts`; 5xx hint punctuation; pause id in `acceptedUnreadable()`

---

## ✅ v0.1 Initial Release

**Completed:** 2026-10-30
**Duration:** 3 days (2026-10-28 to 2026-10-30)
**Released as:** 0.3.1 (npm `@dnmitev/inio-mcp`, `ghcr.io/dnmitev/inio-mcp`)

### Stats

| Metric | Value |
|--------|-------|
| Phases | 5 |
| Plans | 16 |
| Files changed | 137 (+30,950 / −100) |
| Tests | 1788 unit, 47 integration, 11 Docker |
| Mutation | ≥ 90 target on every changed file (break 80) |
| Releases | 0.1.0 → 0.3.1 (7 tags) |

### Key Accomplishments

- An Inio API client connects any MCP assistant to its own Inio data with four env vars and `npx`. OAuth2 client credentials are cached and refreshed, and requests have timeouts and 429 retry.
- 7 read tools for customers, pauses, invoices and retry attempts, with compact, token-budgeted results.
- 11 opt-in write tools behind `INIO_ALLOW_WRITES`. Defaults are safe (nothing reaches end customers unless asked), writes are attributed to `inio-mcp`, and there are no false failures on accepted writes.
- Personal data is redacted by default, including bearer invoice links, to meet GDPR for third-party LLMs.
- Shared HTTP server: Streamable HTTP behind a static bearer token, Origin check, one Inio token per instance, and Docker HTTP mode with graceful shutdown.
- Releases are driven by tags: a live gate, npm trusted publishing with provenance, multi-arch GHCR images and GitHub Releases.
- A TDD agent team (QA, developer, reviewer, mutation tester, devops reviewer) with Stryker mutation gates.

### Key Decisions

- Hand-curated tools instead of OpenAPI codegen (the spec has no operationIds, and TS 7 has no codegen API)
- Read-only by default; writes opt in, with no confirm flag (clients confirm through the tool annotations)
- PII redacted by default; `INIO_REVEAL_PII` opts out
- HTTP auth = one static bearer token per instance; MCP OAuth deferred until asked for
- Upstream API bugs worked around in code and logged in Jira (AS-7100, AS-7101 under AS-7097)
- reverse_payment and create_invoice left out of v0.1 (no allocation id; invoices reach end customers at once)

### Deferred to later

- Stryker TS checker (blocked until Stryker supports TypeScript 7)
- `INIO_REVEAL_LINKS`, health endpoint, per-user tokens or OAuth (on demand)
- `get_invoice` size opt-in (after real usage)
- AS-7101 upstream fix (allocation lookup)

---
