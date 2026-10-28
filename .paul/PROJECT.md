---
description: "Inio clients can query (and optionally act on) their own Inio data from any AI assistant with four env vars and npx"
type: Project
about: "inio-mcp"
---

# inio-mcp

## What This Is

A public, installable Model Context Protocol (MCP) server over the official Inio REST API. Inio clients set their OAuth2 client credentials and API URL, add the server to Claude Desktop, Cursor or VS Code, and ask about customers, invoices, pauses, retry attempts and payments. Read-only by default; write tools are opt-in.

## Core Value

Inio clients can query (and optionally act on) their own Inio data from any AI assistant with four env vars and `npx`, without writing an integration.

## Current State

| Attribute | Value |
|-----------|-------|
| Type | Application |
| Version | 0.0.0 |
| Status | Phase 1 complete |
| Last Updated | 2026-10-28 |

## Requirements

### Core Features

- Authenticate with `client_credentials` (`INIO_CLIENT_ID`, `INIO_CLIENT_SECRET`, `INIO_AUTH_URL`, `INIO_URL`), cache and refresh the token
- Read tools: customers, customer pauses, invoices, invoice retry attempts (by id or number)
- Opt-in write tools behind `INIO_ALLOW_WRITES` (customers, pauses, invoices, credit invoices, payments)
- PII redaction by default (`INIO_REVEAL_PII` to disable)
- Distributed as npm `@inio/mcp` (stdio) and a GHCR Docker image (stdio + Streamable HTTP)

### Validated (Shipped)
- ✓ `client_credentials` auth with token cache and refresh (tested against real Keycloak) — Phase 1
- ✓ `get_invoice` by id or number over stdio — Phase 1
- ✓ PII redaction by default — Phase 1
- ✓ Claude Desktop fetches a real invoice with the four env vars — Phase 1

### Active (In Progress)
- [ ] Phase 2: Read tools

### Planned (Next)
- Phase 3: Packaging and release
- Phase 4: Write tools (opt-in)
- Phase 5: HTTP hardening

### Out of Scope
- Internal MCP for dev/QA/business (DB access, internal services) — separate future project
- Bulk `PATCH /customers` and `PUT` variants — PATCH covers updates; bulk LLM updates too risky
- Role/permission handling — the public API has none; `INIO_ALLOW_WRITES` is the write guard

## Target Users

**Primary:** Inio clients' developers and finance/operations users working in AI assistants.

## Context

**Technical Context:** Spec at `openapi/inio.json` (OpenAPI 3.0, 33 operations, no operationIds, paired by-id/by-number operations). Responses wrapped in `{ correlationId, success, status, result }`; lists paginated by `limit`/`offset`. The gateway validates tokens by introspection and rejects unknown query parameters. Full design: `docs/PLANNING.md`.

## Constraints

### Technical Constraints
- `INIO_URL` must be https (except localhost)
- Strict input schemas; no unknown query params
- stdout reserved for the stdio protocol; logs to stderr
- Live test environments are shut down overnight; live tests run only before release
- Fork PRs must never receive credentials

### Business Constraints
- Public repo (currently `dnmitev/iniomcp`, to be transferred to a company org)
- `@inio` npm org not yet created

### Compliance Constraints
- GDPR: tool output reaches third-party LLMs; redact PII by default

## Key Decisions

| Decision | Rationale | Date | Status |
|----------|-----------|------|--------|
| TypeScript, Node 24 | Mature MCP SDK and StrykerJS; npx distribution | 2026-10-28 | Active |
| Hand-curated tools | No operationIds; avoid 33 noisy tools | 2026-10-28 | Active |
| Read-only default, `INIO_ALLOW_WRITES` | No upstream roles; smallest blast radius | 2026-10-28 | Active |
| PII redacted by default | GDPR, third-party LLMs | 2026-10-28 | Active |
| Testcontainers Keycloak + node:http fake API with synthetic fixtures (not an OpenAPI mock); live tests opt-in, pre-release only | Spec envelopes are wrong; envs off overnight; no creds in PRs | 2026-10-28 | Active |
| Stryker break 80 / high 90 | Test-quality gate, adversarial mutation agent | 2026-10-28 | Active |
| Apache-2.0 | Free use, patent grant, trademark protection | 2026-10-28 | Active |
| TypeScript 7 + npm + tsc, no Yarn/tsup; oxlint instead of ESLint | Simplicity, future-proof; typescript-eslint and Stryker TS checker lack TS 7 support | 2026-10-28 | Active |
| MCP SDK v2, no OpenAPI codegen, text-only results, pino to stderr | Current SDK; codegen needs TS 5 API; saves context tokens | 2026-10-28 | Active |

## Success Metrics

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Mutation score | ≥ 80 break, 90 target | 98.3% | On track |
| Unit + integration tests | all green in CI | 316 unit + 10 integration green | Met |
| First real answer | Claude Desktop fetches a real invoice | Verified 2026-10-28 | Met |
| Public install | `npx -y @inio/mcp` works on a clean machine | - | Not started |

## Tech Stack / Tools

| Layer | Technology | Notes |
|-------|------------|-------|
| Runtime | Node 24, TypeScript 7 | ESM, NodeNext; Node runs .ts directly in dev |
| MCP | `@modelcontextprotocol/server` 2.x | stdio now; Streamable HTTP later |
| Validation | zod | strict schemas |
| API types | zod schemas per tool | no codegen (TS 7) |
| Tests | Vitest, Testcontainers | Keycloak + node:http fake API; opt-in live suite |
| Mutation | StrykerJS (vitest-runner) | incremental on PRs; no TS checker (no TS 7 JS API) |
| Build | tsc | emits dist/ for npm; no bundler |
| Lint | oxlint --type-aware + Prettier | TS 7 compatible |
| Package manager | npm | no Yarn |
| CI/CD | GitHub Actions | npm trusted publishing, GHCR |

## Links

| Resource | URL |
|----------|-----|
| Repository | https://github.com/dnmitev/iniomcp |
| Documentation | docs/PLANNING.md |

---
*PROJECT.md — Updated when requirements or context change*
*Last updated: 2026-10-28 after Phase 1*
