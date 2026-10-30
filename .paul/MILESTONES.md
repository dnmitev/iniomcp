# Milestones

Completed milestone log for this project.

| Milestone | Completed | Duration | Stats |
|-----------|-----------|----------|-------|
| v0.1 Initial Release | 2026-10-30 | 3 days | 5 phases, 16 plans |

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
