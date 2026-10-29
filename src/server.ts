import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { createTokenProvider, noopLogger, type Logger } from './auth.ts';
import type { Config } from './config.ts';
import { createInioClient } from './inio-client.ts';
import { registerGetCustomer } from './tools/get-customer.ts';
import { registerGetCustomerPause } from './tools/get-customer-pause.ts';
import { registerGetInvoice } from './tools/get-invoice.ts';
import { registerGetInvoiceRetryAttempts } from './tools/get-invoice-retry-attempts.ts';
import { registerListCustomerPauses } from './tools/list-customer-pauses.ts';
import { registerListCustomers } from './tools/list-customers.ts';
import { registerListInvoices } from './tools/list-invoices.ts';

// Read at runtime: a JSON import would sit outside rootDir and break the dist layout.
export const { version } = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')));

type Deps = { fetch?: typeof globalThis.fetch; logger?: Logger };

/** Builds the MCP server with its token provider, API client and tools. */
export function createServer(config: Config, { fetch, logger = noopLogger }: Deps = {}): McpServer {
  const server = new McpServer({ name: 'inio-mcp', version });
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
  const deps = { client, revealPii: config.revealPii, logger };
  registerGetInvoice(server, deps);
  registerGetInvoiceRetryAttempts(server, deps);
  registerListCustomers(server, deps);
  registerListInvoices(server, deps);
  registerGetCustomer(server, deps);
  registerListCustomerPauses(server, deps);
  registerGetCustomerPause(server, deps);
  return server;
}
