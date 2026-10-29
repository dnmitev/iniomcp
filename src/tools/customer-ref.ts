import { z } from 'zod';
import { pathSegment } from '../inio-client.ts';

/** id/number fields to spread into a customer tool's input schema; pair with exactlyOneRef. */
export const CustomerRef = {
  id: z.uuid().optional().describe('Customer UUID'),
  number: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[^\p{Cc}]+$/u)
    .optional()
    .describe('Business customer number, e.g. C-1001'),
};

/** /customers/<id> or /customers/by-number/<number>, each segment encoded. */
export function customerPath({ id, number }: { id?: string; number?: string }): string {
  return id !== undefined
    ? `/customers/${pathSegment(id)}`
    : `/customers/by-number/${pathSegment(number ?? '')}`;
}
