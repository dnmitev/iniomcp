import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { InioApiError, type InioClient } from '../inio-client.ts';
import { noopLogger, type Logger, type TokenProvider } from '../auth.ts';
import { InvoiceRef, invoicePath, readBackInvoice } from './invoice-ref.ts';
import { errorText, fail, isUnreadableSuccess, IsoDate, ok, present } from './result.ts';
import { withToolLogging } from '../tool-logging.ts';

type Deps = {
  client: Pick<InioClient, 'get' | 'post'>;
  revealPii: boolean;
  logger?: Pick<Logger, 'info'>;
  tokens: Pick<TokenProvider, 'getToken'>;
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

const UNCERTAIN =
  ' The payment may or may not have been recorded. Do not retry yet: call get_invoice and compare remainingAmount first.';

const Invoice = z.object({
  remainingAmount: z.union([z.number(), z.string()]),
  paymentStatus: z.string(),
});

/** The inio_client_id claim of the token, which the payments endpoint wants in the body. Never echoes the token. */
function clientIdOf(token: string): string {
  try {
    const payload = Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8');
    return z.object({ inio_client_id: z.string().min(1) }).parse(JSON.parse(payload))
      .inio_client_id;
  } catch {
    throw new Error('The access token has no usable inio_client_id claim.');
  }
}

export function registerCreatePayment(
  server: McpServer,
  { client, revealPii, logger = noopLogger, tokens }: Deps,
): void {
  server.registerTool(
    'create_payment',
    {
      title: 'Create payment',
      description:
        'Registers a payment on an invoice, by invoice number (number). This records a new payment each time it is called, so never retry without checking the invoice with get_invoice and comparing remainingAmount. Pass exactly one of amount (more than 0, at most 2 decimals; direct_payment and good_will also accept {capital, fee}) or fullPayment true to pay the whole remaining amount. Nothing is sent to the end customer. This cannot be undone with these tools. Returns the payment id, plus the invoice remaining amount and payment status read back after the payment. Personal data is redacted unless the server runs with INIO_REVEAL_PII=true.',
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
        const uncertain = err instanceof InioApiError && (err.status === 0 || err.status >= 500);
        return fail(errorText(err) + (uncertain ? UNCERTAIN : ''));
      }
    }),
  );
}
