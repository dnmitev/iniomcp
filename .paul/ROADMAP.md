---
description: "inio-mcp — milestone and phase structure"
type: Roadmap
about: "inio-mcp"
---

# Roadmap: inio-mcp

## Overview

From an empty repo to a publicly installable MCP server: foundation and one working tool, then all read tools, then packaging and release to npm/GHCR, then opt-in write tools, then hardening of the shared HTTP mode, then an easy integration layer deployable on Kubernetes.

## Current Milestone

**v0.4 Hosted Sign-in** (0.4.0)
Status: 🚧 In Progress
Phases: 0 of 2 complete
Focus: Let users without a local setup (product owners, product managers; mostly internal) reach the hosted server from Claude on the web, Desktop connectors and mobile by signing in with OAuth, without breaking the static-token clients. One instance = one tenant; provider details for the owner's environments stay outside the repo.

| Phase | Name | Plans | Status | Completed |
|-------|------|-------|--------|-----------|
| 12 | OAuth resource server | TBD | Not started | - |
| 13 | Deploy, connect, release | TBD | Not started | - |

### Phase 12: OAuth resource server

Focus: TDD loop. Protected Resource Metadata (RFC 9728) at `/.well-known/oauth-protected-resource` (and the `/mcp` path-suffixed variant); 401 with `WWW-Authenticate: Bearer resource_metadata=…`; JWT access tokens validated against the provider's JWKS (issuer, audience = resource URL, expiry, signature); static `MCP_AUTH_TOKEN` kept for header clients; signed-in user in tool-call and write logs; all opt-in. Research first: Claude OAuth client option (pre-registered, Client ID Metadata Document, DCR) and redirect URI, audience vs RFC 8707 `resource`, authorization server metadata discovery, refresh tokens.
Plans: TBD (defined during /paul:plan)

### Phase 13: Deploy, connect, release

Focus: Helm values for OAuth; Ingress and HTTPRoute also route the well-known path; generic OIDC provider guide (Keycloak example, placeholders only); Claude web/Desktop/mobile connector guide; private hand-over of the provider config (realm import plus Admin API job) for the owner's environments; owner signs in from claude.ai on the team instance; release.
Plans: TBD (defined during /paul:plan)

## Next Milestone

Candidates: request contract from the monorepo (export script, contract and coverage tests, Redocly change alarm, `registerTool` wrapper); hosted polish (customer-type cache TTL, `get_invoice` size opt-in); release trust (image provenance, npm publish from one build); later per-user write roles, multi-tenant hosting, ChatGPT.

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
*Last updated: 2026-11-03 — v0.4 Hosted Sign-in created*
