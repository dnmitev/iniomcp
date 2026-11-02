import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { createTokenProvider } from './auth.ts';
import { noopLogger, type Logger } from './logger.ts';
import { WRITE_TOOL_NAMES, type Config } from './config.ts';
import { createInioClient } from './inio-client.ts';
import type { CustomerKind } from './redact.ts';
import { registerCancelCustomerPause } from './tools/cancel-customer-pause.ts';
import { registerCreateCreditInvoice } from './tools/create-credit-invoice.ts';
import { registerCreateCustomer } from './tools/create-customer.ts';
import { registerCreatePayment } from './tools/create-payment.ts';
import { registerCreateCustomerPause } from './tools/create-customer-pause.ts';
import { registerGetCustomer } from './tools/get-customer.ts';
import { registerGetCustomerPause } from './tools/get-customer-pause.ts';
import { registerGetInvoice } from './tools/get-invoice.ts';
import { registerGetInvoiceRetryAttempts } from './tools/get-invoice-retry-attempts.ts';
import { registerListCustomerPauses } from './tools/list-customer-pauses.ts';
import { registerListCustomers } from './tools/list-customers.ts';
import { registerListInvoices } from './tools/list-invoices.ts';
import { registerMatchCreditInvoice } from './tools/match-credit-invoice.ts';
import { registerResetInvoiceStage } from './tools/reset-invoice-stage.ts';
import { registerUpdateCustomer } from './tools/update-customer.ts';
import { registerUpdateCustomerPause } from './tools/update-customer-pause.ts';
import { registerUpdateInvoiceDueDate } from './tools/update-invoice-due-date.ts';
import { registerUpdateInvoiceStopUntilDates } from './tools/update-invoice-stop-until-dates.ts';

// Read at runtime: a JSON import would sit outside rootDir and break the dist layout.
export const { version } = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')));

type Deps = { fetch?: typeof globalThis.fetch; logger?: Logger };

/** Builds the token provider and API client once; each call of the result yields a fresh server with tools. */
export function createServerFactory(
  config: Config,
  { fetch, logger = noopLogger }: Deps = {},
): () => McpServer {
  const tokens = createTokenProvider({
    authUrl: config.authUrl,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    fetch,
    logger,
    timeoutMs: config.requestTimeoutMs,
  });
  const client = createInioClient({
    apiUrl: config.apiUrl,
    tokens,
    fetch,
    logger,
    timeoutMs: config.requestTimeoutMs,
  });
  const customerTypes = new Map<string, CustomerKind>();
  return () => {
    const server = new McpServer({ name: 'inio-mcp', version });
    const deps = {
      client,
      revealPii: config.revealPii,
      logger,
      toolLog: { client: () => server.server.getClientVersion() },
    };
    registerGetInvoice(server, { ...deps, customerTypes });
    registerGetInvoiceRetryAttempts(server, deps);
    registerListCustomers(server, deps);
    registerListInvoices(server, deps);
    registerGetCustomer(server, deps);
    registerListCustomerPauses(server, deps);
    registerGetCustomerPause(server, deps);
    // Write tools exist only when explicitly enabled (INIO_ALLOW_WRITES=true), narrowed by INIO_WRITE_TOOLS.
    if (config.allowWrites) {
      const writeDeps = { ...deps, toolLog: { ...deps.toolLog, write: true } };
      const writers: Record<(typeof WRITE_TOOL_NAMES)[number], () => void> = {
        create_customer_pause: () => registerCreateCustomerPause(server, writeDeps),
        update_customer_pause: () => registerUpdateCustomerPause(server, writeDeps),
        cancel_customer_pause: () => registerCancelCustomerPause(server, writeDeps),
        update_invoice_due_date: () => registerUpdateInvoiceDueDate(server, writeDeps),
        update_invoice_stop_until_dates: () =>
          registerUpdateInvoiceStopUntilDates(server, writeDeps),
        update_customer: () => registerUpdateCustomer(server, writeDeps),
        reset_invoice_stage: () => registerResetInvoiceStage(server, writeDeps),
        create_credit_invoice: () => registerCreateCreditInvoice(server, writeDeps),
        match_credit_invoice: () => registerMatchCreditInvoice(server, writeDeps),
        create_payment: () =>
          registerCreatePayment(server, {
            ...writeDeps,
            tokens,
            maxPaymentAmount: config.maxPaymentAmount,
          }),
        create_customer: () => registerCreateCustomer(server, { ...writeDeps, tokens }),
      };
      for (const name of WRITE_TOOL_NAMES) if (config.writeTools.has(name)) writers[name]();
    }
    return server;
  };
}

/** Builds a single MCP server (stdio). */
export function createServer(config: Config, deps: Deps = {}): McpServer {
  return createServerFactory(config, deps)();
}
