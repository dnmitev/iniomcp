# Phase 4: write endpoint behavior (from temporal-monorepo, 2026-10-29)

Source root: `temporal-monorepo/packages`. Short names: `V` = `shared/validations/src/api`, `CS` = customers-service, `IS` = invoices-service, `FS` = financial-service.

## Cross-cutting
- **Responses:** success is `{ correlationId, success, status, result }`. Errors are `{ code, message, correlationId, status, fieldErrors? }`, where each fieldError is `{ fieldName: "0.customerAddress.zipCode", errorCode, message }`. Schema failures return 400; business-key conflicts return 409. Exception: reverse-payment returns a bare `{message}` with 400.
- **Roles:** the public API enforces none. Only the tenant (token claim `inio_client_id`) is checked. "client-operator / customer-operator" in the docs refers to the back office only. Back-office-only guards that public clients do not have: payment transaction-type permissions, backdating permissions, pause management permission. **Any public client can post `credit_loss`/`cancelled` payments and backdate.**
- **Actor in audit fields:** `x-user-real-name` header or `body.userRealName`, default `System`.
- **Batch limits:** no array max on the "multiple" endpoints. The only cap is the 5 MB body limit. Batches are all-or-nothing.
- **Dry run:** none public. `reset-stage/preview` exists but is not tagged public.
- **Dates:** strict `YYYY-MM-DD`. Pause reason: 1–255 characters.

## Customer pauses (CS)
- **POST /customers/{id}/pauses:**
  - Fields: `scope` (`reminders`, `dcTransfers` or `both`); `startAt` ≥ tomorrow (UTC); `endAt` after `startAt`, or null/absent for indefinite; `reason` (1–255).
  - Overlap with an existing pause of the same scope returns 409.
  - Starts the Temporal workflow `customerPauseLifecycle` and returns 201 with the pause.
  - Suspends reminders and/or DC escalation for the customer.
- **PATCH .../pauses/{pauseId}:**
  - Fields: optional `startAt`, `endAt` and `scope` (at least one), plus a required `reason`.
  - A scheduled pause can change any field; an active pause can change only `endAt`; completed or cancelled returns 400.
  - Overlap returns 409. Signals the workflow and returns 200 with the pause.
- **POST .../pauses/{pauseId}/cancel:**
  - Body `{reason}`. Only scheduled or active pauses can be cancelled.
  - **Irreversible.** Returns 200 with the pause.

## Invoice dates (IS)
- **POST /invoices/{id}/update-due-date** (and by-number):
  - Fields: `dueDate` (`YYYY-MM-DD`, must be later than the current due date and after today); `updateReason` (1–100); optional `userRealName`.
  - Rejected when the invoice is closed, cancelled, paid or overpaid, is in debt collection, escalation has started, the invoicing1/2 waiting period has passed, or a fee is outstanding.
  - **Postpone only: cannot be moved back.** Returns 200 `"Success"`.
  - Signals the timers and sends the **client webhook `invoiceDueDatePostponed`**.
- **POST /invoices/{id}/update-stop-until-dates** (and by-number):
  - **Requires the feature flag `MANUAL_STOP_UNTIL_FLAG`; otherwise blocked.**
  - Fields: `metadata` with `{invoicing1..4StopUntilDate, collection1..5StopUntilDate}`, each a date or null (at least one); `escalationStopReason` required.
  - Steps already passed are dropped. Dates must be in the future and on or after the due date. The invoice must be open or paused, unpaid and not in debt collection.
  - Returns 200 `"Success"`.
- **POST /invoices/{id}/reset-stage** (by id only):
  - Fields: `targetStage` (`invoiced` or `reminded`); `dueDate` (required for invoiced, forbidden for reminded); `reason` (1–100); optional `redistribute` and `modifyInvoice`.
  - Starts `resetInvoiceStage`, which may **waive fees** and **re-send to the end customer**.
  - Returns 200 with the plan, including the workflowId.

## Customers (CS)
- **PATCH /customers/{id}** (and by-number):
  - The schema is strict; every field is optional. Clearing a field with null and partial address merges are allowed.
  - `workflowsSettings` accepts only `{distributionMethods}`; `{}` resets the customer to inherit.
  - Customer-type rules: SSN only for C; orgNr and vatNo only for B.
  - Returns 200 with `[customer]`. Database only.
- **POST /customers** (bulk):
  - Required: `serviceLineName`, `customerName`, `languageCode`, `customerNo` (unique), `customerType`, full `customerAddress`, `clientId`.
  - Returns 201 with an array of ids. A duplicate returns 409. All-or-nothing.

## Invoices and credit (IS)
- **POST /invoices** (bulk):
  - Strict schema. `workflowsSettings` and `invoiceItems` (with `calcInput`) are required.
  - Starts the `setup` workflow, which **sends the invoice to the end customer** and begins escalation.
  - `invoiceNo` and `paymentReference` must be unique (409).
- **POST /invoices/{id}/credit-invoice** (and by-number):
  - Credits debit items, with limits against remaining amounts.
  - Starts the `credit` workflow, which may **distribute the credit note**.
- **POST /invoices/credit-invoice:** unmatched credit invoice.
- **POST /invoices/{id}/match-credit-invoice:** `creditInvoiceNo` plus `amount` ≤ 0. Runs the `matchCredit` workflow, with no distribution.

## Payments (FS)
- **POST /payments** (array):
  - Fields: `clientId`, `invoiceNo`, `transactionType` (including `credit_loss` and `cancelled`), and `amount` (rules depend on the type).
  - **No idempotency: a resend creates duplicate payments.**
  - Runs `processPayment`, which may close, cancel or write off the invoice.
- **POST /payments/reverse-payment:**
  - Fields: `paymentAllocationId`; optional `reversalReason`.
  - Synchronous and idempotent per allocation: a second call returns 500.

## Live findings (read-only, 2026-10-29)
- The access token carries `inio_client_id` (string). It is the `clientId` that POST /payments requires.
- GET /invoices/{id} has no `clientId`, and no payment or allocation data (checked on partiallyPaid and paid invoices). No public read endpoint exposes a `paymentAllocationId`.
- POST /payments returns 201 with an array of payment ids. Whether a payment id can be used as a `paymentAllocationId` is unverified; that needs a live write probe.
- List responses are `{ data, limit, offset, total }`.
