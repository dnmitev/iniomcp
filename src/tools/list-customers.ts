import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { InioClient } from '../inio-client.ts';
import { noopLogger, type Logger } from '../logger.ts';
import { errorText, fail, ok, PageInput, presentPage } from './result.ts';
import { withToolLogging } from '../tool-logging.ts';

type Deps = { client: Pick<InioClient, 'get'>; revealPii: boolean; logger?: Pick<Logger, 'info'> };

const Input = z
  .strictObject({
    customerNo: z
      .string()
      .min(1)
      .max(50)
      .regex(/^[^\p{Cc}]+$/u)
      .optional()
      .describe('Exact customer number, e.g. C-1001'),
    directDebit: z
      .boolean()
      .optional()
      .describe('Only customers with (true) or without direct debit'),
    serviceLineId: z.uuid().optional().describe('Service line UUID'),
    sort: z
      .enum(['customerName', 'customerNo', 'createdAt', 'updatedAt'])
      .optional()
      .describe('Sort field (customerName, customerNo, createdAt or updatedAt)'),
    order: z.enum(['asc', 'desc']).optional().describe('Sort order; requires sort, default asc'),
    ...PageInput,
  })
  .refine((a) => a.order === undefined || a.sort !== undefined, {
    message: 'order requires sort.',
  });

// Summary fields only; details and most PII stay behind get_customer.
const SUMMARY_FIELDS = [
  'id',
  'customerNo',
  'customerName',
  'customerType',
  'serviceLineName',
  'directDebit',
  'orgNr',
  'createdAt',
] as const;

export function registerListCustomers(
  server: McpServer,
  { client, revealPii, logger = noopLogger }: Deps,
): void {
  server.registerTool(
    'list_customers',
    {
      title: 'List customers',
      description:
        'List customer summaries, filtered by customerNo, directDebit or serviceLineId, with sort and limit/offset paging. Use get_customer for full details. Personal data is redacted unless the server runs with INIO_REVEAL_PII=true.',
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: Input,
    },
    withToolLogging(logger, 'list_customers', async (args) => {
      const { limit, offset, customerNo, directDebit, serviceLineId, sort, order } = args;
      try {
        const payload = await client.get('/customers', {
          query: {
            limit,
            offset,
            customerNo,
            directDebit,
            serviceLineId,
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
