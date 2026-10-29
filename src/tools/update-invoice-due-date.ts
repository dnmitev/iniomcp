import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { InioClient } from '../inio-client.ts';
import { noopLogger, type Logger } from '../auth.ts';
import {
  EXACTLY_ONE_REF,
  exactlyOneRef,
  InvoiceRef,
  invoicePath,
  readBackInvoice,
} from './invoice-ref.ts';
import { errorText, fail, IsoDate, ok, present } from './result.ts';
import { withToolLogging } from '../tool-logging.ts';

type Deps = { client: InioClient; revealPii: boolean; logger?: Pick<Logger, 'info'> };

const Input = z
  .strictObject({
    ...InvoiceRef,
    dueDate: IsoDate.describe('New due date, YYYY-MM-DD, later than the current due date'),
    reason: z.string().min(1).max(100).describe('Why the due date is postponed, 1-100 characters'),
  })
  .refine(exactlyOneRef, EXACTLY_ONE_REF);

const Invoice = z.object({
  invoiceNo: z.string(),
  dueDate: z.unknown(),
  stage: z.unknown(),
  status: z.unknown(),
});

export function registerUpdateInvoiceDueDate(
  server: McpServer,
  { client, revealPii, logger = noopLogger }: Deps,
): void {
  server.registerTool(
    'update_invoice_due_date',
    {
      title: 'Postpone invoice due date',
      description:
        'Postpone an invoice due date, by UUID (id) or invoice number (number); pass exactly one. The new date must be later than the current due date and after today, so this cannot be undone with these tools. Rejected for closed, cancelled or paid invoices, invoices in debt collection, invoices that have already escalated, invoices whose first or second reminder waiting period has passed, or with an outstanding fee. Triggers the client webhook invoiceDueDatePostponed. Returns whether it was updated, plus the invoice number, due date, stage and status read back after the change. Personal data is redacted unless the server runs with INIO_REVEAL_PII=true.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: Input,
    },
    withToolLogging(logger, 'update_invoice_due_date', async ({ id, number, dueDate, reason }) => {
      try {
        const path = invoicePath({ id, number });
        await client.post(`${path}/update-due-date`, { dueDate, updateReason: reason });
        // The API answers only "Success"; read back so the result shows what is stored now.
        const stored = await readBackInvoice(client, path, Invoice);
        const result = {
          updated: true,
          invoice: id ?? number,
          requestedDueDate: dueDate,
          ...stored,
        };
        return ok(present(result, revealPii));
      } catch (err) {
        return fail(errorText(err));
      }
    }),
  );
}
