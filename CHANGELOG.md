# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.2] - Unreleased

### Changed

- Docker image runs on Node 26 LTS (`node:26.12-alpine`). The npm package still supports Node 24 and later; CI tests both.
- Release workflow on current versions of the GitHub and Docker actions; no npm cache in release jobs.

No changes to the tools.

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
- `MCP_TRANSPORT=http` is not supported yet.
