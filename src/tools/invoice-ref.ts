import { z } from 'zod';
import { pathSegment, type InioClient } from '../inio-client.ts';
import { errorText } from './result.ts';

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

/** Refine check and message: exactly one of id or number. */
export const exactlyOneRef = (a: Ref): boolean => (a.id === undefined) !== (a.number === undefined);
export const EXACTLY_ONE_REF = { message: 'Provide exactly one of id or number.' };

/** /invoices/<id> or /invoices/by-number/<number>, each segment encoded. */
export function invoicePath({ id, number }: Ref): string {
  return id !== undefined
    ? `/invoices/${pathSegment(id)}`
    : `/invoices/by-number/${pathSegment(number ?? '')}`;
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
  return parsed.success
    ? parsed.data
    : note('UPSTREAM_ERROR: Unexpected invoice payload from the Inio API.');
}
