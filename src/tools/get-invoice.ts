import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { InioApiError, pathSegment, type InioClient } from '../inio-client.ts';
import { noopLogger, type Logger } from '../auth.ts';
import { redact } from '../redact.ts';
import { withToolLogging } from '../tool-logging.ts';

type Deps = { client: InioClient; revealPii: boolean; logger?: Pick<Logger, 'info'> };

const Input = z
  .strictObject({
    id: z.uuid().optional().describe('Invoice UUID'),
    number: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe('Business invoice number, e.g. INV-1001'),
  })
  .refine((a) => (a.id === undefined) !== (a.number === undefined), {
    message: 'Provide exactly one of id or number.',
  });

function errorText(err: unknown): string {
  if (err instanceof InioApiError) {
    const suffix = err.correlationId ? ` (correlationId ${err.correlationId})` : '';
    return `${err.code}: ${err.message}${suffix}`;
  }
  return err instanceof Error ? err.message : String(err);
}

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
    withToolLogging(logger, 'get_invoice', async ({ id, number }) => {
      const fail = (text: string) => ({
        content: [{ type: 'text' as const, text }],
        isError: true,
      });
      try {
        const path =
          id !== undefined
            ? `/invoices/${pathSegment(id)}`
            : `/invoices/by-number/${pathSegment(number ?? '')}`;
        const invoice = await client.get(path);
        if (invoice === null || typeof invoice !== 'object' || Array.isArray(invoice)) {
          return fail('UPSTREAM_ERROR: Unexpected invoice payload from the Inio API.');
        }
        const text = JSON.stringify(revealPii ? invoice : redact(invoice));
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return fail(errorText(err));
      }
    }),
  );
}
