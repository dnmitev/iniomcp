---
phase: 05-http-hardening
plan: 03
subsystem: maintenance
tags: [validation, refactor, stryker, npm-audit, release]

requires:
  - phase: 05-http-hardening (05-02)
    provides: 0.3.0, deferred-issue list
provides:
  - Distribution emails capped at 150 characters
  - One Logger type (src/logger.ts)
  - MUTATE env for per-file mutation runs
  - qs override (npm audit 0)
  - Release v0.3.1
affects: [v0.1 milestone close]

tech-stack:
  added: []
  patterns:
    - "MUTATE=src/a.ts,src/b.ts npm run mutation -- --force for targeted mutation"

key-files:
  created: []
  modified: [src/tools/customer-fields.ts, src/logger.ts, src/auth.ts, src/http.ts, src/server.ts, src/inio-client.ts, src/tool-logging.ts, src/tools/*.ts (imports), stryker.config.mjs, package.json, .github/workflows/release.yml, CHANGELOG.md, README.md]

key-decisions:
  - "Deferred triage: ENEEDAUTH closed; five quick items done here; the rest wait on demand or upstream"
  - "qs pinned via npm overrides (dev-only) instead of waiting for a Stryker release"

duration: ~1h
completed: 2026-10-30T09:00:00+02:00
description: "Deferred cleanup: 150-character email cap, one Logger type, per-file mutation runs, qs advisory fixed, image label; release 0.3.1"
type: Summary
about: "inio-mcp"
---

# Phase 5 Plan 03: Deferred cleanup, release 0.3.1 Summary

**This plan cleared the five quick deferred items and released them as 0.3.1. The milestone now closes with only upstream-blocked and on-demand items deferred.**

## Performance

| Metric | Value |
|--------|-------|
| Tasks | 4 of 4 (Task 1 via TDD, Task 2 refactor, Task 3 tooling, release checkpoint) |
| Tests | 1788 unit (from 1776), 47 integration |
| Mutation | customer-fields.ts 93.9 (2 equivalent survivors), logger.ts 100; this run mutated 2 of 177 files |
| PRs | #34 (records, `a67a29a`), #35 (05-03, `9738aca`) |
| Release | Run 41027767125: all 5 jobs passed |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Emails ≤ 150 characters | Pass | 151 characters is rejected, with the field named and no API call; 150 is accepted; null still clears. The reviewer reverted the cap and saw all 6 tests fail |
| AC-2: One Logger type | Pass | Types live in logger.ts; only logger.ts and index.ts import from pino; no assertion changes |
| AC-3: Per-file mutation | Pass | `Found 2 of 177 file(s) to be mutated` |
| AC-4: No advisories; label | Pass | `npm audit` 0; `npm ls --omit=dev qs` empty; the GHCR label reads "(stdio and HTTP)" |
| AC-5: 0.3.1 released | Pass | npm latest 0.3.1 with SLSA provenance (the registry took a few minutes to show it); GHCR 0.3.1, 0.3 and latest on one digest for amd64 and arm64; GitHub Release v0.3.1 |

## Deviations from Plan

| Type | Count | Impact |
|------|-------|--------|
| Scope additions | 2 | The Logger move needed import changes in all 19 src/tools files (imports only); MUTATE entries are trimmed (devops minor) |
| Skipped minors | 1 | The email tests don't assert the "150" wording; the 150-character cases already show length is the only failure reason |

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Prettier failed lint on stryker.config.mjs after the trim edit | `prettier --write` before the commit |
| npm registry showed 0.3.0 for a few minutes after the publish | The publish log showed `+ @dnmitev/inio-mcp@0.3.1`; waited until the registry showed it |

## Next Phase Readiness

**Ready:** v0.1 is complete. Deferred items are either blocked upstream (Stryker TS checker, AS-7101) or wait on demand (INIO_REVEAL_LINKS, health endpoint, per-user tokens or OAuth, get_invoice size).

**Blockers:** None

---
*Phase: 05-http-hardening, Plan: 03*
*Completed: 2026-10-30*
