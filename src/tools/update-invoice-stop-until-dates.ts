import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { InioApiError, type InioClient } from '../inio-client.ts';
import { noopLogger, type Logger } from '../logger.ts';
import { InvoiceRef, invoicePath, readBackInvoice } from './invoice-ref.ts';
import { errorText, EXACTLY_ONE_REF, exactlyOneRef, fail, IsoDate, ok, present } from './result.ts';
import { withToolLogging } from '../tool-logging.ts';

type Deps = { client: InioClient; revealPii: boolean; logger?: Pick<Logger, 'info'> };

const STEPS = [
  'invoicing1',
  'invoicing2',
  'invoicing3',
  'invoicing4',
  'collection1',
  'collection2',
  'collection3',
  'collection4',
  'collection5',
] as const;

const stepDate = (step: string) =>
  IsoDate.nullable()
    .optional()
    .describe(`Stop-until date for ${step}, YYYY-MM-DD, or null to clear`);

const Input = z
  .strictObject({
    ...InvoiceRef,
    reason: z.string().min(1).max(255).describe('Why escalation is held back, 1-255 characters'),
    invoicing1: stepDate('invoicing1'),
    invoicing2: stepDate('invoicing2'),
    invoicing3: stepDate('invoicing3'),
    invoicing4: stepDate('invoicing4'),
    collection1: stepDate('collection1'),
    collection2: stepDate('collection2'),
    collection3: stepDate('collection3'),
    collection4: stepDate('collection4'),
    collection5: stepDate('collection5'),
  })
  .refine(exactlyOneRef, EXACTLY_ONE_REF)
  .refine((a) => STEPS.some((step) => a[step] !== undefined), {
    message: 'Provide at least one stop-until date.',
  });

// Keeps the invoice number and the nine stop-until dates; the rest of the invoice is dropped.
const Invoice = z
  .object({ invoiceNo: z.string(), metadata: z.record(z.string(), z.unknown()).optional() })
  .transform(({ invoiceNo, metadata = {} }) => ({
    invoiceNo,
    stopUntilDates: Object.fromEntries(
      STEPS.map((step) => `${step}StopUntilDate`).map((key) => [key, metadata[key]]),
    ),
  }));

export function registerUpdateInvoiceStopUntilDates(
  server: McpServer,
  { client, revealPii, logger = noopLogger }: Deps,
): void {
  server.registerTool(
    'update_invoice_stop_until_dates',
    {
      title: 'Update invoice stop-until dates',
      description:
        'Set or clear (null) the dates until which reminders (invoicing1-4) and debt-collection steps (collection1-5) are held back for an invoice, by UUID (id) or invoice number (number); pass exactly one. Needs the stop-until feature enabled for the tenant. Dates must be in the future and on or after the due date; steps that have already passed are ignored. The invoice must be open or paused, unpaid and not in debt collection. Returns whether it was updated, plus the invoice number and stop-until dates read back after the change. Personal data is redacted unless the server runs with INIO_REVEAL_PII=true.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: Input,
    },
    withToolLogging(logger, 'update_invoice_stop_until_dates', async (args) => {
      try {
        const path = invoicePath(args);
        const metadata = Object.fromEntries(
          STEPS.filter((step) => args[step] !== undefined).map((step) => [
            `${step}StopUntilDate`,
            args[step],
          ]),
        );
        await client.post(`${path}/update-stop-until-dates`, {
          metadata,
          escalationStopReason: args.reason,
        });
        // The API answers only "Success"; read back so the result shows what is stored now.
        const stored = await readBackInvoice(client, path, Invoice);
        const invoice = args.id ?? args.number;
        return ok(present({ updated: true, invoice, ...stored }, revealPii));
      } catch (err) {
        // With the feature flag off the API answers a bare 404 without an envelope
        // (requireFeatureFlag middleware), which the client reports as UPSTREAM_ERROR.
        // Read-back failures never reach here, so this is always the POST.
        if (err instanceof InioApiError && err.status === 404 && err.code === 'UPSTREAM_ERROR') {
          return fail('FEATURE_DISABLED: Stop-until dates are not enabled for this tenant.');
        }
        return fail(errorText(err));
      }
    }),
  );
}
