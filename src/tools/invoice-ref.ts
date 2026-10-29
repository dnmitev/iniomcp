import { z } from 'zod';
import { InioApiError, pathSegment, type InioClient } from '../inio-client.ts';
import { errorText, IsoDate } from './result.ts';

/** id/number fields to spread into an invoice tool's input schema; pair with exactlyOneRef. */
export const InvoiceRef = {
  id: z.uuid().optional().describe('Invoice UUID'),
  number: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[^\p{Cc}]+$/u)
    .optional()
    .describe('Business invoice number, e.g. INV-1001'),
};

type Ref = { id?: string | undefined; number?: string | undefined };

export const BAD_INVOICE_PAYLOAD = 'UPSTREAM_ERROR: Unexpected invoice payload from the Inio API.';

/** A by-number lookup answer usable as an id: a UUID, which also keeps '..' and the like out of paths. */
const WithInvoiceId = z.object({ id: z.uuid() });

/** /invoices/<id> or /invoices/by-number/<number>, each segment encoded. */
export function invoicePath({ id, number }: Ref): string {
  return id !== undefined
    ? `/invoices/${pathSegment(id)}`
    : `/invoices/by-number/${pathSegment(number ?? '')}`;
}

/** The invoice id for a business number; for endpoints that exist only by id. Throws on an unusable answer. */
export async function lookUpInvoiceId(
  client: Pick<InioClient, 'get'>,
  number: string,
): Promise<string> {
  const found = WithInvoiceId.safeParse(await client.get(invoicePath({ number })));
  if (!found.success) {
    // 200 on purpose: the API answered, but with a body we cannot use.
    throw new InioApiError(200, 'UPSTREAM_ERROR', 'Unexpected invoice payload from the Inio API.');
  }
  return found.data.id;
}

/**
 * Reads the invoice back after a successful write. A failure becomes a `readBack` note rather
 * than an error: the write already happened, so the tool must still report it.
 */
export async function readBackInvoice<T>(
  client: Pick<InioClient, 'get'>,
  path: string,
  schema: z.ZodType<T>,
): Promise<T | { readBack: string }> {
  const note = (text: string) => ({ readBack: `Could not read the invoice back: ${text}` });
  let payload: unknown;
  try {
    payload = await client.get(path);
  } catch (err) {
    return note(errorText(err));
  }
  const parsed = schema.safeParse(payload);
  return parsed.success ? parsed.data : note(BAD_INVOICE_PAYLOAD);
}

/** Fields shared by the credit invoice tools; pair with pastPaidDateRule. */
export const CreditFields = {
  creditInvoiceNo: z.string().min(1).max(50),
  paidDate: IsoDate.optional().describe(
    'Date the credit counts as paid, YYYY-MM-DD; before today (UTC) needs additionalInformation',
  ),
  additionalInformation: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe('Free-text note, up to 100 characters; required when paidDate is in the past'),
};

/** Refine check and message: a paidDate before today (UTC, as the API counts it) needs additionalInformation. */
export const pastPaidDateRule = (now: () => number) =>
  [
    (a: { paidDate?: string | undefined; additionalInformation?: string | undefined }) =>
      a.paidDate === undefined ||
      a.additionalInformation !== undefined ||
      a.paidDate >= new Date(now()).toISOString().slice(0, 10),
    { message: 'additionalInformation is required when paidDate is in the past' },
  ] as const;
