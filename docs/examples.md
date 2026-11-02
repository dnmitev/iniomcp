# What you can ask

Ask in plain language; the assistant picks the tools. The identifiers below (customer `C-1001`, invoice `20260101-01`) are examples: use your own.

## Customers

| Ask                                                                      | Tools used       |
| ------------------------------------------------------------------------ | ---------------- |
| "Find customer C-1001 and show their service line and any active pause." | `get_customer`   |
| "List our direct-debit customers, newest first."                         | `list_customers` |
| "Show the 20 most recently updated customers."                           | `list_customers` |

## Invoices

| Ask                                                                                                   | Tools used                                   |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| "Which open invoices does customer C-1001 have?"                                                      | `list_invoices`                              |
| "Show invoice 20260101-01: amount, due date, stage and what has been paid."                           | `get_invoice`                                |
| "Which of customer C-1001's invoices are partially paid?"                                             | `list_invoices`                              |
| "Why is invoice 20260101-01 paused, and until when?"                                                  | `get_invoice`                                |
| "Which reminder and debt-collection steps are set up for invoice 20260101-01, and what do they cost?" | `get_invoice` with `includeWorkflowSettings` |
| "Show invoice 20260101-01 including the inherited IBAN and bank."                                     | `get_invoice` with `withInherited`           |

## Pauses and direct debit

| Ask                                                                                        | Tools used                             |
| ------------------------------------------------------------------------------------------ | -------------------------------------- |
| "Does customer C-1001 have scheduled or active pauses?"                                    | `get_customer`, `list_customer_pauses` |
| "How many direct-debit attempts failed for invoice 20260101-01, and is it still eligible?" | `get_invoice_retry_attempts`           |

## Changing data (opt-in)

These need a server started with `INIO_ALLOW_WRITES=true`. Write tools are marked destructive, so most clients ask you to confirm each call (Claude Desktop does unless you allowed the tool permanently); check your client's auto-approve settings, and read the summary it shows before confirming. Every change is recorded in Inio's audit fields as `inio-mcp`. The [write tools table](../README.md#write-tools-opt-in) lists what each one changes and whether it can be undone.

| Ask                                                                                   | Tool                                    | What happens                                                                                                 |
| ------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| "Postpone the due date of invoice 20260101-01 to 15 February."                        | `update_invoice_due_date`               | Moves the due date (postpone only); your systems get the `invoiceDueDatePostponed` webhook. Cannot be undone |
| "Pause reminders for customer C-1001 from next Monday to the end of the month."       | `get_customer`, `create_customer_pause` | Holds back reminders from a future date; cancel the pause to undo                                            |
| "Hold reminders on invoice 20260101-01 until 1 March."                                | `update_invoice_stop_until_dates`       | Sets the stop-until date; clear it to undo                                                                   |
| "Record a bank payment of 250 SEK on invoice 20260101-01, paid yesterday."            | `create_payment`                        | Records one payment; each call records another. Cannot be undone                                             |
| "Credit the delivery fee on invoice 20260101-01, without sending it to the customer." | `get_invoice`, `create_credit_invoice`  | Creates a credit invoice; sent to the end customer only if you ask. Cannot be undone                         |
| "Update customer C-1001's distribution email to billing@example.com."                 | `update_customer`                       | Replaces the field; the old value is not kept                                                                |

## Why do some fields show `[redacted]`?

Business customers (customer type `B`) come back in full except invoice links and SSNs. For consumers (`C`), and when the type is unknown, the server hides contact details, address, city, name and other personal data before the assistant sees them. The admin can turn this off with `INIO_REVEAL_PII=true`. See [Data protection](../README.md#data-protection) for the exact lists.
