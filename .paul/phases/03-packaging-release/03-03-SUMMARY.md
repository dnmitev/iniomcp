---
phase: 03-packaging-release
plan: 03
subsystem: api
tags: [timeout, abortsignal, resilience, release]

requires:
  - phase: 03-packaging-release (03-02)
    provides: release workflow, 0.1.1
provides:
  - INIO_REQUEST_TIMEOUT_MS (default 30 s) for API and token requests, TIMEOUT tool error
  - 0.1.2 released (timeout, Node 26 image, updated release actions)
affects: [phase 4 write tools (same client)]

key-files:
  modified: [src/config.ts, src/inio-client.ts, src/auth.ts, src/server.ts, test/unit/config.test.ts, test/unit/inio-client.test.ts, test/unit/auth.test.ts, test/unit/server.test.ts, test/live/server.live.test.ts, README.md, CHANGELOG.md]

key-decisions:
  - "Default 30 s, not 60 s: MCP clients commonly time out tool calls at 60 s"
  - "Per-attempt AbortSignal.timeout; a stalled body counts as a timeout"

duration: ~1.5h
completed: 2026-10-29
description: "30 s request timeout for every Inio API and token call with a clear TIMEOUT result, released as 0.1.2 together with the Node 26 image"
type: Summary
about: "inio-mcp"
---

# Phase 3 Plan 03: Request Timeout and Release 0.1.2 Summary

**Every Inio API and token request now aborts after `INIO_REQUEST_TIMEOUT_MS` (default 30 s). Each attempt gets its own timeout, including the 401 and 429 retries, and a stalled response body counts too. The tool then answers `TIMEOUT: The Inio API did not respond within <n> s.` instead of hanging. Released as 0.1.2 with the Node 26 image and the updated release actions.**

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Configurable timeout | Pass (amended) | Default 30000 instead of 60000 (user decision after review); 1000–600000 |
| AC-2: API requests time out | Pass | Per attempt; stalled body → TIMEOUT; other errors unchanged |
| AC-3: Token requests time out | Pass | Own message, no secret or cause |
| AC-4: Wiring, docs, live suite | Pass | Live suite passes a 120 s MCP client timeout per call; README documents the worst case (~5 × timeout + 5 s) |

## Verification Results

- 809 unit tests, integration 21/21, package 16/16, live 13/13
- Mutation (`--force`): auth 100, inio-client 100, config 98.3 (known equivalents)
- Release run v0.1.2 green on the first attempt
- npm `latest` 0.1.2 with SLSA provenance; GHCR `0.1.2` = `0.1` = `latest` (same digest); GitHub Release 0.1.2 is Latest
- Clean machine: `npx -y @dnmitev/inio-mcp` on `node:24-alpine` and `docker run ghcr.io/dnmitev/inio-mcp:latest` report 0.1.2 with 7 tools

## Deviations from Plan

| Type | Count | Impact |
|------|-------|--------|
| Spec amendment | 1 | Default 60 s → 30 s (MCP client 60 s timeout) |
| Review-driven | 2 | Stalled-body timeout; live suite client timeout |

## Related Work in This Plan's Window

- v0.1.2-rc.1 exercised the release path after Dependabot action majors (#9–#14, #20–#22) and the Node 26 switch (#23); its first attempt failed the live gate on 30 s test timeouts while the test environment's invoice endpoints were slow, which motivated this plan.
- Dependabot now skips majors for the node image and @types/node (#19); the image runs Node 26, npm supports Node ≥ 24, CI tests both.

## Next Phase Readiness

**Ready:** Phase 4 (opt-in write tools) on a stable 0.1.2 base.

**Blockers:** None

---
*Phase: 03-packaging-release, Plan: 03*
*Completed: 2026-10-29*
