import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { InioClient } from '../inio-client.ts';
import { noopLogger, type Logger } from '../logger.ts';
import { REDACTION_NOTE } from '../redact.ts';
import { InvoiceRef, invoicePath, lookUpInvoiceId } from './invoice-ref.ts';
import {
  acceptedUnreadable,
  errorText,
  EXACTLY_ONE_REF,
  exactlyOneRef,
  fail,
  IsoDate,
  ok,
  present,
  writeFailure,
} from './result.ts';
import { withToolLogging } from '../tool-logging.ts';

type Deps = {
  client: Pick<InioClient, 'get' | 'post'>;
  revealPii: boolean;
  logger?: Pick<Logger, 'info'>;
};

const Input = z
  .strictObject({
    ...InvoiceRef,
    number: InvoiceRef.number.describe(
      'Business invoice number, e.g. INV-1001; looked up first, so this makes two API calls',
    ),
    targetStage: z
      .enum(['invoiced', 'reminded'])
      .describe('Stage to return to: invoiced (needs dueDate) or reminded'),
    reason: z.string().min(1).max(100).describe('Why the stage is reset, 1-100 characters'),
    redistribute: z
      .boolean()
      .default(false)
      .describe('true re-sends the invoice or reminder to the end customer; default false'),
    dueDate: IsoDate.optional().describe(
      'New due date, YYYY-MM-DD, after today; required for invoiced, not allowed for reminded',
    ),
  })
  .refine(exactlyOneRef, EXACTLY_ONE_REF)
  .refine((a) => a.targetStage !== 'invoiced' || a.dueDate !== undefined, {
    message: 'dueDate is required when targetStage is invoiced.',
  })
  .refine((a) => a.targetStage !== 'reminded' || a.dueDate === undefined, {
    message: 'dueDate is not allowed when targetStage is reminded.',
  });

// Unknown keys (workflowId among them) are stripped.
const Plan = z.object({
  targetStage: z.unknown(),
  dueDate: z.unknown(),
  plannedSteps: z.unknown(),
  feeWaiveAmount: z.unknown(),
  feePaidKept: z.unknown(),
  willWaiveOutstandingFee: z.unknown(),
  willRedistribute: z.unknown(),
  willReRunSetup: z.unknown(),
});

export function registerResetInvoiceStage(
  server: McpServer,
  { client, revealPii, logger = noopLogger }: Deps,
): void {
  server.registerTool(
    'reset_invoice_stage',
    {
      title: 'Reset invoice stage',
      description:
        'Reset an invoice back to an earlier stage (invoiced or reminded), by UUID (id) or invoice number (number); pass exactly one. Starts a workflow: outstanding fees may be waived, and redistribute: true re-sends the invoice or reminder to the end customer. This cannot be undone with these tools. Returns the plan the API made: planned steps, fees waived or kept, and whether it redistributes. ' +
        REDACTION_NOTE,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: Input,
    },
    withToolLogging(
      logger,
      'reset_invoice_stage',
      async ({ id, number, targetStage, dueDate, reason, redistribute }) => {
        let invoiceId: string;
        try {
          // reset-stage exists only by id, so a number costs an extra lookup; a failed lookup is an
          // error, not an accepted write.
          invoiceId = id ?? (await lookUpInvoiceId(client, number ?? ''));
        } catch (err) {
          return fail(errorText(err));
        }
        try {
          // dueDate only when given: the API rejects it for reminded.
          const body = { targetStage, ...(dueDate && { dueDate }), reason, redistribute };
          const plan = Plan.safeParse(
            await client.post(`${invoicePath({ id: invoiceId })}/reset-stage`, body),
          );
          if (!plan.success) return acceptedUnreadable();
          return ok(present(plan.data, revealPii));
        } catch (err) {
          return writeFailure(err);
        }
      },
    ),
  );
}
