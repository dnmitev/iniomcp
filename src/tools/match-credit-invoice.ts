import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { InioClient } from '../inio-client.ts';
import { noopLogger, type Logger } from '../logger.ts';
import { REDACTION_NOTE } from '../redact.ts';
import {
  CreditFields,
  InvoiceRef,
  invoicePath,
  pastPaidDateRule,
  readBackInvoice,
} from './invoice-ref.ts';
import {
  acceptedUnreadable,
  EXACTLY_ONE_REF,
  exactlyOneRef,
  ok,
  present,
  writeFailure,
} from './result.ts';
import { withToolLogging } from '../tool-logging.ts';

type Deps = {
  client: Pick<InioClient, 'get' | 'post'>;
  revealPii: boolean;
  logger?: Pick<Logger, 'info'>;
  now?: () => number;
};

const inputSchema = (now: () => number) =>
  z
    .strictObject({
      ...InvoiceRef,
      ...CreditFields,
      creditInvoiceNo: CreditFields.creditInvoiceNo.describe(
        'Invoice number of the credit invoice to match, 1-50 characters',
      ),
      amount: z
        .number()
        .max(0, 'amount must be 0 or negative')
        .multipleOf(0.01, 'amount must have at most 2 decimals')
        .describe('Amount to match, 0 or negative, at most 2 decimals'),
    })
    .refine(exactlyOneRef, EXACTLY_ONE_REF)
    .refine(...pastPaidDateRule(now));

const Invoice = z.object({
  remainingAmount: z.union([z.number(), z.string()]),
  paymentStatus: z.string(),
});

export function registerMatchCreditInvoice(
  server: McpServer,
  { client, revealPii, logger = noopLogger, now = Date.now }: Deps,
): void {
  server.registerTool(
    'match_credit_invoice',
    {
      title: 'Match credit invoice',
      description:
        "Match an existing credit invoice against a debit invoice, by UUID (id) or invoice number (number) of the debit invoice; pass exactly one. amount is 0 or negative, and its absolute value must not exceed either invoice's remaining amount. Both invoices must belong to the same customer. Nothing is sent to the end customer. This cannot be undone with these tools. Returns the credit invoice id, plus the debit invoice's remaining amount and payment status read back after the match. " +
        REDACTION_NOTE,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: inputSchema(now),
    },
    withToolLogging(logger, 'match_credit_invoice', async ({ id, number, ...body }) => {
      try {
        const path = invoicePath({ id, number });
        const creditInvoiceId = await client.post(`${path}/match-credit-invoice`, body);
        if (typeof creditInvoiceId !== 'string') {
          return acceptedUnreadable();
        }
        const result = {
          matched: true,
          invoice: id ?? number,
          creditInvoiceNo: body.creditInvoiceNo,
          amount: body.amount,
          creditInvoiceId,
          ...(await readBackInvoice(client, path, Invoice)),
        };
        return ok(present(result, revealPii));
      } catch (err) {
        return writeFailure(err);
      }
    }),
  );
}
