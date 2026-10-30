# inio-mcp: Design and Plan

> Public Model Context Protocol (MCP) server that lets Inio clients connect AI assistants to their own Inio data through the official Inio REST API, authenticated with their OAuth2 client credentials.

**Stack:** TypeScript 7 (Node 24, ESM), `@modelcontextprotocol/sdk`, npm, Vitest, StrykerJS, oxlint. No database. Distributed via npm (`@inio/mcp`) and a GHCR Docker image. CI on GitHub Actions.
**License:** Apache-2.0

---

## Problem Statement

Inio clients increasingly work inside AI assistants. Getting Inio data into those assistants today means writing a custom integration against the REST API. `inio-mcp` is a ready-made, installable MCP server: set four environment variables, add it to Claude Desktop, Cursor or VS Code, and ask questions such as "which invoices for customer 1042 are still open?" or "show the retry attempts for invoice INV-2291".

- **Audience:** Inio clients (developers and finance/operations users).
- **First 5 minutes:** set the env vars, add the server to the assistant config, look up an invoice by number, get a correct answer.

---

## Tech Stack

| Layer              | Choice                                                                                                                | Rationale                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Language / runtime | TypeScript (NodeNext), Node 24                                                                                        | Most mature MCP SDK; `npx` gives zero-install for clients                        |
| MCP                | `@modelcontextprotocol/sdk`: stdio (default) and Streamable HTTP                                                      | stdio for local assistants; HTTP for self-hosted shared instances                |
| API types          | `openapi-typescript` generated from [`openapi/inio.json`](../openapi/inio.json), `openapi-fetch` client               | Types only, tiny runtime                                                         |
| Validation         | `zod`, strict schemas (no unknown keys)                                                                               | The API gateway rejects unknown query parameters                                 |
| Auth               | OAuth2 `client_credentials` token fetch + in-memory cache, refreshed before expiry                                    | A few dozen lines; no OIDC library needed                                        |
| Unit tests         | Vitest                                                                                                                | ESM/TS native; first-class Stryker runner                                        |
| Integration tests  | Vitest + Testcontainers: Keycloak (realm with one confidential client) and a mock API generated from the OpenAPI spec | Real token flow and HTTP without live environments                               |
| Live smoke tests   | Vitest suite against an Inio test environment, run only before release                                                | Test environments are not available around the clock                             |
| Mutation testing   | StrykerJS, incremental on PRs, full nightly                                                                           | Test-quality gate                                                                |
| Lint / format      | oxlint (type-aware, TS 7 native) + Prettier                                                                           | ESLint's TypeScript parser does not support TS 7                                 |
| Build              | `tsc` (TypeScript 7) emits `dist/`; Node 24 runs `src/*.ts` directly in development                                   | No bundler; Node cannot strip types inside node_modules, so the package ships JS |

---

## Data Model

No database. Entities come from the Inio REST API.

| Entity        | Key fields                                                                            | Relationships                                                      |
| ------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Customer      | id, customerNo, customerName, customerType, address, emails, SSN, orgNr               | has many Invoices and CustomerPauses                               |
| CustomerPause | id, customerId, scope, status, startAt, endAt, reason                                 | belongs to Customer                                                |
| Invoice       | id, invoiceNo, customerId, customerNo, currency, amounts, stage/status, dueDate, IBAN | belongs to Customer; has Payments, credit invoices, retry attempts |
| Payment       | amount, paidDate, invoice reference                                                   | belongs to Invoice                                                 |
| CreditInvoice | invoiceNo, creditInvoiceNo, amount                                                    | matched to an Invoice, or unmatched                                |

- **Response envelope:** `{ correlationId, success, status, result }`; lists return `result: { data, limit, offset, total }`. Tools unwrap `result` and return compact data plus pagination info.
- **Errors:** `{ code, message, correlationId, i18nKey, fieldErrors, status }`, mapped to MCP tool errors that keep `code`, `message` and `correlationId`.
- **Pagination:** `limit` / `offset`. Tools default to `limit=25`, capped at 100.
- **PII:** customers include `SSN`; invoices include `IBAN`. Redacted by default.

---

## API Surface (MCP tools)

### Auth

- **MCP to Inio:** OAuth2 `client_credentials` against the client's Inio API realm. The token carries the client's tenant; tenant isolation is enforced by Inio. The gateway validates every token by introspection, so revoked credentials fail immediately.
- The public API has no role-based permissions: any valid client token can call every endpoint. `INIO_ALLOW_WRITES` is therefore the write guard.
- **Assistant to MCP:** stdio needs no auth (local process). HTTP mode: see Security.

### Configuration

| Env var              | Required | Default              | Purpose                                                                           |
| -------------------- | -------- | -------------------- | --------------------------------------------------------------------------------- |
| `INIO_CLIENT_ID`     | yes      |                      | API client id                                                                     |
| `INIO_CLIENT_SECRET` | yes      |                      | API client secret                                                                 |
| `INIO_AUTH_URL`      | yes      |                      | Token endpoint; a realm issuer URL gets `/protocol/openid-connect/token` appended |
| `INIO_URL`           | yes      |                      | API gateway base URL incl. `/v1`; must be `https` except localhost                |
| `INIO_ALLOW_WRITES`  | no       | `false`              | Registers write tools                                                             |
| `INIO_REVEAL_PII`    | no       | `false`              | Disables PII redaction                                                            |
| `MCP_TRANSPORT`      | no       | `stdio`              | `stdio` or `http`                                                                 |
| `PORT` / `HOST`      | no       | `3000` / `127.0.0.1` | HTTP mode bind                                                                    |

### Tools

Hand-curated rather than one tool per endpoint. The spec offers most operations both by id and by number; each tool accepts `id` **or** `number`.

| Tool                                                                        | Endpoints                                                               | Gate  | Annotation      |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----- | --------------- |
| `list_customers`                                                            | GET /customers                                                          | read  | readOnlyHint    |
| `get_customer`                                                              | GET /customers/{id}, /customers/by-number/{customerNo}                  | read  | readOnlyHint    |
| `list_customer_pauses`                                                      | GET /customers/{id}/pauses                                              | read  | readOnlyHint    |
| `get_customer_pause`                                                        | GET /customers/{id}/pauses/{pauseId}                                    | read  | readOnlyHint    |
| `list_invoices`                                                             | GET /invoices                                                           | read  | readOnlyHint    |
| `get_invoice` (`withInherited?`)                                            | GET /invoices/{id}, by-number, /{id}/with-inherited                     | read  | readOnlyHint    |
| `get_invoice_retry_attempts`                                                | GET /invoices/{id}/retry-attempts, by-number                            | read  | readOnlyHint    |
| `create_customers`                                                          | POST /customers                                                         | write | destructiveHint |
| `update_customer`                                                           | PATCH /customers/{id}, by-number                                        | write | destructiveHint |
| `create_customer_pause` / `update_customer_pause` / `cancel_customer_pause` | POST/PATCH pauses, POST …/cancel                                        | write | destructiveHint |
| `create_invoices`                                                           | POST /invoices                                                          | write | destructiveHint |
| `create_credit_invoice`                                                     | POST /invoices/{id}/credit-invoice, by-number, /invoices/credit-invoice | write | destructiveHint |
| `match_credit_invoice`                                                      | POST …/match-credit-invoice                                             | write | destructiveHint |
| `update_invoice_due_date`                                                   | POST …/update-due-date                                                  | write | destructiveHint |
| `update_invoice_stop_until_dates`                                           | POST …/update-stop-until-dates                                          | write | destructiveHint |
| `reset_invoice_stage`                                                       | POST /invoices/{id}/reset-stage                                         | write | destructiveHint |
| `create_payment` / `reverse_payment`                                        | POST /payments, /payments/reverse-payment                               | write | destructiveHint |

Bulk `PATCH /customers` and the `PUT` variants are deliberately left out: PATCH covers updates, and bulk updates driven by an LLM are too risky.

---

## Deployment Strategy

### Local development

| Service          | Runtime                                                         | Purpose                        |
| ---------------- | --------------------------------------------------------------- | ------------------------------ |
| inio-mcp         | Node 24, `tsx --watch`                                          | server under development       |
| keycloak (tests) | Testcontainers                                                  | real `client_credentials` flow |
| mock API (tests) | Prism or Postman mock from the OpenAPI spec, via Testcontainers | contract-faithful responses    |

`.env` is gitignored; `.env.example` is committed without values. `npm run inspect` (added with the server in Phase 1) runs it under the MCP Inspector.

### CI / Release (GitHub Actions)

| Workflow               | Trigger                                 | Jobs                                                                                                                                     |
| ---------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`               | PR, push to main                        | lint + typecheck, unit, integration (Testcontainers), Stryker incremental (break 80), build                                              |
| `mutation-nightly.yml` | nightly                                 | full Stryker run, report artifact                                                                                                        |
| `release.yml`          | tag `v*`, run manually in working hours | live smoke against a test environment, npm publish with provenance (trusted publishing), multi-arch Docker image to GHCR, GitHub Release |

Live-environment secrets live only in a protected GitHub environment and are never available to fork PRs.

### Install targets

- `npx -y @inio/mcp` (stdio), with config snippets for Claude Desktop, Cursor and VS Code in the README.
- `docker run -i -e INIO_… ghcr.io/<owner>/inio-mcp` (stdio), or `MCP_TRANSPORT=http`.

---

## Security Considerations

- **Authz:** the server acts as one Inio client with that client's credentials and adds no privilege. Read-only by default; write tools are not registered unless `INIO_ALLOW_WRITES=true`, and carry `destructiveHint` so assistants ask for confirmation. Write tool descriptions state their consequences.
- **Secrets:** read from env only; never logged, never echoed in errors or tool output; token held in memory. Logs go to stderr (stdout is the stdio protocol channel). Tests assert the secret never appears in logs or errors.
- **Transport:** refuse non-`https` `INIO_URL` except localhost.
- **HTTP mode:** an instance serves that client's data to anyone who can reach its port. Default bind is `127.0.0.1`. Since 0.3.0 every request needs a static bearer token (`MCP_AUTH_TOKEN`), and foreign browser origins are refused; TLS belongs to a reverse proxy.
- **PII / GDPR:** tool output goes to third-party LLM providers. SSN, IBAN and similar fields are redacted by default; responses are trimmed to useful fields.
- **Input validation:** strict zod schemas (no unknown keys, enums from the spec, length limits); path parameters URL-encoded.
- **Prompt injection:** free-text fields from Inio data are returned as data. Write tools are the blast radius, which is why they are opt-in.
- **Rate limiting:** honor upstream 429 with bounded retry (max 2, respect `Retry-After`). On 401, refresh the token once, then fail.
- **Supply chain:** npm provenance, committed lockfile, Renovate/Dependabot, `npm audit` in CI, non-root minimal runtime image.

---

## Observability and Token Budget

- **Logs:** JSON lines (pino) on stderr only; stdout carries the MCP protocol. MCP clients capture stderr (Claude Desktop: `~/Library/Logs/Claude/mcp-server-*.log`). `INIO_LOG_LEVEL` (`info` default; `debug` adds every upstream call and token cache hit/miss). Secrets, tokens and authorization headers are redacted by the logger.
- **Per tool call:** one `tool call` line with `tool`, `durationMs`, `outcome`, `responseBytes` and `approxTokens` (bytes / 4), so the context cost of each tool is measured, not guessed. Upstream failures log a `warn` line with status, code and correlationId.
- **Token budget:** tool results return compact JSON text only (no duplicate `structuredContent`); write tools are not registered by default, which keeps tool definitions out of every request; Phase 2 adds field trimming and pagination caps.
- **OpenTelemetry:** deferred to the HTTP deployment mode, where a collector is realistic.

---

## UI/UX Needs

No UI of its own; the MCP client is the UI. UX means tool ergonomics:

- `verb_noun` tool names; one-sentence descriptions with when-to-use guidance; examples in parameter descriptions.
- Compact results: unwrapped `result`, trimmed fields, `structuredContent` with output schemas.
- Actionable errors, e.g. `NOT_FOUND: Invoice INV-1 could not be found (correlationId …)` or `auth failed: check INIO_CLIENT_ID / INIO_CLIENT_SECRET`.
- Optional MCP prompts: `open-invoices-for-customer`, `customer-overview`.

---

## Integration Points

| Integration               | Type                  | Purpose             | Auth                           |
| ------------------------- | --------------------- | ------------------- | ------------------------------ |
| Inio API realm (Keycloak) | OAuth2 token endpoint | access tokens       | client credentials             |
| Inio API gateway          | REST                  | all tool data       | Bearer token                   |
| npmjs.com                 | registry              | publish `@inio/mcp` | GitHub OIDC trusted publishing |
| GHCR                      | container registry    | publish image       | `GITHUB_TOKEN`                 |

Failure modes: auth server down gives a clear auth error without retry storms; API 5xx returns an error with correlationId; token expiry mid-session refreshes transparently.

---

## Development Workflow: TDD Agent Team

Claude Code agents in `.claude/agents/`, driven by a `/tdd <story>` command:

| Agent                         | Role                                                                                          | Writes                            |
| ----------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------- |
| `senior-qa-automation`        | turns acceptance criteria into failing unit and integration tests                             | `test/**` only                    |
| `senior-developer`            | minimum code to pass, then refactor                                                           | `src/**` only                     |
| `reviewer`                    | reviews the diff for correctness, security (secret leakage, PII, write gating) and simplicity | review comments                   |
| `mutation-tester` (adversary) | runs Stryker on changed files and sends surviving mutants back as challenges                  | Stryker config, challenge reports |

Loop: QA (red), developer (green, refactor), reviewer, mutation tester, then back to QA while the changed-file score is below 90. CI enforces a hard floor of 80, so the gate cannot be bypassed locally.

---

## Phase Breakdown

### Phase 1: Foundation and walking skeleton

- **Build:** toolchain (npm, TypeScript 7, oxlint/Prettier, Vitest, StrykerJS); `ci.yml`; agent team and `/tdd`; auth module (token fetch, cache, `INIO_AUTH_URL` normalisation); generated OpenAPI types; config validation; stdio server with `get_invoice`.
- **Testable:** unit tests for token cache, refresh and expiry, config validation, error mapping; integration test with Keycloak and mock API containers; Stryker at least 80 on the auth module; one full `/tdd` loop run by the agent team.
- **Outcome:** Claude Desktop with the four env vars fetches a real invoice from a test environment.

### Phase 2: Read tools

- **Build:** remaining read tools; pagination; response trimming; PII redaction; error mapping; 429/401 handling; optional MCP prompts.
- **Testable:** per-tool unit tests (schema strictness, envelope unwrapping, redaction); integration tests against the mock; local live smoke suite; Stryker at least 80, target 90.
- **Outcome:** a client can explore customers, invoices, pauses and retry attempts conversationally.

### Phase 3: Packaging and release

- **Build:** `tsc` build to `dist/` with bin shebang; `@inio` npm org and trusted publishing; non-root multi-arch Dockerfile with stdio and HTTP; `release.yml`; README client snippets; changelog tooling; security review.
- **Testable:** `npx -y @inio/mcp@next` works on a clean machine; Docker works in stdio and HTTP mode; release blocked when live smoke fails.
- **Outcome:** `@inio/mcp` 0.1.0 publicly installable.

### Phase 4: Write tools (opt-in)

- **Build:** write tools registered only with `INIO_ALLOW_WRITES=true`; `destructiveHint`; consequence-stating descriptions.
- **Testable:** write tools absent by default; integration tests per write tool; live smoke on a dedicated test tenant (create customer, create invoice, payment, reverse).
- **Outcome:** clients who opt in can act on their data from the assistant.

### Phase 5 (later): HTTP hardening

- **Build:** optional bearer auth or per-request token passthrough for shared HTTP deployments; MCP OAuth protected-resource metadata.
- **Testable:** unauthenticated HTTP requests rejected; per-request tokens isolate tenants.
- **Outcome:** a team can safely share one HTTP instance.

---

## Quality Gates

| Gate                     | Threshold                 | When                             |
| ------------------------ | ------------------------- | -------------------------------- |
| Unit + integration tests | all passing               | every PR                         |
| Mutation score (Stryker) | break 80, high 90         | PR (incremental), nightly (full) |
| Lint + typecheck         | clean                     | every PR                         |
| Secret-leak tests        | pass                      | every PR                         |
| `npm audit`              | no high/critical          | every PR                         |
| Security review          | no high/critical findings | each release                     |
| Live smoke               | pass                      | each release                     |

---

## Design Decisions

1. **TypeScript**: most mature MCP SDK and StrykerJS; `npx` zero-install distribution.
2. **Public GitHub repo with GitHub Actions**: clients must be able to reach the code and packages.
3. **npm `@inio/mcp` and GHCR image**: npx for local assistants, Docker for self-hosting; trusted publishing with provenance, no long-lived npm token.
4. **`client_credentials` via `INIO_CLIENT_ID` / `INIO_CLIENT_SECRET` / `INIO_AUTH_URL` / `INIO_URL`**: matches how Inio issues API clients.
5. **Hand-curated tools**: the spec has no operationIds and duplicates operations by id and number; seven read tools beat 33 noisy ones.
6. **Read-only by default, writes behind `INIO_ALLOW_WRITES`**: the public API has no role checks, so this is the write guard.
7. **PII redacted by default**: tool output reaches third-party LLMs.
8. **Strict input schemas**: the gateway rejects unknown query parameters.
9. **Testcontainers (Keycloak + OpenAPI mock) for integration; live tests only before release**: test environments are not always up, and fork PRs must never see credentials.
10. **Mutation thresholds break 80 / high 90**, enforced in CI and by the mutation-tester agent.
11. **Stateless**: no database or cache service; in-memory token cache only.
12. **Apache-2.0**: free commercial use, explicit patent grant, no trademark rights for forks, contribution terms without a CLA.

---

## Open Questions

1. Owner of the `@inio` npm org, and final GitHub org after transfer.
2. Prism or Postman mock for integration tests.
3. Which fields beyond SSN and IBAN count as PII for redaction (names, addresses, emails, phone numbers)?
4. ~~HTTP mode auth model~~ Answered in Phase 5: a static bearer token in v0.1 (all common clients accept a fixed header). MCP OAuth with protected-resource metadata later, if asked for. Token passthrough is ruled out by the MCP spec.
5. Dedicated, resettable test tenant for live write smoke tests (Phase 4).
