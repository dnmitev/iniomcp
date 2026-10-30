import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { pathSegment, type InioClient } from '../inio-client.ts';
import { noopLogger, type Logger } from '../logger.ts';
import { REDACTION_NOTE } from '../redact.ts';
import { pauseResult } from './pauses.ts';
import { errorText, fail } from './result.ts';
import { withToolLogging } from '../tool-logging.ts';

type Deps = { client: Pick<InioClient, 'get'>; revealPii: boolean; logger?: Pick<Logger, 'info'> };

const Input = z.strictObject({
  customerId: z.uuid().describe('Customer UUID'),
  pauseId: z.uuid().describe('Pause UUID'),
});

export function registerGetCustomerPause(
  server: McpServer,
  { client, revealPii, logger = noopLogger }: Deps,
): void {
  server.registerTool(
    'get_customer_pause',
    {
      title: 'Get customer pause',
      description: 'Fetch one customer pause by customer UUID and pause UUID. ' + REDACTION_NOTE,
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: Input,
    },
    withToolLogging(logger, 'get_customer_pause', async ({ customerId, pauseId }) => {
      try {
        const path = `/customers/${pathSegment(customerId)}/pauses/${pathSegment(pauseId)}`;
        return pauseResult(await client.get(path), revealPii);
      } catch (err) {
        return fail(errorText(err));
      }
    }),
  );
}
