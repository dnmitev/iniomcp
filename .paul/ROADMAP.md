---
description: "inio-mcp — milestone and phase structure"
type: Roadmap
about: "inio-mcp"
---

# Roadmap: inio-mcp

## Overview

From an empty repo to a publicly installable MCP server: foundation and one working tool, then all read tools, then packaging and release to npm/GHCR, then opt-in write tools, then hardening of the shared HTTP mode.

## Current Milestone

**v0.2 Audit Quick Wins** (0.2.0)
Status: 🚧 In Progress
Phases: 1 of 2 complete
Focus: Make the privacy and safety claims true, and close the pre-auth memory issue, at minimal cost. Source: AEGIS audit `aegis-iniomcp-20261030` remediation roadmap (R1, R4, R5, R7).

| Phase | Name | Plans | Status | Completed |
|-------|------|-------|--------|-----------|
| 6 | HTTP auth and write outcomes | 2/2 | ✅ Complete | 2026-10-30 |
| 7 | Docs and install trust | TBD | Not started | - |

### Phase 6: HTTP auth and write outcomes ✅

Focus: TDD loop. R4: check the bearer token before the request body is read (`src/http.ts:53-54`), set an explicit body cap, warn on non-loopback bind, drain on shutdown (F-04-007, F-04-004, F-01-006). R5: append `uncertainOutcome` to non-GET errors with status 0 or ≥ 500 in `src/inio-client.ts`, remove per-tool duplicates, and treat a resolved write with an unexpected shape as success plus a note (F-04-002, F-00-003).
Plans: 06-01 (R4, auth before body; RSS +298 MB → flat), 06-02 (R5, all 11 write tools)

### Phase 7: Docs and install trust

Focus: R1: replace the "personal data is redacted" claim with the exact redacted-key list and add a README "Data protection" section (F-05-001 wording, F-05-002, F-05-003, F-05-006). R7: pin the package version and image digest in every README example, avoid plaintext secrets, pin the inspector, add a "Release model" note (F-04-008). Then release. Docs describe the behaviour after Phase 6.
Plans: TBD (defined during /paul:plan)

## Next Milestone

Candidates: R2 redaction (decided: consumer names only), R3 write allowlist and payment ceiling, R6 release-path hardening, R8 write attribution in logs, R10 docs drift, INIO_REVEAL_LINKS, get_invoice opt-in, per-user auth/OAuth (with R9), move to the `@inio` npm scope and company GitHub org.

## Completed Milestones

<details>
<summary>v0.1 Initial Release - 2026-10-30 (5 phases, 16 plans)</summary>

| Phase | Name | Plans | Completed |
|-------|------|-------|-----------|
| 1 | Foundation and walking skeleton | 3/3 | 2026-10-28 |
| 2 | Read tools | 3/3 | 2026-10-29 |
| 3 | Packaging and release | 3/3 | 2026-10-29 |
| 4 | Write tools (opt-in) | 4/4 | 2026-10-29 |
| 5 | HTTP hardening | 3/3 | 2026-10-30 |

Full detail: `.paul/milestones/v0.1-ROADMAP.md`

</details>

---
*Roadmap created: 2026-10-28*
*Last updated: 2026-10-30 — Phase 6 complete*
