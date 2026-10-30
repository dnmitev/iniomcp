import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { InioClient } from '../inio-client.ts';
import { noopLogger, type Logger } from '../logger.ts';
import { CustomerRef, customerPath } from './customer-ref.ts';
import { errorText, EXACTLY_ONE_REF, exactlyOneRef, fail, ok, present } from './result.ts';
import { withToolLogging } from '../tool-logging.ts';

type Deps = { client: Pick<InioClient, 'get'>; revealPii: boolean; logger?: Pick<Logger, 'info'> };

const Input = z
  .strictObject({
    ...CustomerRef,
    includeWorkflowSettings: z
      .boolean()
      .default(false)
      .describe(
        'Include workflowsSettings: how and when each stage (setup, invoicing1-4, paid, credit) is distributed (email, SMS, paper), escalation fees and timing, and which stages are enabled. Leave false unless the question is about these.',
      ),
  })
  .refine(exactlyOneRef, EXACTLY_ONE_REF);

const AnyObject = z.record(z.string(), z.unknown());

const Payload = z.object({
  externalCustomer: AnyObject,
  serviceLine: z.unknown(),
  effectivePause: z.unknown(),
});

/** Copy of an object without workflowsSettings; non-objects (e.g. a null serviceLine) pass through. */
function withoutWorkflowSettings(value: unknown): unknown {
  const parsed = AnyObject.safeParse(value);
  if (!parsed.success) return value;
  const { workflowsSettings: _, ...rest } = parsed.data;
  return rest;
}

export function registerGetCustomer(
  server: McpServer,
  { client, revealPii, logger = noopLogger }: Deps,
): void {
  server.registerTool(
    'get_customer',
    {
      title: 'Get customer',
      description:
        'Fetch one customer with its service line and any active pause, by UUID (id) or customer number (number); pass exactly one. Personal data is redacted unless the server runs with INIO_REVEAL_PII=true.',
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: Input,
    },
    withToolLogging(logger, 'get_customer', async ({ id, number, includeWorkflowSettings }) => {
      try {
        const path = customerPath({ id, number });
        const parsed = Payload.safeParse(await client.get(path));
        if (!parsed.success) {
          return fail('UPSTREAM_ERROR: Unexpected customer payload from the Inio API.');
        }
        const { externalCustomer, serviceLine, effectivePause } = parsed.data;
        // workflowsSettings (on customer and service line) is large and rarely relevant; opt-in only.
        const result = includeWorkflowSettings
          ? { customer: externalCustomer, serviceLine, effectivePause }
          : {
              customer: withoutWorkflowSettings(externalCustomer),
              serviceLine: withoutWorkflowSettings(serviceLine),
              effectivePause,
            };
        return ok(present(result, revealPii));
      } catch (err) {
        return fail(errorText(err));
      }
    }),
  );
}
