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
| Version | 0.3.1 |
| Status | v0.1 complete (0.3.1); next milestone not defined |
| Last Updated | 2026-10-30 |

## Requirements

### Core Features

- Authenticate with `client_credentials` (`INIO_CLIENT_ID`, `INIO_CLIENT_SECRET`, `INIO_AUTH_URL`, `INIO_URL`), cache and refresh the token
- Read tools: customers, customer pauses, invoices, invoice retry attempts (by id or number)
- Opt-in write tools behind `INIO_ALLOW_WRITES` (customers, pauses, invoices, credit invoices, payments)
- PII redaction by default (`INIO_REVEAL_PII` to disable)
- Distributed as npm `@dnmitev/inio-mcp` (`@inio` later) and a GHCR Docker image, over stdio or Streamable HTTP

### Validated (Shipped)
- ✓ `client_credentials` auth with token cache and refresh (tested against real Keycloak) — Phase 1
- ✓ `get_invoice` by id or number over stdio — Phase 1
- ✓ PII redaction by default — Phase 1
- ✓ Claude Desktop fetches a real invoice with the four env vars — Phase 1
- ✓ Read tools: list_customers, get_customer, list_customer_pauses, get_customer_pause, list_invoices, get_invoice (withInherited, includeWorkflowSettings), get_invoice_retry_attempts — Phase 2
- ✓ Pagination (limit/offset, nextOffset), summary fields in lists, compact detail results — Phase 2
- ✓ 429 handling: one retry honoring Retry-After (≤5 s), then RATE_LIMITED — Phase 2
- ✓ Clients explore customers, invoices, pauses and retry attempts in Claude Desktop — Phase 2
- ✓ npm `@dnmitev/inio-mcp` (stdio) with provenance; `npx -y @dnmitev/inio-mcp` works on a clean machine — Phase 3
- ✓ Docker image `ghcr.io/dnmitev/inio-mcp` (stdio, non-root, amd64 + arm64) — Phase 3
- ✓ Tag-driven release with live gate, trusted publishing, GitHub Releases — Phase 3
- ✓ Request timeout (30 s default) with a clear TIMEOUT result — Phase 3 (0.1.2)
- ✓ Opt-in write tools behind INIO_ALLOW_WRITES (10): customer pauses (create/update/cancel), invoice due date and stop-until dates, update_customer, reset_invoice_stage, create/match credit invoices, create_payment, create_customer — Phase 4
- ✓ Writes attributed to `inio-mcp` in audit fields; accepted writes never reported as failed; uncertain outcomes tell the model to check before retrying — Phase 4

- ✓ Shared HTTP server: `MCP_TRANSPORT=http` on `/mcp` behind a static bearer token (`MCP_AUTH_TOKEN`), Origin check, one Inio token shared across requests — Phase 5
- ✓ Docker HTTP mode with graceful shutdown; README setup for Claude Code, Cursor and VS Code; 0.3.0 released — Phase 5

- ✓ Distribution emails capped at 150 characters; npm audit clean — Phase 5 (0.3.1)

### Active (In Progress)
- None (v0.1 milestone complete)

### Planned (Next)
- Move to the `@inio` npm scope and the company GitHub org when they exist
- Per-user tokens or MCP OAuth for the HTTP server, only if teams ask

### Out of Scope
- Internal MCP for dev/QA/business (DB access, internal services) — separate future project
- Bulk `PATCH /customers` and `PUT` variants — PATCH covers updates; bulk LLM updates too risky
- Role/permission handling — the public API has none; `INIO_ALLOW_WRITES` is the write guard
- `reverse_payment` — the public API exposes no paymentAllocationId (payment id is not one; live probe 2026-10-29)
- `create_invoice` in v0.1 — sends to the end customer at once and needs full calcInput (revisit after usage)
- Health endpoint for HTTP mode — would be the only unauthenticated route; discovered during v0.1 (add if an orchestrator needs it)
- `credit_loss`/`cancelled` payments and other non-curated transaction types — until asked for

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
| Lists return curated summary fields; details are compacted (empties dropped before redaction) | Token budget (invoice list item ~9 KB raw → ~72 tokens) | 2026-10-28 | Active |
| Sort/order curated enums validated locally | API answers bad values with HTTP 500 | 2026-10-28 | Active |
| Upstream bug workarounds in code (invoice status sent as repeated key; retry attempts limit only) | API 500s on single status; page ignored | 2026-10-28 | Active — report upstream |
| workflowsSettings opt-in via includeWorkflowSettings | Large, but answers stage distribution/fee questions | 2026-10-28 | Active |
| QA and mutation-tester agents on Sonnet | Token cost; reviewer and mutation gate keep quality | 2026-10-28 | Active |
| npm `@dnmitev/inio-mcp` (personal scope) until `@inio` exists | No company npm org yet | 2026-10-29 | Active |
| 0.1.x stdio only; HTTP with auth in Phase 5 | Never expose an unauthenticated HTTP endpoint | 2026-10-29 | Done (0.3.0) |
| Invoice links (pdfURL, digitalInvoiceURL) and error-message emails redacted by default | Bearer links bypass field redaction | 2026-10-29 | Active |
| Releases by tag via release.yml: live gate, npm trusted publishing, multi-arch GHCR | No long-lived tokens; provenance | 2026-10-29 | Active |
| devops-reviewer agent (Sonnet) for all CI/CD and release changes | Supply-chain and release safety | 2026-10-29 | Active |
| Write safety = INIO_ALLOW_WRITES + destructive annotations + echo; no confirm flag | Clients confirm via annotations; no upstream roles | 2026-10-29 | Active |
| Writes never fail after a 2xx; status 0/≥500 = uncertain with check-before-retry hint | Payments have no idempotency; avoid double credits/payments | 2026-10-29 | Active |
| Safe defaults: no redistribution, no credit-note distribution, curated payment types, explicit full payment | Nothing reaches end customers or moves money unless asked | 2026-10-29 | Active |
| Tenant clientId from the token's inio_client_id claim | No extra config | 2026-10-29 | Active |
| senior-developer agent on Sonnet (medium effort) | Patterns settled; reviewer stays on Opus | 2026-10-29 | Active |
| HTTP auth = one static bearer token (≥32 printable-ASCII chars), constant-time compare; one instance = one tenant; no OAuth in v0.1 | All common clients accept a fixed header; spec makes auth optional; no token passthrough | 2026-10-30 | Active |
| Origin allowlist by hostname (SDK helper); auth before Origin | Bearer is the barrier; Origin is the DNS-rebinding layer | 2026-10-30 | Active |
| @modelcontextprotocol/node (toNodeHandler) for the Node bridge | Official adapter; streaming handled | 2026-10-30 | Active |
| Docker image binds 0.0.0.0, stdio default; no health endpoint; SDK body limit 4 MB | Token still required; no unauthenticated route | 2026-10-30 | Active |

## Success Metrics

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Mutation score | ≥ 80 break, 90 target | ≥ 90 on every changed file through v0.1 | Met |
| Unit + integration tests | all green in CI | 1788 unit + 47 integration + 11 Docker green | Met |
| First real answer | Claude Desktop fetches a real invoice | Verified 2026-10-28 | Met |
| Public install | `npx -y @dnmitev/inio-mcp` works on a clean machine | 0.3.0 verified 2026-10-30 (stdio and HTTP); 0.3.1 published with provenance | Met |

## Tech Stack / Tools

| Layer | Technology | Notes |
|-------|------------|-------|
| Runtime | Node 24, TypeScript 7 | ESM, NodeNext; Node runs .ts directly in dev |
| MCP | `@modelcontextprotocol/server` 2.x, `@modelcontextprotocol/node` | stdio and Streamable HTTP |
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
*Last updated: 2026-10-30 after v0.1 Initial Release*
