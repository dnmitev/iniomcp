import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { pathSegment, type InioClient } from '../inio-client.ts';
import { noopLogger, type Logger } from '../logger.ts';
import { REDACTION_NOTE } from '../redact.ts';
import { PauseReason, pauseResult } from './pauses.ts';
import { writeFailure } from './result.ts';
import { withToolLogging } from '../tool-logging.ts';

type Deps = { client: InioClient; revealPii: boolean; logger?: Pick<Logger, 'info'> };

const Input = z.strictObject({
  customerId: z.uuid().describe('Customer UUID'),
  pauseId: z.uuid().describe('Pause UUID'),
  reason: PauseReason.describe('Why the pause is cancelled, 1-255 characters'),
});

export function registerCancelCustomerPause(
  server: McpServer,
  { client, revealPii, logger = noopLogger }: Deps,
): void {
  server.registerTool(
    'cancel_customer_pause',
    {
      title: 'Cancel customer pause',
      description:
        'Cancel a scheduled or active customer pause. This cannot be undone with these tools; create a new pause instead. Returns the cancelled pause. ' +
        REDACTION_NOTE,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: Input,
    },
    withToolLogging(logger, 'cancel_customer_pause', async ({ customerId, pauseId, reason }) => {
      try {
        const path = `/customers/${pathSegment(customerId)}/pauses/${pathSegment(pauseId)}/cancel`;
        return pauseResult(await client.post(path, { reason }), revealPii, true);
      } catch (err) {
        return writeFailure(err);
      }
    }),
  );
}
