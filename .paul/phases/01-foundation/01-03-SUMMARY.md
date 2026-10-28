---
phase: 01-foundation
plan: 03
subsystem: testing
tags: [testcontainers, keycloak, integration-tests, live-tests, github-actions, claude-desktop]

requires:
  - phase: 01-foundation (01-02)
    provides: token provider, API client, get_invoice, stdio server, logging
provides:
  - Integration suite: built dist server over stdio against Keycloak 26.8.1 and a node:http fake Inio API
  - Synthetic invoice fixture with the real response's key structure
  - Opt-in live suite (INIO_LIVE=1, local .env)
  - CI integration job after the check job
  - README setup for Claude Desktop, logs and development scripts
affects: [phase 2 read tools (fixtures and fake API routes per tool), phase 3 release workflow (live suite)]

tech-stack:
  added: ["testcontainers@12.2"]
  patterns:
    - integration tests spawn `node dist/index.js` via StdioClientTransport with an explicit env
    - fake API serves synthetic fixtures in the real single-envelope shape
    - live suite gated by describe.skipIf(INIO_LIVE !== '1'), never in CI

key-files:
  created: [test/integration/keycloak-realm.json, test/integration/fake-inio-api.ts, test/integration/fixtures/invoice.json, test/integration/server.integration.test.ts, test/live/server.live.test.ts]
  modified: [package.json, .github/workflows/ci.yml, README.md, .env.example, .claude/agents/senior-qa-automation.md, .prettierignore]

key-decisions:
  - "Fake node:http API + synthetic fixture instead of Prism (spec envelopes are wrong)"
  - "Keycloak pinned to 26.8.1"

duration: ~1.5h
started: 2026-10-28T13:15:00Z
completed: 2026-10-28T16:15:00Z
description: "End-to-end proof of the built stdio server against real Keycloak and a fake Inio API, an opt-in live suite, a CI integration job, and a verified Claude Desktop session"
type: Summary
about: "inio-mcp"
---

# Phase 1 Plan 03: Integration Tests and Claude Desktop Summary

**The built `dist/` server, spawned over stdio, gets a real token from Keycloak 26.8.1 and serves `get_invoice` from a fake Inio API. Ten integration tests cover the token flow, caching, redaction, error mapping and clean stderr. They run in CI with no secrets. An opt-in live suite passes against the test environment. Claude Desktop answered an invoice question with PII redacted.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~1.5h |
| Tasks | 3 of 3 + 2 checkpoints |
| Tests | 316 unit, 10 integration (~17 s incl. container), 2 live |
| Commits | `89c9da3` (task 1), `a9ecd20` (tasks 2–3) |
| PR | https://github.com/dnmitev/iniomcp/pull/3 (check + integration green) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Real token flow | Pass | Token endpoint and realm issuer forms; Bearer JWT from the `mcp-it` client; wrong credentials give the auth error; one token request across calls |
| AC-2: Built server over stdio, real HTTP | Pass | By id and by number; NOT_FOUND with correlationId; NETWORK_ERROR for an unreachable API; stderr is JSON only, with no secret and no token signature |
| AC-3: Fixture fidelity | Pass | Same keys and nesting as a real invoice; values synthetic (`*.example` domains, zeroed IBAN, placeholder UUIDs) |
| AC-4: Opt-in live suite | Pass | Skipped without INIO_LIVE (exit 0); 2/2 green with INIO_LIVE=1 and the local .env |
| AC-5: CI | Pass | `integration` job runs after `check` on ubuntu-latest with no secrets; the live suite is not in CI |
| AC-6: Claude Desktop | Pass | Approved by the user at the human-verify checkpoint |

## Verification Results

- `npm run lint && npm run typecheck && npm test && npm run build`: exit 0, 316 tests passed
- `npm run test:integration`: 10/10 passed locally; CI `integration` job succeeded
- `npm run test:live`: skipped by default; 2/2 passed with INIO_LIVE=1
- Fixture grep for emails, URLs and IBANs: only synthetic values

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Fake node:http API, not Prism | The spec's 200 schemas nest the envelope; Prism would return the wrong shape | Requests are not validated against the spec; the live suite guards fixture drift |
| Keycloak 26.8.1 pinned | Reproducible error codes (`unauthorized_client`) | Bump deliberately |
| `test:integration` and `test:live` build first | Tests exercise `dist/`, the shipped artifact | A few seconds slower |

## Deviations from Plan

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 1 | Local lint only |
| Scope additions | 1 | `.env.example` documents INIO_LOG_LEVEL, INIO_LIVE, INIO_LIVE_INVOICE_NUMBER |
| Deferred | 0 | - |

**Auto-fixed:** `prettier --check .` failed locally on `.claude/settings.local.json`. The file is ignored by git through the global gitignore, but Prettier still checks it. Added it to `.prettierignore`. CI was not affected.

No src/ changes were needed: the integration tests found no bugs.

## Next Phase Readiness

**Ready:**
- Each new read tool in Phase 2 adds a fake API route, a synthetic fixture and an integration case.
- Live suite available for pre-release checks (Phase 3 release workflow).

**Concerns:**
- Fixtures can drift from the real API; run the live suite before releases.
- About 2,245 tokens per invoice; field trimming in Phase 2 is still high value.

**Blockers:** None

---
*Phase: 01-foundation, Plan: 03*
*Completed: 2026-10-28*
