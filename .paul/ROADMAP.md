---
description: "inio-mcp — milestone and phase structure"
type: Roadmap
about: "inio-mcp"
---

# Roadmap: inio-mcp

## Overview

From an empty repo to a publicly installable MCP server: foundation and one working tool, then all read tools, then packaging and release to npm/GHCR, then opt-in write tools, then hardening of the shared HTTP mode, then an easy integration layer deployable on Kubernetes.

## Current Milestone

None. Next: /paul:discuss-milestone (v0.4 Hosted candidate below).

## Next Milestone

v0.4 Hosted (candidate): dedicated MCP Keycloak realm with BoP brokering, OAuth resource server, per-user write roles and audit, per-tenant credentials, multi-tenant hosting. Design input: `.paul/research/v0.4-hosted-auth.md`. Other candidates: INIO_REVEAL_LINKS, get_invoice opt-in, R6 pack-once publish and sandbox live gate. ChatGPT deferred until the hosted server has OAuth.

## Completed Milestones

<details>
<summary>v0.3 Integration Layer - 2026-11-03 (4 phases, 7 plans)</summary>

| Phase | Name | Plans | Completed |
|-------|------|-------|-----------|
| 8 | Redaction by customer type | 1/1 | 2026-11-02 |
| 9 | Docs overhaul | 1/1 | 2026-11-02 |
| 10 | Write bounds, attribution, release hygiene | 3/3 | 2026-11-02 |
| 11 | Helm chart and EKS | 2/2 | 2026-11-03 |

Full detail: `.paul/milestones/v0.3-ROADMAP.md`

</details>

<details>
<summary>v0.2 Audit Quick Wins - 2026-10-30 (2 phases, 4 plans)</summary>

| Phase | Name | Plans | Completed |
|-------|------|-------|-----------|
| 6 | HTTP auth and write outcomes | 2/2 | 2026-10-30 |
| 7 | Docs and install trust | 2/2 | 2026-10-30 |

Full detail: `.paul/milestones/v0.2-ROADMAP.md`

</details>

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
*Last updated: 2026-11-03 — v0.3 Integration Layer complete*
