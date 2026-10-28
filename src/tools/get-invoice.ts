import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { pathSegment, type InioClient } from '../inio-client.ts';
import { noopLogger, type Logger } from '../auth.ts';
import { errorText, fail, ok, present } from './result.ts';
import { withToolLogging } from '../tool-logging.ts';

type Deps = { client: InioClient; revealPii: boolean; logger?: Pick<Logger, 'info'> };

const Input = z
  .strictObject({
    id: z.uuid().optional().describe('Invoice UUID'),
    number: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[^\p{Cc}]+$/u)
      .optional()
      .describe('Business invoice number, e.g. INV-1001'),
    withInherited: z
      .boolean()
      .default(false)
      .describe(
        'Include inherited values (IBAN, bank, effective pause). With number this makes two API calls.',
      ),
  })
  .refine((a) => (a.id === undefined) !== (a.number === undefined), {
    message: 'Provide exactly one of id or number.',
  });

const BAD_PAYLOAD = 'UPSTREAM_ERROR: Unexpected invoice payload from the Inio API.';
const WithId = z.object({ id: z.uuid() });

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
    withToolLogging(logger, 'get_invoice', async ({ id, number, withInherited }) => {
      try {
        const byNumber = () => `/invoices/by-number/${pathSegment(number ?? '')}`;
        let invoiceId = id;
        // with-inherited exists only by id, so a number costs an extra lookup.
        if (withInherited && invoiceId === undefined) {
          const found = WithId.safeParse(await client.get(byNumber()));
          if (!found.success) return fail(BAD_PAYLOAD);
          invoiceId = found.data.id;
        }
        const path =
          invoiceId === undefined
            ? byNumber()
            : `/invoices/${pathSegment(invoiceId)}${withInherited ? '/with-inherited' : ''}`;
        const invoice = await client.get(path);
        if (invoice === null || typeof invoice !== 'object' || Array.isArray(invoice)) {
          return fail(BAD_PAYLOAD);
        }
        return ok(present(invoice, revealPii));
      } catch (err) {
        return fail(errorText(err));
      }
    }),
  );
}
