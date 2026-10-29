import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { pathSegment, type InioClient } from '../inio-client.ts';
import { noopLogger, type Logger } from '../auth.ts';
import { PauseReason, pauseResult, PauseScope } from './pauses.ts';
import { errorText, fail, IsoDate } from './result.ts';
import { withToolLogging } from '../tool-logging.ts';

type Deps = { client: InioClient; revealPii: boolean; logger?: Pick<Logger, 'info'> };

const Input = z
  .strictObject({
    customerId: z.uuid().describe('Customer UUID'),
    scope: PauseScope.describe(
      'What to pause: reminders, dcTransfers (debt-collection transfers) or both',
    ),
    startAt: IsoDate.describe('First day of the pause, YYYY-MM-DD, tomorrow or later (UTC)'),
    endAt: IsoDate.optional().describe(
      'Last day of the pause, YYYY-MM-DD, after startAt; omit for an indefinite pause',
    ),
    reason: PauseReason.describe('Why the pause is created, 1-255 characters'),
  })
  // ISO dates compare correctly as strings. "Tomorrow or later" is left to the API (its clock, UTC).
  .refine((a) => a.endAt === undefined || a.endAt > a.startAt, {
    message: 'endAt must be after startAt.',
  });

export function registerCreateCustomerPause(
  server: McpServer,
  { client, revealPii, logger = noopLogger }: Deps,
): void {
  server.registerTool(
    'create_customer_pause',
    {
      title: 'Create customer pause',
      description:
        'Create a pause for one customer that suspends reminders, debt-collection transfers or both (scope) from startAt, which must be tomorrow or later (UTC), until endAt; leave endAt out for an indefinite pause. Overlapping pauses of the same scope are rejected. Returns the created pause. Personal data is redacted unless the server runs with INIO_REVEAL_PII=true.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: Input,
    },
    withToolLogging(logger, 'create_customer_pause', async ({ customerId, ...body }) => {
      try {
        const path = `/customers/${pathSegment(customerId)}/pauses`;
        return pauseResult(await client.post(path, body), revealPii);
      } catch (err) {
        return fail(errorText(err));
      }
    }),
  );
}
