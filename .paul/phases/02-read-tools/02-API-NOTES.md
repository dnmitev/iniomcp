# Phase 2: list endpoint behavior (from temporal-monorepo, 2026-10-28)

Source root: `temporal-monorepo/packages`. Gateway (APISIX) query validation not checked (separate `apisix-routes` repo).

## Shared
- Paging (`shared/tools/src/pagination.ts`): `offset` or `limit` without `page` = offset mode, limit 1–100, offset ≥ 0, else 400; response `{data, limit, offset, total}`. `page`+`limit` = legacy mode (no max, response `{data, totalItems, page, limit, totalPages}`). Never send `page` to list endpoints.
- Sort: default `id asc`; sort must be in the controller's attribute list, otherwise **500**. `order` is unvalidated outside legacy mode (bad value likely 500). Validate both on our side.
- Filters: any allowed column = equality; repeated key = IN; unknown keys silently ignored.

## GET /customers
- Sortable/filterable: any Customer column (`customerName`, `customerNo`, `customerType`, `directDebit`, `serviceLineId`, `orgNr`, `createdAt`, `updatedAt`, …).

## GET /invoices
- Filters: Invoice, InvoiceItems and Histories columns; `invoiceNo` equality; `status` and `paymentStatus` comma-separated → IN.
- `InvoiceStatus`: `open|paused|cancelled|closed`. `paymentStatus`: `notPaid|paid|overPaid|partiallyPaid|capitalPaid`.
- **Suspected bug:** `status=open` may 500 (`parseCommaSeparated` validates against attribute names). Verify live before exposing `status`.
- Headers `x-customer-id` / `x-customer-no` scope to one customer; both together = 400.

## GET /customers/{id}/pauses
- `status` single enum `scheduled|active|completed|cancelled` (400 otherwise). No paging, no sort; bare array ordered by `startAt ASC`. Customer must exist (404).

## GET /invoices/{id}/retry-attempts (and by-number)
- No query schema. `limit` default 10, no bounds. **Bug:** `page` gives no offset (same events every page) and `totalItems` is the page length. Expose `limit` only.
- Not eligible for direct debit: `{data: [], totalItems: 0, …, directDebitEligible: false}`.
