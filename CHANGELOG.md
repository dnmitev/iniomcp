# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - Unreleased

First public release. Read-only, stdio only.

### Added

- Seven read tools over the Inio REST API:
  - `list_customers`, `get_customer`
  - `list_customer_pauses`, `get_customer_pause`
  - `list_invoices`, `get_invoice` (`withInherited`, `includeWorkflowSettings`), `get_invoice_retry_attempts`
- OAuth2 client-credentials authentication with token caching and a single retry on 401.
- Personal data redacted by default (IBAN, SSN, emails, phone numbers, addresses, invoice links); `INIO_REVEAL_PII=true` disables it.
- Compact results: list tools return summary fields with `limit`/`offset` paging and `nextOffset`; detail tools drop empty values; `workflowsSettings` is opt-in.
- HTTP 429 handling: one retry honoring `Retry-After` (at most 5 s), then a `RATE_LIMITED` error.
- JSON logs on stderr with one `tool call` line per call, including `approxTokens`.

### Known limitations

- Invoice `status` filters are sent as repeated query keys, because the Inio API answers a single or comma-separated status with HTTP 500.
- Retry attempts support `limit` only; the Inio API ignores paging for this endpoint.
- `MCP_TRANSPORT=http` is not supported yet.
