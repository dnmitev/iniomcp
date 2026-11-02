---
phase: 09-docs-overhaul
plan: 01
subsystem: docs
tags: [readme, setup-guides, mcp-remote, docs-test]

requires:
  - phase: 08-redaction-by-customer-type
    provides: Data protection section with business and consumer blocks
provides:
  - One setup guide per client (local, Docker, hosted)
  - Hosting guide, usage examples, troubleshooting table
  - Docs guard test (pins, relative links, absolute repo links)
affects: [11-helm-chart-and-eks, release 0.5.0]

key-files:
  created: [docs/setup/claude-desktop.md, docs/setup/claude-code.md, docs/setup/vscode.md, docs/setup/cursor.md, docs/hosting.md, docs/examples.md, test/unit/docs.test.ts]
  modified: [README.md, docs/PLANNING.md, src/tools/list-invoices.ts, src/tools/get-invoice-retry-attempts.ts, .paul/PROJECT.md]

key-decisions:
  - "Claude Desktop reaches a hosted server via mcp-remote@0.15.1 (0.16.0 was hours old); header as Authorization:${VAR} with the value in env"
  - "README links into docs/ are absolute GitHub URLs (npm ships README only)"
  - "Pins in README and docs/ must equal package.json (test); bump all at release"

duration: ~1h
completed: 2026-11-02T14:10:00Z
description: "Per-client setup guides, hosting guide, usage examples and a troubleshooting table; README slimmed to an overview; drift fixed and guarded by a docs test"
type: Summary
about: "inio-mcp"
---

# Phase 9 Plan 01: Docs overhaul Summary

**Each client (Claude Desktop, Claude Code, VS Code, Cursor) has one guide covering local, Docker and hosted setup; hosting and example prompts have their own pages; the README is an overview (315 → ~205 lines) with a troubleshooting table; a test keeps version pins and links honest.**

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: One setup guide per client | Pass | Claude Desktop hosted via mcp-remote@0.15.1, verified against a local HTTP server (initialize + tools/list); `claude mcp add` flags checked against `--help` |
| AC-2: Hosting guide | Pass | Shared HTTP server + Security moved intact; local-vs-hosted table; "Connect users" section |
| AC-3: Usage examples | Pass | Prompts by task with the tools used; write section with effects; "[redacted]" explainer |
| AC-4: README overview | Pass | Quick start, guide table, variables, tools, write tools, logs, troubleshooting, data protection; redacted-fields guard unchanged and green |
| AC-5: Drift fixed and guarded | Pass | PLANNING.md historical banner; AS-7100 in both workaround comments; no mutation-score claim found; docs test fails on a wrong pin and on a missing link target (both proven) |

## Verification

| Check | Result |
|-------|--------|
| `npm run lint`, `npm run typecheck` | Clean |
| `npm test` | 1978 passed (+4 docs tests) |
| Reviewer | 1 major, 5 minor; all fixed |

## Deviations from Plan

| Type | Count | Impact |
|------|-------|--------|
| Scope additions | 2 | README Troubleshooting table; docs test also checks absolute repo links |
| Review fixes | 6 | Accuracy |

Review fixes:
1. (major) examples.md promised a confirmation prompt for every write; now matches the README ("most clients ask … check auto-approve settings").
2. Troubleshooting: split wrong credentials ("Authentication failed (HTTP 401 …)") from `UNAUTHORIZED` (realm/API mismatch); added `NETWORK_ERROR`.
3. Docs test checks that absolute `github.com/dnmitev/iniomcp/blob/main/...` links point to existing files.
4. Examples list both tools where a lookup comes first (`get_customer` before `create_customer_pause`, `get_invoice` before `create_credit_invoice`).
5. Docker sections explain non-root, stdio, `-i`, `--rm` again (lost in the move).
6. PLANNING.md banner links fixed.

## Next Phase Readiness

**Ready:** Phase 10 (write bounds, attribution, release hygiene) can document new settings in README variables and the guides; Phase 11 adds a Kubernetes section to docs/hosting.md.

**Concerns:** Client UI paths (VS Code commands, Cursor settings, log locations) can change between client releases; re-check at each release.

**Blockers:** None

---
*Phase: 09-docs-overhaul, Plan: 01*
*Completed: 2026-11-02*
