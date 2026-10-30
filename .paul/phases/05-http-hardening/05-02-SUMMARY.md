---
phase: 05-http-hardening
plan: 02
subsystem: infra
tags: [docker, graceful-shutdown, sigterm, dependabot, readme, release]

requires:
  - phase: 05-http-hardening (05-01)
    provides: MCP_TRANSPORT=http, startHttpServer with close(), HttpConfig
provides:
  - Graceful shutdown in HTTP mode (SIGTERM/SIGINT, exit 0, flushed log)
  - Docker HTTP mode (HOST=0.0.0.0, EXPOSE 3000)
  - README "Shared HTTP server" section; CHANGELOG 0.3.0
  - Release v0.3.0 (npm, GHCR multi-arch, GitHub Release)
affects: [v0.1 milestone close, @inio scope move]

tech-stack:
  added: []
  patterns:
    - "Signal handlers with process.on + a stopping guard + 2 s unref'd hard exit + logger.flush before exit"

key-files:
  created: []
  modified: [src/index.ts, src/config.ts, Dockerfile, .github/dependabot.yml, test/unit/http.test.ts, test/unit/config.test.ts, test/package/docker.test.ts, README.md, CHANGELOG.md, docs/PLANNING.md, package.json]

key-decisions:
  - "Health endpoint skipped: it would be unauthenticated; a TCP check works"
  - "Body-size limit left to the SDK (413 at 4 MB)"
  - "Image default HOST=0.0.0.0; the token is still required"
  - "MCP_AUTH_TOKEN limited to printable ASCII (Greptile, #32)"

duration: ~3h (with two checkpoints and the release)
completed: 2026-10-30T18:00:00+02:00
description: "Docker HTTP mode with clean shutdown, shared-server docs for Claude Code/Cursor/VS Code, and release 0.3.0"
type: Summary
about: "inio-mcp"
---

# Phase 5 Plan 02: Docker HTTP mode, docs, release 0.3.0 Summary

**0.3.0 is released. It can run as a shared HTTP server from npx or Docker, and stops cleanly on `docker stop`. The README shows teams how to set it up and connect Claude Code, Cursor and VS Code.**

## Performance

| Metric | Value |
|--------|-------|
| Tasks | 5 of 5 (Task 1 via TDD, Tasks 2–3 lead-written with devops review, 2 checkpoints) |
| Tests | 1776 unit (from 1768), 47 integration, Docker package 11 (from 7) |
| PRs | #32 (05-01, squash `c0fcda2`), #33 (05-02, squash `b2ce186`) |
| Release | Run 41024603969: verify, live, image, npm and release all passed |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: HTTP mode shuts down cleanly | Pass | SIGTERM, SIGINT and repeated signals each give exit 0 and one `server stopped` line; stdio registers no handlers |
| AC-2: Docker image serves HTTP | Pass | 401 without a token; 7 read tools with it; `docker stop` under 5 s with exit 0; stdio tests unchanged |
| AC-3: README setup | Pass | Config rows, "Shared HTTP server" section (npx, Docker, Claude Code, Cursor, VS Code, security), `:0.3` tag, CHANGELOG 0.3.0 |
| AC-4: 0.3.0 released | Pass | npm latest 0.3.0 with SLSA provenance; GHCR 0.3.0, 0.3 and latest on the same digest for amd64 and arm64; GitHub Release v0.3.0; clean `npx -y @dnmitev/inio-mcp@0.3.0` in HTTP mode gives 401, then `server stopped` on SIGTERM |
| Human check: Docker + Claude Code | Pass | Approved 2026-10-30 |

## Accomplishments

- A team can run one container per tenant and connect with a token, without anyone else holding the Inio client secret.
- `docker stop` exits right away instead of hitting the 10 s SIGKILL.
- `@modelcontextprotocol/*` packages now move together in Dependabot, majors included.

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| No health endpoint | It would be the only unauthenticated route; orchestrators can use a TCP check | Add one if someone asks |
| SDK handles the body limit | createMcpHandler already returns 413 above 4 MB | Documented in the README |
| `process.on` + `stopping` guard | With `once`, a second SIGTERM fell through to Node's default handler (Greptile) | Repeated signals are no-ops |
| Printable-ASCII tokens only | Non-ASCII tokens passed config but could never be sent in a header (Greptile) | New config error line |
| No Claude Desktop remote instructions | Not verified | Desktop users use the stdio setup |

## Deviations from Plan

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 5 | Two reviewer majors (double signal, unflushed log); three Greptile P2s (non-ASCII token, `once`, Dockerfile example port) |
| Scope additions | 1 | The non-ASCII token fix landed in 05-01 code (`src/config.ts`), outside this plan's boundary, via PR #32 |
| Deferred | 1 | Below |

**Auto-fixed issues:**
1. **Shutdown crash on a second signal or a failed close.** Fixed with a guard, `.catch`, flush before exit and a 2 s hard exit (reviewer).
2. **Last log line could be lost.** Fixed with `logger.flush(() => process.exit(0))` (reviewer).
3. **Non-ASCII MCP_AUTH_TOKEN accepted.** Fixed with a printable-ASCII check and 3 tests (Greptile #32, commit `033409d`).
4. **`process.once` let a repeated SIGTERM kill the process.** Fixed by switching to `process.on` (Greptile #33).
5. **Dockerfile example published the port on all interfaces.** It now uses `-p 127.0.0.1:3000:3000` (Greptile #33).

**Deferred:**
- release.yml: the OCI image description label still says "(stdio)". It only affects image metadata.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| The double-signal tests pass even without the fix (the signals coalesce) | Kept as smoke tests; the guard is correct by reading. One run on the old code did fail. |
| Squash-merging #32 left #33 carrying the original 05-01 commits | Rebased with `--onto origin/main`, force-pushed (own branch) and retargeted to main |

## Next Phase Readiness

**Ready:**
- Phase 5 and the v0.1 milestone are complete: stdio and shared HTTP, read and opt-in write tools, npm and GHCR.

**Concerns:**
- Static token only. Per-user tokens or MCP OAuth only if teams ask.
- The `release.yml` image label (above).

**Blockers:** None

---
*Phase: 05-http-hardening, Plan: 02*
*Completed: 2026-10-30*
