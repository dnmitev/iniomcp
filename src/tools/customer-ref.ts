import { z } from 'zod';
import { pathSegment } from '../inio-client.ts';

// Same rules get_customer applies before lookup: no control characters, and not a dot
// segment. pathSegment rejects "." and "..", so a number accepted here can be fetched later.
const customerNumber = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[^\p{Cc}]+$/u)
  .refine((value) => value !== '.' && value !== '..', 'Invalid path segment');

/** id/number fields to spread into a customer tool's input schema; pair with exactlyOneRef. */
export const CustomerRef = {
  id: z.uuid().optional().describe('Customer UUID'),
  number: customerNumber.optional().describe('Business customer number, e.g. C-1001'),
};

/** /customers/<id> or /customers/by-number/<number>, each segment encoded. */
export function customerPath({ id, number }: { id?: string; number?: string }): string {
  return id !== undefined
    ? `/customers/${pathSegment(id)}`
    : `/customers/by-number/${pathSegment(number ?? '')}`;
}
