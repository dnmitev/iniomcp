import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { InioClient } from '../inio-client.ts';
import { noopLogger, type Logger } from '../auth.ts';
import { errorText, fail, ok, PageInput, presentPage } from './result.ts';
import { withToolLogging } from '../tool-logging.ts';

type Deps = { client: Pick<InioClient, 'get'>; revealPii: boolean; logger?: Pick<Logger, 'info'> };

const NoControlChars = /^[^\p{Cc}]+$/u;

const Input = z
  .strictObject({
    invoiceNo: z
      .string()
      .min(1)
      .max(100)
      .regex(NoControlChars)
      .optional()
      .describe('Exact invoice number, e.g. INV-1001'),
    customerId: z.uuid().optional().describe('Customer UUID; not together with customerNo'),
    customerNo: z
      .string()
      .min(1)
      .max(50)
      .regex(NoControlChars)
      .optional()
      .describe('Exact customer number, e.g. C-1001; not together with customerId'),
    status: z
      .array(z.enum(['open', 'paused', 'cancelled', 'closed']))
      .min(1)
      .max(4)
      .optional()
      .describe('Invoice status filter, any of open, paused, cancelled, closed'),
    paymentStatus: z
      .array(z.enum(['notPaid', 'paid', 'overPaid', 'partiallyPaid', 'capitalPaid']))
      .min(1)
      .max(5)
      .optional()
      .describe(
        'Payment status filter, any of notPaid, paid, overPaid, partiallyPaid, capitalPaid',
      ),
    sort: z
      .enum([
        'invoiceNo',
        'invoiceDate',
        'dueDate',
        'totalAmount',
        'remainingAmount',
        'createdAt',
        'updatedAt',
      ])
      .optional()
      .describe(
        'Sort field (invoiceNo, invoiceDate, dueDate, totalAmount, remainingAmount, createdAt or updatedAt)',
      ),
    order: z.enum(['asc', 'desc']).optional().describe('Sort order; requires sort, default asc'),
    ...PageInput,
  })
  .refine((a) => a.order === undefined || a.sort !== undefined, {
    message: 'order requires sort.',
  })
  .refine((a) => a.customerId === undefined || a.customerNo === undefined, {
    message: 'Provide at most one of customerId or customerNo.',
  });

// Summary fields only; the full invoice (about 9 KB, with PII) stays behind get_invoice.
const SUMMARY_FIELDS = [
  'id',
  'invoiceNo',
  'customerNo',
  'invoiceDate',
  'dueDate',
  'currency',
  'totalAmount',
  'remainingAmount',
  'status',
  'stage',
  'paymentStatus',
] as const;

export function registerListInvoices(
  server: McpServer,
  { client, revealPii, logger = noopLogger }: Deps,
): void {
  server.registerTool(
    'list_invoices',
    {
      title: 'List invoices',
      description:
        'List invoice summaries, filtered by invoiceNo, customerId or customerNo (not both), status or paymentStatus, with sort and limit/offset paging. Use get_invoice for full details. Personal data is redacted unless the server runs with INIO_REVEAL_PII=true.',
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: Input,
    },
    withToolLogging(logger, 'list_invoices', async (args) => {
      const { limit, offset, invoiceNo, customerId, customerNo, status, paymentStatus } = args;
      const { sort, order } = args;
      try {
        const payload = await client.get('/invoices', {
          query: {
            limit,
            offset,
            invoiceNo,
            customerId,
            customerNo,
            // The API answers a single or comma-separated status with HTTP 500
            // (parseCommaSeparated in invoices.controller); repeated keys work.
            status: status?.length === 1 ? [...status, ...status] : status,
            paymentStatus,
            sort,
            order: sort === undefined ? undefined : (order ?? 'asc'),
          },
        });
        return ok(presentPage(payload, SUMMARY_FIELDS, revealPii));
      } catch (err) {
        return fail(errorText(err));
      }
    }),
  );
}
