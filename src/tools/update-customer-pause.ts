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
    pauseId: z.uuid().describe('Pause UUID'),
    startAt: IsoDate.optional().describe('New first day, YYYY-MM-DD (scheduled pauses only)'),
    endAt: IsoDate.nullable()
      .optional()
      .describe('New last day, YYYY-MM-DD, or null for an indefinite pause'),
    scope: PauseScope.optional().describe(
      'New scope: reminders, dcTransfers or both (scheduled pauses only)',
    ),
    reason: PauseReason.describe('Why the pause is changed, 1-255 characters'),
  })
  .refine((a) => a.startAt !== undefined || a.endAt !== undefined || a.scope !== undefined, {
    message: 'Provide at least one of startAt, endAt or scope.',
  })
  // Only checkable when both are given; the API checks the rest against the stored pause.
  .refine((a) => !a.startAt || !a.endAt || a.endAt > a.startAt, {
    message: 'endAt must be after startAt.',
  });

export function registerUpdateCustomerPause(
  server: McpServer,
  { client, revealPii, logger = noopLogger }: Deps,
): void {
  server.registerTool(
    'update_customer_pause',
    {
      title: 'Update customer pause',
      description:
        'Change a customer pause: scheduled pauses can change startAt, endAt and scope; active pauses can change only endAt (null makes it indefinite). Completed or cancelled pauses cannot be changed. Changes that overlap another pause of the same scope are rejected. Returns the updated pause. Personal data is redacted unless the server runs with INIO_REVEAL_PII=true.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: Input,
    },
    // Absent keys stay absent in the parsed input, so the body carries only what is changed.
    withToolLogging(logger, 'update_customer_pause', async ({ customerId, pauseId, ...body }) => {
      try {
        const path = `/customers/${pathSegment(customerId)}/pauses/${pathSegment(pauseId)}`;
        return pauseResult(await client.patch(path, body), revealPii);
      } catch (err) {
        return fail(errorText(err));
      }
    }),
  );
}
