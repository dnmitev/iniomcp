import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { InioClient } from '../inio-client.ts';
import { noopLogger, type Logger } from '../logger.ts';
import { InvoiceRef, invoicePath } from './invoice-ref.ts';
import {
  compact,
  errorText,
  EXACTLY_ONE_REF,
  exactlyOneRef,
  fail,
  ok,
  presentRaw,
} from './result.ts';
import { withToolLogging } from '../tool-logging.ts';

type Deps = { client: Pick<InioClient, 'get'>; revealPii: boolean; logger?: Pick<Logger, 'info'> };

const Input = z
  .strictObject({
    ...InvoiceRef,
    // The API ignores `page` (same items on every page), so only limit is exposed.
    limit: z.int().min(1).max(50).default(10).describe('Maximum attempts to return, 1-50'),
  })
  .refine(exactlyOneRef, EXACTLY_ONE_REF);

const Payload = z.object({
  data: z.array(z.unknown()),
  failedPaymentCount: z.unknown(),
  successfullAtemptsCount: z.unknown(),
  directDebitEligible: z.unknown(),
});

export function registerGetInvoiceRetryAttempts(
  server: McpServer,
  { client, revealPii, logger = noopLogger }: Deps,
): void {
  server.registerTool(
    'get_invoice_retry_attempts',
    {
      title: 'Get invoice retry attempts',
      description:
        'Direct-debit retry attempts for one invoice, by UUID (id) or invoice number (number), newest first. Returns attempts plus failed and successful counts and whether the invoice is eligible for direct debit.',
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: Input,
    },
    withToolLogging(logger, 'get_invoice_retry_attempts', async ({ id, number, limit }) => {
      try {
        const parsed = Payload.safeParse(
          await client.get(`${invoicePath({ id, number })}/retry-attempts`, { query: { limit } }),
        );
        if (!parsed.success) {
          return fail('UPSTREAM_ERROR: Unexpected retry attempts payload from the Inio API.');
        }
        const { data, failedPaymentCount, successfullAtemptsCount, directDebitEligible } =
          parsed.data;
        // totalItems is dropped: it is only the page length. Compact the attempts, not the
        // wrapper, so an empty list and zero counts survive.
        const result = {
          attempts: compact(data),
          failedPaymentCount,
          successfulAttemptsCount: successfullAtemptsCount,
          directDebitEligible,
        };
        return ok(presentRaw(result, revealPii));
      } catch (err) {
        return fail(errorText(err));
      }
    }),
  );
}
