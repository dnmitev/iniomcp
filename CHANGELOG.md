# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.1] - 2026-10-30

### Fixed

- `create_customer` and `update_customer` reject distribution email addresses longer than 150 characters before calling the Inio API, as the API's own limit requires.

### Changed

- The Docker image description now says it serves stdio and HTTP.

## [0.3.0] - 2026-10-30

### Added

- Shared HTTP server: `MCP_TRANSPORT=http` serves Streamable HTTP on `/mcp` (`PORT`, default 3000; `HOST`, default 127.0.0.1). Every request needs `Authorization: Bearer <MCP_AUTH_TOKEN>`; the server refuses to start without a token of at least 32 characters. Browser requests from origins other than localhost or `MCP_ALLOWED_ORIGINS` get 403. All requests share one Inio access token.
- Docker image HTTP mode: `-e MCP_TRANSPORT=http -e MCP_AUTH_TOKEN -p 127.0.0.1:3000:3000`. The image binds `0.0.0.0` and exposes port 3000; stdio stays the default.
- In HTTP mode, SIGTERM and SIGINT close the server and exit cleanly, so `docker stop` returns at once.

### Changed

- `npm run dev` loads `.env`.

## [0.2.0] - 2026-10-29

### Added

- Opt-in write tools, registered only with `INIO_ALLOW_WRITES=true` and annotated as destructive: `create_customer_pause`, `update_customer_pause`, `cancel_customer_pause`, `update_invoice_due_date` (postpone only) and `update_invoice_stop_until_dates`. Writes are attributed to `inio-mcp` in Inio's audit fields.
- More opt-in write tools: `update_customer` (contact details and addresses only), `reset_invoice_stage` (no re-sending unless `redistribute: true`), `create_credit_invoice` (not sent to the end customer unless `distributionEnabled: true`) and `match_credit_invoice`.
- `create_payment` write tool for `direct_payment`, `good_will`, `bank` and `reminder_fee_waiver` payments. A full payment must be explicit (`fullPayment: true`). The client id comes from the access token. An accepted payment is never reported as failed, and uncertain outcomes say to check the invoice before retrying.
- `create_customer` write tool: one consumer (with SSN) or business (with orgNr and vatNo) per call, with the client id from the access token. A customerNo that already exists is rejected. With `INIO_ALLOW_WRITES=true` the server now has 18 tools.
- API validation errors list the affected fields; values of personal-data fields are redacted.

### Known limitations

- Not available: reversing a payment (the public API exposes no payment allocation ids) and creating invoices (they are sent to the end customer at once). Some assistants, Claude among them, decline to send an SSN, so consumer customers may need the Inio back office.

## [0.1.2] - 2026-10-29

### Added

- Request timeout for every Inio API and token request: 30 s by default, set with `INIO_REQUEST_TIMEOUT_MS` (1000–600000). A timeout returns `TIMEOUT: The Inio API did not respond within <n> s.` instead of leaving the tool call waiting.

### Changed

- Docker image runs on Node 26 LTS (`node:26.12-alpine`). The npm package still supports Node 24 and later; CI tests both.
- Release workflow on current versions of the GitHub and Docker actions; no npm cache in release jobs.

## [0.1.1] - 2026-10-29

First release built and published by the release workflow.

### Added

- npm provenance: the package is published from GitHub Actions through npm trusted publishing.
- Docker image `ghcr.io/dnmitev/inio-mcp` for linux/amd64 and linux/arm64, with provenance and SBOM attestations.

No changes to the tools since 0.1.0.

## [0.1.0] - 2026-10-29

First public release. Read-only, stdio only. Published manually, without npm provenance.

### Added

- Seven read tools over the Inio REST API:
  - `list_customers`, `get_customer`
  - `list_customer_pauses`, `get_customer_pause`
  - `list_invoices`, `get_invoice` (`withInherited`, `includeWorkflowSettings`), `get_invoice_retry_attempts`
- OAuth2 client-credentials authentication with token caching and a single retry on 401.
- Personal data redacted by default (IBAN, SSN, emails, phone numbers, addresses), including the invoice links `digitalInvoiceURL` and `pdfURL`, which open the invoice without login, and email addresses in API error messages; `INIO_REVEAL_PII=true` disables it for tool data (emails in error messages stay redacted).
- Compact results: list tools return summary fields with `limit`/`offset` paging and `nextOffset`; detail tools drop empty values; `workflowsSettings` is opt-in.
- HTTP 429 handling: one retry honoring `Retry-After` (at most 5 s), then a `RATE_LIMITED` error.
- JSON logs on stderr with one `tool call` line per call, including `approxTokens`.

### Known limitations

- Invoice `status` filters are sent as repeated query keys, because the Inio API answers a single or comma-separated status with HTTP 500.
- Retry attempts support `limit` only; the Inio API ignores paging for this endpoint.
- `MCP_TRANSPORT=http` is not supported yet (added in 0.3.0).
