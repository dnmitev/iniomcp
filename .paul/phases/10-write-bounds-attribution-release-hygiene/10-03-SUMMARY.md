---
phase: 10-write-bounds-attribution-release-hygiene
plan: 03
subsystem: ci-release
tags: [github-actions, sha-pinning, rulesets, docker, smoke-test]

provides:
  - actions/* pinned by SHA in ci.yml and release.yml
  - Release image smoke test (amd64, HTTP 401/200) before the multi-arch push
  - Rulesets: main (no deletion, no force-push), v* tags (no deletion, no move)
affects: [11-helm-chart-and-eks release 0.5.0]

key-decisions:
  - "Pins: checkout v7.0.1 3d3c42e5, setup-node v7.1.0 949feb24, cache v6.1.0 55cc8345 (all ≥ 2 weeks old); Dependabot bumps them"
  - "Smoke-test a separate amd64 load build, then push multi-arch (same Dockerfile and commit, BuildKit cache reused); arm64 not run"
  - "Rulesets without bypass actors; a bad tag fix means disabling the rule briefly"

duration: ~40min
completed: 2026-11-02T21:00:00Z
description: "SHA-pinned actions, a pre-push image smoke test, and rulesets protecting main and release tags"
type: Summary
about: "inio-mcp"
---

# Phase 10 Plan 03: Release hygiene Summary

**All workflow actions are pinned by commit SHA, the release job runs the image (401 without token, initialize 200 with token) before pushing anything, and GitHub rulesets stop `main` from being force-pushed or deleted and `v*` tags from being moved or deleted.**

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Actions pinned | Pass | No `uses:` without a 40-char SHA and version comment; SHAs verified against tags by devops-reviewer |
| AC-2: Image run before push | Pass | Smoke step verified locally on image 0.4.0: good image exit 0, forced mismatch exit 1, container removed both times; first CI run at the 0.5.0 release |
| AC-3: Rulesets | Pass | `main` (id 26362023) and `release tags` (id 26362024) active; main has deletion + non_fast_forward; other branches unaffected |
| AC-4: Reviewed | Pass | devops-reviewer APPROVE; minors applied |

## Deviations from Plan

1. **Review minors applied:** trap set before `docker run`; explicit "did not start listening within 30 s" error; `persist-credentials: false` on all ci.yml checkouts.
2. **Accepted:** the pushed image is a second (cache-reused) build of the same commit, and arm64 is not run. Building once and retagging is possible later.

## Next Phase Readiness

**Ready:** Phase 11 release (0.5.0) exercises the smoke test and runs under the new rulesets (tag push still allowed).

**Concerns:** First real run of the smoke step is the 0.5.0 release; if it fails the image is not pushed and the release stops before the GitHub Release.

**Blockers:** None

---
*Phase: 10-write-bounds-attribution-release-hygiene, Plan: 03*
*Completed: 2026-11-02*
