import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { InioClient } from '../inio-client.ts';
import { noopLogger, type Logger } from '../logger.ts';
import { BAD_INVOICE_PAYLOAD, InvoiceRef, invoicePath, lookUpInvoiceId } from './invoice-ref.ts';
import { errorText, EXACTLY_ONE_REF, exactlyOneRef, fail, ok, present } from './result.ts';
import { withToolLogging } from '../tool-logging.ts';

type Deps = { client: Pick<InioClient, 'get'>; revealPii: boolean; logger?: Pick<Logger, 'info'> };

const Input = z
  .strictObject({
    ...InvoiceRef,
    withInherited: z
      .boolean()
      .default(false)
      .describe(
        'Include inherited values (IBAN, bank, effective pause). With number this makes two API calls.',
      ),
    includeWorkflowSettings: z
      .boolean()
      .default(false)
      .describe(
        'Include workflowsSettings: how and when each stage (setup, invoicing1-4, paid, credit) is distributed (email, SMS, paper), escalation fees and timing, and which stages are enabled. Leave false unless the question is about these.',
      ),
  })
  .refine(exactlyOneRef, EXACTLY_ONE_REF);

const Invoice = z.record(z.string(), z.unknown());

export function registerGetInvoice(
  server: McpServer,
  { client, revealPii, logger = noopLogger }: Deps,
): void {
  server.registerTool(
    'get_invoice',
    {
      title: 'Get invoice',
      description:
        'Fetch one invoice by UUID (id) or invoice number (number); pass exactly one. Personal data is redacted unless the server runs with INIO_REVEAL_PII=true.',
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: Input,
    },
    withToolLogging(
      logger,
      'get_invoice',
      async ({ id, number, withInherited, includeWorkflowSettings }) => {
        try {
          let invoiceId = id;
          // with-inherited exists only by id, so a number costs an extra lookup.
          if (withInherited && invoiceId === undefined) {
            invoiceId = await lookUpInvoiceId(client, number ?? '');
          }
          const path =
            invoiceId === undefined
              ? invoicePath({ number })
              : `${invoicePath({ id: invoiceId })}${withInherited ? '/with-inherited' : ''}`;
          const parsed = Invoice.safeParse(await client.get(path));
          if (!parsed.success) return fail(BAD_INVOICE_PAYLOAD);
          // workflowsSettings is large and rarely relevant; opt-in only.
          const { workflowsSettings: _, ...invoice } = parsed.data;
          return ok(present(includeWorkflowSettings ? parsed.data : invoice, revealPii));
        } catch (err) {
          return fail(errorText(err));
        }
      },
    ),
  );
}
