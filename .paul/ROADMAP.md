---
description: "inio-mcp — milestone and phase structure"
type: Roadmap
about: "inio-mcp"
---

# Roadmap: inio-mcp

## Overview

From an empty repo to a publicly installable MCP server: foundation and one working tool, then all read tools, then packaging and release to npm/GHCR, then opt-in write tools, then hardening of the shared HTTP mode.

## Current Milestone

**v0.1 Initial Release** (v0.1.0)
Status: In progress
Phases: 2 of 5 complete

## Phases

| Phase | Name | Plans | Status | Completed |
|-------|------|-------|--------|-----------|
| 1 | Foundation and walking skeleton | 3/3 | ✅ Complete | 2026-10-28 |
| 2 | Read tools | 3/3 | ✅ Complete | 2026-10-29 |
| 3 | Packaging and release | 0/2 | Planning | - |
| 4 | Write tools (opt-in) | TBD | Not started | - |
| 5 | HTTP hardening | TBD | Not started | - |

## Phase Details

### Phase 1: Foundation and walking skeleton

**Goal:** Claude Desktop with the four env vars fetches a real invoice from a test environment.
**Depends on:** Nothing (first phase)
**Research:** Likely (Keycloak testcontainer realm, Prism vs Postman mock)

**Scope:**
- Toolchain: npm, TypeScript 7, oxlint/Prettier, Vitest, StrykerJS
- GitHub Actions `ci.yml`
- TDD agent team (`.claude/agents/`) and `/tdd` command
- Auth module, config validation, error mapping, generated API types
- stdio server with `get_invoice`
- Integration test with Keycloak + mock API containers

**Plans:**
- [x] 01-01: Toolchain, CI, agent team, config module
- [x] 01-02: Auth, API client, error mapping, get_invoice, stdio server
- [x] 01-03: Integration tests + Claude Desktop verification

### Phase 2: Read tools

**Goal:** Clients explore customers, invoices, pauses and retry attempts conversationally.
**Depends on:** Phase 1 (auth, client, server skeleton)
**Research:** Unlikely

**Plans:**
- [x] 02-01: Shared plumbing (query params, pagination, compact results) + list_customers, get_customer
- [x] 02-02: list_invoices, get_invoice withInherited, get_invoice_retry_attempts, customer pause tools
- [x] 02-03: 429 handling, integration + live coverage for all read tools, Claude Desktop check

### Phase 3: Packaging and release

**Goal:** 0.1.0 publicly installable via npx and Docker (`@dnmitev/inio-mcp` for now; `@inio` later).
**Depends on:** Phase 2
**Research:** Likely (npm trusted publishing, multi-arch GHCR)

**Plans:**
- [ ] 03-01: Package metadata, transport guard, package and Docker smoke tests, README snippets, CHANGELOG, security review
- [ ] 03-02: release.yml (live gate, npm trusted publishing with provenance, multi-arch GHCR, GitHub Release), first release

### Phase 4: Write tools (opt-in)

**Goal:** Clients who opt in can act on their data from the assistant.
**Depends on:** Phase 3
**Research:** Unlikely

### Phase 5: HTTP hardening

**Goal:** A team can safely share one HTTP instance.
**Depends on:** Phase 3
**Research:** Likely (MCP OAuth protected-resource metadata)

---
*Roadmap created: 2026-10-28*
*Last updated: 2026-10-29 after Phase 2*
