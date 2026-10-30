---
phase: 07-docs-install-trust
plan: 01
subsystem: docs
tags: [privacy, gdpr, supply-chain, readme, npm-provenance]

requires:
  - phase: 06-http-auth-write-outcomes
    provides: 256 KiB cap, auth before body, non-loopback warning, write-outcome wording
provides:
  - REDACTION_NOTE (src/redact.ts) in all 17 tool descriptions that mention INIO_REVEAL_PII
  - README Data protection, Release model, Pinning and verification sections
  - Install examples pinned to 0.4.0
  - Drift guard between the README redacted-field list and SENSITIVE_KEYS
affects: [07-02 release, R2 redaction, R6 release hardening]

key-files:
  created: [test/unit/descriptions.test.ts]
  modified: [src/redact.ts, src/tools/*.ts (17), README.md, package.json, test/unit/server.test.ts]

key-decisions:
  - "Redaction wording lives next to the key list (REDACTION_NOTE) so R2 changes both together"
  - "README pins 0.4.0 ahead of the release; main gets it only after 0.4.0 is published"
  - "Docs claim only what is verifiable today: npm provenance yes, image provenance no (R6)"

duration: ~1h
completed: 2026-10-30T12:40:00Z
description: "Tool descriptions and README now state exactly what is and is not redacted, add Data protection and Release model sections, and pin every install example to 0.4.0"
type: Summary
about: "inio-mcp"
---

# Phase 7 Plan 01: Privacy wording and install trust — Summary

**Tool descriptions and the README now say exactly what is and is not redacted, the README gains Data protection, Release model and Pinning sections, and every install example is pinned to 0.4.0 (AEGIS R1, R7).**

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: One accurate redaction sentence in every tool description | Pass | `REDACTION_NOTE` in 17 tools; "Personal data is redacted" is gone. Tests pin 8 redacted terms and 6 not-redacted terms. |
| AC-2: README states the same and adds Data protection | Pass | A marked field list, guarded both ways against `SENSITIVE_KEYS` and the email, phone and addressline patterns. The section covers LLM provider and DPA, write arguments, server stores nothing, logs, and error-message masking. |
| AC-3: Install examples pinned, secrets out of copy-paste | Pass | npx and Docker examples pinned to 0.4.0; the plaintext-secret note covers Claude Desktop, Cursor and Docker; the Claude Code example reads the token from an env var; inspector pinned to 2.11.0 (published 2026-10-14). |
| AC-4: Release model note | Pass | Releases are published only by the release workflow from tags; how to verify; the move to the `@inio` scope comes later. |
| AC-5: README matches Phase 6 | Pass | 256 KiB → 413; token checked before the body is read; non-loopback warning; write-outcome sentence (timeout, network, 5xx, accepted-unreadable). |
| AC-6: Nothing else changes | Pass | Unit 1895 (+14), integration 47, lint and typecheck clean. src changes are description text only. |

## Verification Results

| Check | Result |
|-------|--------|
| `npm run lint` / `npm run typecheck` | clean |
| `npm test` | 28 files, 1895 passed |
| `npm run test:integration` | 47 passed |
| `grep "Personal data is redacted"` src and README | none |
| Unpinned `npx -y @dnmitev/inio-mcp` or `:0.3` in README | none |
| `npm view @modelcontextprotocol/inspector@2.11.0 version` | 2.11.0 |
| Reviewer | APPROVE with 2 wording fixes applied from its own suggested text (round 2) |
| devops-reviewer | APPROVE (round 2) |

## Deviations from Plan

### Auto-fixed issues (review)

1. **Overclaim: `npm audit signatures` "proves this repository's workflow built it"** (reviewer and devops major). Reworded: the npmjs.com Provenance section shows the repository and workflow; `npm view … dist.attestations` gives the bundle URL; a runnable `npm audit signatures` recipe checks signatures and attestations.
2. **Overclaim: "verify by pinning the image digest"** (devops major). The text now says a digest pin stops the tag from moving and does not prove origin.
3. **Overclaim: "error messages hide the values of these fields"** (reviewer major, round 2). Corrected: they hide emails and the per-field error messages for the listed fields; other error text is passed through.
4. **Minors:** the Tools sentence contradicted the zip-code redaction; "nothing is published from a laptop" was policy, not enforced, and is now "published only by the workflow"; the secret warning was extended to Cursor and Docker; the transitive-dependency caveat was added; the REDACTION_NOTE text is now pinned in tests; import order fixed in 17 files.

### Scope additions
- `SENSITIVE_KEYS` is exported (read-only) for the drift guard.

### Deferred
- Image build provenance (`actions/attest-build-provenance`, `gh attestation verify`): goes to R6 with the other release-path hardening. The README does not claim it.
- npm-shrinkwrap for transitive pinning: noted in the README as a limit; revisit with R6.
- Merge gate: README pins 0.4.0, which is not yet published. Plan 07-02 must publish before main gets this README.

## Next Phase Readiness

**Ready:** 07-02 (release 0.4.0): version bump, CHANGELOG, devops review, tag, and post-release checks (`npm view @dnmitev/inio-mcp@0.4.0`, `docker buildx imagetools inspect ghcr.io/dnmitev/inio-mcp:0.4.0`).

**Blockers:** None.

---
*Phase: 07-docs-install-trust, Plan: 01*
*Completed: 2026-10-30*
