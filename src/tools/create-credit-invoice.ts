import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { InioClient } from '../inio-client.ts';
import { noopLogger, type Logger } from '../auth.ts';
import { CreditFields, InvoiceRef, invoicePath, pastPaidDateRule } from './invoice-ref.ts';
import {
  errorText,
  EXACTLY_ONE_REF,
  exactlyOneRef,
  fail,
  isUnreadableSuccess,
  ok,
  present,
} from './result.ts';
import { withToolLogging } from '../tool-logging.ts';

type Deps = {
  client: Pick<InioClient, 'post'>;
  revealPii: boolean;
  logger?: Pick<Logger, 'info'>;
  now?: () => number;
};

const Item = z.strictObject({
  debitItemId: z.uuid().describe('Id of the invoice item to credit, as listed by get_invoice'),
  unitPrice: z
    .number()
    .max(0, 'unitPrice must be 0 or negative')
    .describe('Credited unit price, 0 or negative'),
  quantity: z.number().positive().describe('Credited quantity, more than 0'),
});

const inputSchema = (now: () => number) =>
  z
    .strictObject({
      ...InvoiceRef,
      ...CreditFields,
      creditInvoiceNo: CreditFields.creditInvoiceNo.describe(
        'Invoice number for the new credit invoice, 1-50 characters, unique',
      ),
      items: z.array(Item).min(1).max(100).describe('Invoice items to credit, 1-100'),
      description: z.string().max(100).optional().describe('Credit invoice description, up to 100'),
      paymentReference: z
        .string()
        .min(1)
        .max(20)
        .optional()
        .describe('Payment reference, up to 20'),
      isReverseTaxation: z.boolean().default(false).describe('Reverse taxation; default false'),
      distributionEnabled: z
        .boolean()
        .default(false)
        .describe('true sends the credit invoice to the end customer; default false'),
      distributionMethod: z
        .enum(['sms', 'email', 'paper', 'edi'])
        .optional()
        .describe('How to send it; required when distributionEnabled is true'),
    })
    .refine(exactlyOneRef, EXACTLY_ONE_REF)
    .refine((a) => !a.distributionEnabled || a.distributionMethod !== undefined, {
      message: 'distributionMethod is required when distributionEnabled is true',
    })
    .refine(...pastPaidDateRule(now));

// Picks only the listed keys: the spec gives no item properties, and the rest may carry PII.
const CreatedItem = z.object({
  id: z.unknown().optional(),
  debitItemId: z.unknown().optional(),
  unitPrice: z.unknown().optional(),
  quantity: z.unknown().optional(),
});

const Created = z.object({
  id: z.unknown(),
  invoiceNo: z.unknown(),
  paymentReference: z.unknown(),
  creditInvoiceItems: z.array(CreatedItem),
});

export function registerCreateCreditInvoice(
  server: McpServer,
  { client, revealPii, logger = noopLogger, now = Date.now }: Deps,
): void {
  server.registerTool(
    'create_credit_invoice',
    {
      title: 'Create credit invoice',
      description:
        'Credit items of an existing invoice, by UUID (id) or invoice number (number) of the invoice to credit; pass exactly one. get_invoice lists the invoice items; pass each item id as debitItemId with a negative (or 0) unitPrice and the quantity to credit, within what remains on the item. The credit is posted against the invoice. Nothing is sent to the end customer unless distributionEnabled is true (with a distributionMethod). Rejected for invoices in debt collection and for a credit invoice number already in use. This cannot be undone with these tools. Returns the credit invoice id, number, payment reference and items. Personal data is redacted unless the server runs with INIO_REVEAL_PII=true.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: inputSchema(now),
    },
    withToolLogging(
      logger,
      'create_credit_invoice',
      async ({ id, number, creditInvoiceNo, items, distributionMethod, ...rest }) => {
        const unreadable = () => {
          const note = 'The credit invoice was created, but the API answer could not be read.';
          return ok(present({ created: true, creditInvoiceNo, note }, revealPii));
        };
        try {
          const body = {
            invoiceNo: creditInvoiceNo,
            invoiceItems: items,
            ...rest,
            distributionMethod: distributionMethod ?? '',
          };
          const created = Created.safeParse(
            await client.post(`${invoicePath({ id, number })}/credit-invoice`, body),
          );
          // The credit invoice exists once the POST resolves, so an unreadable answer is still success.
          if (!created.success) return unreadable();
          const { creditInvoiceItems, ...invoice } = created.data;
          return ok(present({ created: true, ...invoice, items: creditInvoiceItems }, revealPii));
        } catch (err) {
          // A 2xx the client could not parse (no result envelope) also means the credit invoice exists.
          if (isUnreadableSuccess(err)) return unreadable();
          return fail(errorText(err));
        }
      },
    ),
  );
}
