import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { pathSegment, type InioClient } from '../inio-client.ts';
import { noopLogger, type Logger } from '../auth.ts';
import { errorText, fail, ok, present } from './result.ts';
import { withToolLogging } from '../tool-logging.ts';

type Deps = { client: InioClient; revealPii: boolean; logger?: Pick<Logger, 'info'> };

const Input = z.strictObject({
  customerId: z.uuid().describe('Customer UUID'),
  pauseId: z.uuid().describe('Pause UUID'),
});

const Payload = z.record(z.string(), z.unknown());

export function registerGetCustomerPause(
  server: McpServer,
  { client, revealPii, logger = noopLogger }: Deps,
): void {
  server.registerTool(
    'get_customer_pause',
    {
      title: 'Get customer pause',
      description:
        'Fetch one customer pause by customer UUID and pause UUID. Personal data is redacted unless the server runs with INIO_REVEAL_PII=true.',
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: Input,
    },
    withToolLogging(logger, 'get_customer_pause', async ({ customerId, pauseId }) => {
      try {
        const parsed = Payload.safeParse(
          await client.get(`/customers/${pathSegment(customerId)}/pauses/${pathSegment(pauseId)}`),
        );
        if (!parsed.success) {
          return fail('UPSTREAM_ERROR: Unexpected pause payload from the Inio API.');
        }
        // temporalWorkflowId is internal plumbing, not for the model.
        const { temporalWorkflowId: _, ...pause } = parsed.data;
        return ok(present(pause, revealPii));
      } catch (err) {
        return fail(errorText(err));
      }
    }),
  );
}
