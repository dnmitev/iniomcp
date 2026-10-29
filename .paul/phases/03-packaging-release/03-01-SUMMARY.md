---
phase: 03-packaging-release
plan: 01
subsystem: infra
tags: [npm, docker, packaging, ci, security-review, redaction]

requires:
  - phase: 02-read-tools
    provides: seven read tools, redaction, 429 handling
provides:
  - npm package @dnmitev/inio-mcp 0.1.0 (public, provenance), verified by installing the packed tarball
  - Non-root stdio Docker image (node:24.14-alpine, 176 MB) with a CI build-and-smoke job
  - MCP_TRANSPORT=http rejected (stdio only)
  - README client snippets (Claude Desktop, Cursor, VS Code, Docker), CHANGELOG.md
  - Security review; pdfURL and error-message emails redacted
  - devops-reviewer agent (Sonnet) for CI/CD and release changes
affects: [03-02 release workflow and first publish]

tech-stack:
  added: []
  patterns:
    - "Package contents checked by an allowlist test on the installed tarball"
    - "Docker smoke test spawns the image through the MCP client like a real client would"
    - "Third-party GitHub Actions pinned to commit SHAs; .dockerignore is an allow-list"
    - "CI/CD and release changes reviewed by devops-reviewer in addition to reviewer"

key-files:
  created: [Dockerfile, .dockerignore, CHANGELOG.md, test/package/package.test.ts, test/package/docker.test.ts, .claude/agents/devops-reviewer.md]
  modified: [package.json, package-lock.json, src/config.ts, src/redact.ts, src/tools/result.ts, .github/workflows/ci.yml, README.md, .claude/commands/tdd.md, test/unit/config.test.ts, test/unit/server.test.ts, test/unit/redact.test.ts, test/unit/result.test.ts, test/unit/get-invoice.test.ts]

key-decisions:
  - "Personal npm scope @dnmitev/inio-mcp for 0.1.0"
  - "0.1.0 stdio only; HTTP with auth in Phase 5"
  - "pdfURL and digitalInvoiceURL redacted by default (bearer links, verified public); INIO_REVEAL_LINKS deferred"
  - "Error-message emails redacted even with INIO_REVEAL_PII=true"

duration: ~3h
started: 2026-10-29T09:00:00Z
completed: 2026-10-29T12:00:00Z
description: "Releasable npm package and Docker image, both smoke-tested in CI, with client docs, changelog, a security review and invoice-link redaction"
type: Summary
about: "inio-mcp"
---

# Phase 3 Plan 01: Packaging, Docker Image, Docs and Security Review Summary

**The server is ready to release but not yet released. `@dnmitev/inio-mcp` 0.1.0 packs to a tarball that installs cleanly and serves the seven tools. The non-root Docker image does the same over `docker run -i`. CI checks both on every PR. The README documents installation for four clients, and CHANGELOG.md holds the 0.1.0 entry. The security review found no High or Medium issues, and two hardening items the user accepted are in: invoice links and error-message emails are redacted.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~3h |
| Tasks | 3 of 3 (Task 1 and AC-6 through /tdd; Task 2 lead + QA; Task 3 docs and review) |
| Tests | 765 unit, 21 integration, 16 package + 7 docker, 13 live |
| Mutation (`--force`) | redact 100, result 100, config 97.9 (2 equivalents); whole tree 99.0 |
| Commits | `891ba96` (plan), `f4fe3d0`, `65bc1d2`, `f098bf0`, `122cc16` (devops agent), `408d3bf` (DevOps fixes) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Transport guard | Pass (reworded) | Message without a version: "MCP_TRANSPORT=http is not supported yet; only stdio is available." |
| AC-2: npm package | Pass | Allowlist of tarball entries; no packed file mentions `@inio/mcp`; checked failing against the old package.json |
| AC-3: Docker image | Pass | 176 MB, uid 1000 `node`, prod deps only; smoke test fails 6/7 against a plain node image |
| AC-4: Docs and changelog | Pass | Claude Desktop, Cursor, VS Code (secret prompted once), Docker; CHANGELOG date set at tag (03-02) |
| AC-5: Security review | Pass | No High/Medium; `npm audit --omit=dev` clean |
| AC-6: Links and error texts redacted (added) | Pass | Live check: `pdfURL` and `digitalInvoiceURL` open without login |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Redact pdfURL like digitalInvoiceURL | Both open the invoice without login (verified live); they would bypass field redaction | Links only with INIO_REVEAL_PII=true; INIO_REVEAL_LINKS deferred |
| Error-message emails always redacted | Error text is rarely needed with PII; safer default | Documented in CHANGELOG |
| devops-reviewer agent on Sonnet | User request: senior DevOps review for all delivery changes | Runs next to reviewer in /tdd and on lead-written CI/CD changes |
| Pin third-party actions to SHAs, .dockerignore allow-list | DevOps review (major + minor) | Dependabot needed to keep pins fresh (03-02) |

## Deviations from Plan

| Type | Count | Impact |
|------|-------|--------|
| Scope additions | 3 | AC-6 redaction; devops-reviewer agent; CI timeouts and SHA pins |
| Deferred | 2 | Base image digest pin + Dependabot (03-02); INIO_REVEAL_LINKS |

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| npm trusted publishing: unclear whether the package must exist before configuring it | Search found only community docs; resolve in 03-02 from npm's docs |
| A newly added agent is only callable after a session restart | First DevOps review ran as a Sonnet general agent with the agent's instructions |
| Test environment was down overnight during the link check | Re-ran in the morning |

## Next Phase Readiness

**Ready:**
- 03-02 adds release.yml (live gate in a protected `release` environment, npm trusted publishing with provenance, multi-arch GHCR, GitHub Release) and the first publish.

**Concerns:**
- First publish of a new npm package with trusted publishing may need a manual bootstrap step.
- Personal scope means a package rename for users when moving to `@inio`.

**Blockers:** None

---
*Phase: 03-packaging-release, Plan: 01*
*Completed: 2026-10-29*
