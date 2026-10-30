import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { pathSegment, type InioClient } from '../inio-client.ts';
import { noopLogger, type Logger } from '../logger.ts';
import { compact, errorText, fail, ok, presentRaw } from './result.ts';
import { withToolLogging } from '../tool-logging.ts';

type Deps = { client: Pick<InioClient, 'get'>; revealPii: boolean; logger?: Pick<Logger, 'info'> };

const Input = z.strictObject({
  customerId: z.uuid().describe('Customer UUID'),
  status: z
    .enum(['scheduled', 'active', 'completed', 'cancelled'])
    .optional()
    .describe('Pause status filter: scheduled, active, completed or cancelled'),
});

// The API returns a bare array with no paging.
const Payload = z.array(z.record(z.string(), z.unknown()));

export function registerListCustomerPauses(
  server: McpServer,
  { client, revealPii, logger = noopLogger }: Deps,
): void {
  server.registerTool(
    'list_customer_pauses',
    {
      title: 'List customer pauses',
      description:
        'List pauses for one customer by customer UUID (get_customer returns it), optionally filtered by status. Returns all matching pauses ordered by start time. Personal data is redacted unless the server runs with INIO_REVEAL_PII=true.',
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: Input,
    },
    withToolLogging(logger, 'list_customer_pauses', async ({ customerId, status }) => {
      try {
        const parsed = Payload.safeParse(
          await client.get(`/customers/${pathSegment(customerId)}/pauses`, { query: { status } }),
        );
        if (!parsed.success) {
          return fail('UPSTREAM_ERROR: Unexpected pause payload from the Inio API.');
        }
        // temporalWorkflowId is internal plumbing; compact each pause, not the wrapper.
        const pauses = parsed.data.map((raw) => {
          const { temporalWorkflowId: _, ...pause } = raw;
          return compact(pause);
        });
        return ok(presentRaw({ pauses }, revealPii));
      } catch (err) {
        return fail(errorText(err));
      }
    }),
  );
}
