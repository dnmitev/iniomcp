import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { InioClient } from '../inio-client.ts';
import { type TokenProvider } from '../auth.ts';
import { noopLogger, type Logger } from '../logger.ts';
import { REDACTION_NOTE } from '../redact.ts';
import { InvoiceRef, invoicePath, readBackInvoice } from './invoice-ref.ts';
import {
  clientIdOf,
  errorText,
  fail,
  isUncertainOutcome,
  isUnreadableSuccess,
  IsoDate,
  ok,
  present,
} from './result.ts';
import { withToolLogging } from '../tool-logging.ts';

type Deps = {
  client: Pick<InioClient, 'get' | 'post'>;
  revealPii: boolean;
  logger?: Pick<Logger, 'info'>;
  tokens: Pick<TokenProvider, 'getToken'>;
  maxPaymentAmount?: number;
};

const DECIMALS = 'must have at most 2 decimals';
const Amount = z.number().positive().multipleOf(0.01, `amount ${DECIMALS}`);
const Part = z.number().min(0).multipleOf(0.01, `amount ${DECIMALS}`);
const Breakdown = z
  .strictObject({ capital: Part.optional(), fee: Part.optional() })
  .refine((b) => (b.capital ?? 0) + (b.fee ?? 0) > 0, { message: 'amount must be more than 0' });

const inputSchema = z
  .strictObject({
    number: InvoiceRef.number.unwrap().describe('Business invoice number, e.g. INV-1001'),
    transactionType: z
      .enum(['direct_payment', 'good_will', 'bank', 'reminder_fee_waiver'])
      .describe('Kind of payment'),
    amount: z
      .union([Amount, Breakdown])
      .optional()
      .describe(
        'Amount paid, more than 0, at most 2 decimals; or {capital, fee} (each 0 or more) for direct_payment and good_will',
      ),
    fullPayment: z
      .literal(true)
      .optional()
      .describe('true pays the whole remaining amount; use instead of amount'),
    paidDate: IsoDate.optional().describe('Date of the payment, YYYY-MM-DD'),
    additionalInformation: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe('Free-text note, 1-100 characters'),
    confirmFeeAutoRemoval: z
      .boolean()
      .optional()
      .describe(
        'Only for a backdated paidDate: allows an in-scope escalation fee to be removed (waived) before the payment is applied. Ask the user before setting it',
      ),
  })
  .refine((a) => (a.amount === undefined) !== (a.fullPayment === undefined), {
    message: 'Provide exactly one of amount or fullPayment.',
  })
  .refine(
    (a) =>
      typeof a.amount !== 'object' ||
      a.transactionType === 'direct_payment' ||
      a.transactionType === 'good_will',
    { message: 'A capital/fee breakdown is only for direct_payment and good_will.' },
  );

const Answer = z.array(z.string().min(1)).length(1);

const UNREADABLE =
  'The payment was recorded, but the API answer could not be read. Do not retry; check the invoice first.';

const CHECK = ' Call get_invoice and compare remainingAmount first.';

const Invoice = z.object({
  remainingAmount: z.union([z.number(), z.string()]),
  paymentStatus: z.string(),
});

const Remaining = z.object({
  remainingAmount: z.union([
    z.number().finite(),
    z
      .string()
      .regex(/^-?\d+(\.\d+)?$/)
      .transform(Number),
  ]),
});
const cents = (x: number): number => Math.round(x * 100);
const NOT_RECORDED = 'Nothing was recorded.';

/** Returns a rejection message when the payment would exceed the limit, else undefined. Runs before any POST. */
async function checkCeiling(
  client: Pick<InioClient, 'get'>,
  path: string,
  amount: number | { capital?: number; fee?: number } | undefined,
  limit: number,
): Promise<string | undefined> {
  const env = 'INIO_MAX_PAYMENT_AMOUNT';
  if (amount === undefined) {
    let invoice: unknown;
    try {
      invoice = await client.get(path);
    } catch (err) {
      return `Could not read the invoice to check the payment limit (${env}): ${errorText(err)} ${NOT_RECORDED}`;
    }
    const parsed = Remaining.safeParse(invoice);
    if (!parsed.success) {
      return `The invoice remaining amount is not a number, so the payment limit (${env}) cannot be checked. ${NOT_RECORDED}`;
    }
    const { remainingAmount: remaining } = parsed.data;
    return cents(remaining) > cents(limit)
      ? `The remaining amount ${remaining} is above the payment limit ${limit} (${env}); pass an explicit amount of at most ${limit}. ${NOT_RECORDED}`
      : undefined;
  }
  const total = typeof amount === 'number' ? amount : (amount.capital ?? 0) + (amount.fee ?? 0);
  return cents(total) > cents(limit)
    ? `The amount ${total} is above the payment limit ${limit} (${env}). ${NOT_RECORDED}`
    : undefined;
}

export function registerCreatePayment(
  server: McpServer,
  { client, revealPii, logger = noopLogger, tokens, maxPaymentAmount }: Deps,
): void {
  server.registerTool(
    'create_payment',
    {
      title: 'Create payment',
      description:
        'Registers a payment on an invoice, by invoice number (number). This records a new payment each time it is called, so never retry without checking the invoice with get_invoice and comparing remainingAmount. Pass exactly one of amount (more than 0, at most 2 decimals; direct_payment and good_will also accept {capital, fee}) or fullPayment true to pay the whole remaining amount. Nothing is sent to the end customer. This cannot be undone with these tools. Returns the payment id, plus the invoice remaining amount and payment status read back after the payment. ' +
        (maxPaymentAmount === undefined
          ? ''
          : `Payments above ${maxPaymentAmount} are rejected. `) +
        REDACTION_NOTE,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema,
    },
    withToolLogging(logger, 'create_payment', async ({ number, amount, fullPayment, ...rest }) => {
      const summary = { paid: true, invoice: number };
      try {
        const path = invoicePath({ number });
        if (maxPaymentAmount !== undefined) {
          const rejection = await checkCeiling(client, path, amount, maxPaymentAmount);
          if (rejection) return fail(rejection);
        }
        const clientId = clientIdOf(await tokens.getToken());
        const body = {
          clientId,
          invoiceNo: number,
          ...(amount === undefined ? {} : { amount }),
          ...rest,
        };
        const answer = Answer.safeParse(await client.post('/payments', [body]));
        // The payment exists once the POST resolves, so an unreadable answer is still success.
        if (!answer.success) return ok(present({ ...summary, note: UNREADABLE }, revealPii));
        const { transactionType } = rest;
        const result = {
          ...summary,
          transactionType,
          amount,
          fullPayment,
          paymentId: answer.data[0],
          ...(await readBackInvoice(client, path, Invoice)),
        };
        return ok(present(result, revealPii));
      } catch (err) {
        // A 2xx the client could not parse (no result envelope) also means the payment exists.
        if (isUnreadableSuccess(err))
          return ok(present({ ...summary, note: UNREADABLE }, revealPii));
        return fail(errorText(err) + (isUncertainOutcome(err) ? CHECK : ''));
      }
    }),
  );
}
