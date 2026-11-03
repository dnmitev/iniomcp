---
description: "inio-mcp — milestone and phase structure"
type: Roadmap
about: "inio-mcp"
---

# Roadmap: inio-mcp

## Overview

From an empty repo to a publicly installable MCP server: foundation and one working tool, then all read tools, then packaging and release to npm/GHCR, then opt-in write tools, then hardening of the shared HTTP mode, then an easy integration layer deployable on Kubernetes, then OAuth sign-in for Claude's apps.

## Current Milestone

None. Next: /paul:discuss-milestone (candidates below).

## Next Milestone

Candidates:
- Tenant check (`MCP_OAUTH_REQUIRED_CLAIM`) before Inio hosts instances for external clients.
- Multi-tenant hosting: one instance per environment, with the tenant claim selecting the credentials.
- Request contract from the monorepo (export script, contract and coverage tests, Redocly change alarm, `registerTool` wrapper).
- Hosted polish (customer-type cache TTL, `get_invoice` size opt-in).
- Release trust (image provenance, npm publish from one build).
- Later: per-user write roles, ChatGPT.

## Completed Milestones

<details>
<summary>v0.4 Hosted Sign-in - 2026-11-03 (2 phases, 2 plans)</summary>

| Phase | Name | Plans | Completed |
|-------|------|-------|-----------|
| 12 | OAuth resource server | 1/1 | 2026-11-03 |
| 13 | Deploy, connect, release | 1/1 | 2026-11-03 |

Full detail: `.paul/milestones/v0.4-ROADMAP.md`

</details>

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
*Last updated: 2026-11-03 — v0.4 Hosted Sign-in complete*
