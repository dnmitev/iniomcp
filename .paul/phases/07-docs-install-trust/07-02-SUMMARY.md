---
phase: 07-docs-install-trust
plan: 02
subsystem: release
tags: [release, npm, ghcr, provenance]

requires:
  - phase: 07-docs-install-trust
    provides: README pinned to 0.4.0 (07-01)
provides:
  - "@dnmitev/inio-mcp@0.4.0 on npm (latest, SLSA provenance)"
  - "ghcr.io/dnmitev/inio-mcp:0.4.0 / 0.4 / latest (amd64 + arm64)"
  - GitHub Release v0.4.0
affects: [next milestone]

key-decisions:
  - "Merge → tag → publish back to back (release.yml requires the tag on main)"

duration: ~1h
completed: 2026-10-30T12:40:00Z
description: "0.4.0 released through the tag workflow to npm (with provenance) and GHCR (multi-arch); every README pin resolves"
type: Summary
about: "inio-mcp"
---

# Phase 7 Plan 02: Release 0.4.0 — Summary

**0.4.0 is released through the tag-triggered workflow: npm `latest` with SLSA provenance, GHCR `0.4.0`/`0.4`/`latest` on one multi-arch digest, and GitHub Release v0.4.0. Every README pin resolves.**

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Version and CHANGELOG ready | Pass | package.json and lockfile at 0.4.0 (version lines only); `## [0.4.0] - 2026-10-30` with Security, Changed and Documentation entries, and the 256 KiB note |
| AC-2: Clean branch, gates, devops review | Pass | Rebased onto origin/main, dropping 394c81c, which was identical to #37. Lint, typecheck, unit 1895, integration 47, Docker package 27, `npm audit` 0. devops-reviewer APPROVE |
| AC-3: Released through the workflow | Pass | PR #38 squash-merged as `1ddab79`; tag v0.4.0 on it; run 41054976393: verify, live, npm, image and release all succeeded |
| AC-4: README pins resolve | Pass | npm 0.4.0 is latest with a provenance attestation (`https://slsa.dev/provenance/v1`). `npm audit signatures`: 10 packages verified. `npx -y @dnmitev/inio-mcp@0.4.0` starts and prints the config error. GHCR multi-arch |

## Release record

| Item | Value |
|------|-------|
| PR | #38 (squash) → main `1ddab79` |
| Tag | `v0.4.0` (annotated, on `1ddab79`) |
| Release run | https://github.com/dnmitev/iniomcp/actions/runs/41054976393 |
| npm | `@dnmitev/inio-mcp@0.4.0`, dist-tag latest, sigstore log index 3593268611 |
| Image digest | `ghcr.io/dnmitev/inio-mcp@sha256:c7c188c13fc23b2ddefc2fbc7dddf304468b0072f08994304ca7bb466aa6dfcf` (0.4.0 = 0.4 = latest; linux/amd64, linux/arm64) |
| GitHub Release | https://github.com/dnmitev/iniomcp/releases/tag/v0.4.0 |

## Deviations from Plan

### PR review fixes (Greptile, 4/5, two P2s)

1. **The README Claude Code example used `$INIO_MCP_TOKEN` without saying how to set it.** Added `read -rs INIO_MCP_TOKEN`, which reads silently and keeps the token out of shell history.
2. **The idle keep-alive test requested `/other`, which is closed by the gate, so it never tested an idle connection.** QA rewrote it: an authenticated initialize over a keepAlive agent, with a free socket asserted before `close()`. The lead checked that it still passes with both `closeIdleConnections()` calls removed. That confirms those calls are redundant on Node ≥ 24 (`server.close()` already closes idle connections) and are kept only as belt and braces. Deferred: delete them.

### Issues encountered

| Issue | Resolution |
|-------|------------|
| `npm view …@0.4.0` returned E404 right after the npm job succeeded | Registry propagation ("may take a few minutes"); available after about 60 s |
| The 07-01 decision "main only after publish" conflicted with release.yml's tag-on-main rule | Corrected to merge → tag → publish back to back; the window was a few minutes |

## Next Phase Readiness

**Ready:** Phase 7 and milestone v0.2 Audit Quick Wins are complete. Next: `/paul:complete-milestone`, then `/paul:discuss-milestone`, with R2, R3, R6 and R8 as candidates.

**Blockers:** None.

---
*Phase: 07-docs-install-trust, Plan: 02*
*Completed: 2026-10-30*
