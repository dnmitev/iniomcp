---
description: "inio-mcp — milestone and phase structure"
type: Roadmap
about: "inio-mcp"
---

# Roadmap: inio-mcp

## Overview

From an empty repo to a publicly installable MCP server: foundation and one working tool, then all read tools, then packaging and release to npm/GHCR, then opt-in write tools, then hardening of the shared HTTP mode.

## Current Milestone

**v0.3 Integration Layer** (0.3.0, releases as 0.5.0)
Status: 🚧 In Progress
Phases: 3 of 4 complete
Focus: Make inio-mcp an easy, trustworthy integration layer for Claude and dev tools, and deployable by the team on EKS. Ease of use first: new safety settings are opt-in. Fixed `MCP_AUTH_TOKEN` stays the hosted auth (one instance = one tenant).

| Phase | Name | Plans | Status | Completed |
|-------|------|-------|--------|-----------|
| 8 | Redaction by customer type | 1/1 | ✅ Complete | 2026-11-02 |
| 9 | Docs overhaul | 1/1 | ✅ Complete | 2026-11-02 |
| 10 | Write bounds, attribution, release hygiene | 3/3 | ✅ Complete | 2026-11-02 |
| 11 | Helm chart and EKS | 1/2 | In progress | - |

### Phase 8: Redaction by customer type ✅

Focus: TDD loop. Reworked AEGIS R2. Businesses (`B`): no redaction except bearer invoice links (`pdfURL`, `digitalInvoiceURL`). Consumers (`C`): today's redaction plus name, address lines and city. `INIO_REVEAL_PII=true` still disables all. Invoices carry no `customerType`, so `get_invoice` looks the customer up (cached per customer number) and falls back to consumer rules on failure; `list_invoices` unchanged. Key-drift test (fixture keys vs reviewed list). `REDACTION_NOTE`, `SENSITIVE_KEYS` and README updated together.
Plans: 08-01 (done; SSN also redacted for B, `note` stays visible, mutation ≥ 95)

### Phase 9: Docs overhaul ✅

Focus: AEGIS R10 widened. Setup guide per client (Claude Desktop, Claude Code, VS Code, Cursor; stdio and hosted HTTP), "what you can ask" examples, drift fixes (PLANNING.md marked as original plan, tool count and version, 99.1% mutation claim, AS-7100 references).
Plans: 09-01 (done; guides in docs/setup, hosting, examples, troubleshooting, docs test)

### Phase 10: Write bounds, attribution, release hygiene ✅

Focus: Trimmed AEGIS R3 (opt-in `INIO_WRITE_TOOLS`, `INIO_MAX_PAYMENT_AMOUNT`, later-effect sentences, README guidance), R8 (write logging with `clientInfo`, 401 warn rate-limited, `onerror`, pause id in `acceptedUnreadable()`), small R6 parts (SHA-pinned actions, rulesets, image `docker run` smoke test).
Plans: 10-01 (allowlist + payment ceiling), 10-02 (write attribution), 10-03 (SHA pins, smoke test, rulesets)

### Phase 11: Helm chart and EKS

Focus: Chart in `charts/inio-mcp/` (version = app version) published as OCI to GHCR by `release.yml`. Deployment, Service, optional Ingress (ingress-nginx defaults) and optional Gateway API HTTPRoute side by side, `existingSecret` (hand-made or ESO), tcpSocket probes, restricted security context (read-only root verified), `preStop` sleep. ArgoCD in the owner's infra repo. kubeconform for ingress/route/both; kind smoke test. Release 0.5.0. Design input: `.paul/research/v0.3-helm-chart.md`.
Plans: TBD (defined during /paul:plan)

## Next Milestone

v0.4 Hosted (candidate): dedicated MCP Keycloak realm with BoP brokering, OAuth resource server, per-user write roles and audit, per-tenant credentials, multi-tenant hosting. Design input: `.paul/research/v0.4-hosted-auth.md`. Other candidates: INIO_REVEAL_LINKS, get_invoice opt-in, R6 pack-once publish and sandbox live gate. ChatGPT deferred until the hosted server has OAuth.

## Completed Milestones

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
*Last updated: 2026-11-02 — Phase 10 complete*
