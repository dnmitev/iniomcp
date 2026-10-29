---
phase: 03-packaging-release
plan: 02
subsystem: infra
tags: [release, github-actions, npm-trusted-publishing, provenance, ghcr, multi-arch, dependabot]

requires:
  - phase: 03-packaging-release (03-01)
    provides: publishable package, Docker image, CI smoke jobs
provides:
  - Tag-driven release.yml (verify → live gate → npm + GHCR → GitHub Release)
  - "@dnmitev/inio-mcp 0.1.1 on npm (latest) with SLSA provenance"
  - ghcr.io/dnmitev/inio-mcp 0.1.1 / 0.1 / latest for linux/amd64 and linux/arm64
  - GitHub Releases v0.1.1 (Latest) and v0.1.1-rc.1 (pre-release)
  - Dependabot for github-actions, docker and npm; digest-pinned base image
affects: [phase 4 write tools (released through the same workflow)]

tech-stack:
  added: []
  patterns:
    - "Releases are a tag: vX.Y.Z or vX.Y.Z-rc.N on main; the workflow refuses anything else"
    - "Publishing waits for verify + live gate on the same commit; two environment approvals"
    - "Only the highest final version moves npm latest, image latest and GitHub Latest"
    - "Reruns are idempotent: existing npm versions and image tags are skipped"

key-files:
  created: [.github/workflows/release.yml, .github/dependabot.yml]
  modified: [Dockerfile, package.json, package-lock.json, CHANGELOG.md, README.md, test/package/package.test.ts]

key-decisions:
  - "npm bootstrap: manual 0.1.0-rc.0; a second manual publish made 0.1.0, so the first CI release is 0.1.1"
  - "Environment release: tag rule v*, required reviewer; client id/secret as secrets, URLs as variables"
  - "One release concurrency group; legacy npm tag for older finals"

duration: ~3.5h
started: 2026-10-29T13:00:00Z
completed: 2026-10-29T16:30:00Z
description: "Tag-driven release workflow with live gate, npm trusted publishing and multi-arch GHCR; 0.1.1 released from CI with provenance and verified on clean machines and in Claude Desktop"
type: Summary
about: "inio-mcp"
---

# Phase 3 Plan 02: Release Workflow and First Release Summary

**Pushing a `v*` tag now releases the server. The workflow verifies the tag and runs all suites. A live gate in a protected environment then needs approval. After that it publishes to npm through trusted publishing (with provenance), pushes a multi-arch image to GHCR, and creates the GitHub Release. 0.1.1 is out: `npx -y @dnmitev/inio-mcp` and `ghcr.io/dnmitev/inio-mcp:0.1` both serve the seven tools on a clean machine.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~3.5h (including npm account setup) |
| Tasks | Task 1, decision, human-action, Task 2 (rc.1), human-verify, Task 3 (0.1.1) |
| Release runs | v0.1.1-rc.1: attempt 1 npm ENEEDAUTH, attempt 2 green; v0.1.1: green first time |
| PRs | #8 (workflow + Greptile fixes), #16 (rc.1), #17 (0.1.1) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Release workflow | Pass | Five jobs; verify checks tag = version, tag on main, dated CHANGELOG for finals; live gate in `release` |
| AC-2: Dependencies kept current | Pass | Dependabot for actions, docker, npm; base image pinned by digest |
| AC-3: First release | Pass (amended to 0.1.1) | rc.1 on `next`, 0.1.1 on `latest`, both with SLSA provenance; GHCR `0.1.1-rc.1`, `0.1.1`, `0.1`, `latest`, amd64 + arm64, public; GitHub Release 0.1.1 is Latest |
| AC-4: Claude Desktop from npm | Pass | Approved by the user on `@dnmitev/inio-mcp@next` (rc.1, same code as 0.1.1) |

## Verification Results

- `npm view @dnmitev/inio-mcp dist-tags`: `latest 0.1.1`, `next 0.1.1-rc.1`; provenance `https://slsa.dev/provenance/v1` on both CI versions
- GHCR tags: `0.1.1-rc.1`, `0.1.1`, `0.1`, `latest`; `latest` is an index of linux/amd64 and linux/arm64
- Clean machine: `npx -y @dnmitev/inio-mcp` in `node:24-alpine` reports server 0.1.1 and 7 tools; `docker run -i ghcr.io/dnmitev/inio-mcp:0.1` likewise; rc image checked on amd64 and arm64
- GitHub Releases: `0.1.1` (Latest), `0.1.1-rc.1` (Pre-release)

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Manual npm bootstrap (rc.0) | npm requires the package to exist before a trusted publisher can be attached | 0.0.0-stage (npm placeholder) and 0.1.0-rc.0 exist |
| First CI release is 0.1.1 | A second manual publish released 0.1.0 (from main efffde8, no provenance); versions cannot be reused | 0.1.0 stays as a valid release; CHANGELOG notes it |
| URLs as environment variables | Not secret; the user configured them that way | `vars.INIO_AUTH_URL`, `vars.INIO_URL` in release.yml |
| One release concurrency group + `newest` guard | Greptile P1: latest tags could move backward | Older finals publish to npm `legacy` and get no `latest` |
| Fail-closed image lookup after login | Greptile P2 | Only "not found" / "manifest unknown" allows a push |

## Deviations from Plan

| Type | Count | Impact |
|------|-------|--------|
| Version shift | 1 | 0.1.0 → 0.1.1 for the CI release (plan amended) |
| Review-driven changes | 7 | DevOps review (registry-url removed, E404-only check, latest=auto → newest guard, image skip, persist-credentials) and Greptile (concurrency, fail-closed lookup) |
| Setup issues | 3 | npm 2FA missing; environment rule created as branch not tag; trusted publisher mismatch (fixed by the user) |

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| `npm publish` E403: 2FA required | User enabled 2FA (auth-and-writes) |
| Second manual publish released 0.1.0 | Accepted; first CI release 0.1.1 |
| Environment rule `v*` was a branch rule | User recreated it as a tag rule; checked via API before tagging |
| rc.1 npm job ENEEDAUTH | Trusted publisher settings corrected; "Re-run failed jobs" published without rebuilding the image |
| Dependabot opened 7 major-bump PRs at once | Deferred until after 0.1.1 |

## Next Phase Readiness

**Ready:**
- Phase 3 complete. Phase 4 (opt-in write tools) can ship through the same tag flow.

**Concerns:**
- Dependabot PRs #9–#15 are major bumps (node 26 image, @types/node 26, docker actions v4–v7, actions/cache v6). Ignore majors for node and @types/node; review the action bumps one by one with devops-reviewer.
- `next` still points at 0.1.1-rc.1 (harmless; moves with the next rc).
- The package name moves to `@inio` later, which renames it for users.

**Blockers:** None

---
*Phase: 03-packaging-release, Plan: 02*
*Completed: 2026-10-29*
