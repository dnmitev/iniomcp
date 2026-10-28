import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createTokenProvider } from '../../src/auth.ts';
import { loadConfig } from '../../src/config.ts';

// Never log payloads or env here: test output must not contain credentials or invoice data.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const Item = z.object({ invoiceNo: z.string().min(1) });
const ListBody = z.object({
  result: z.union([
    z.array(Item).min(1),
    z.object({ items: z.array(Item).min(1) }).transform((r) => r.items),
    z.object({ data: z.array(Item).min(1) }).transform((r) => r.data),
  ]),
});

/** INIO_LIVE_INVOICE_NUMBER, else the first invoice from the list endpoint. */
async function pickInvoiceNo(): Promise<string> {
  const fromEnv = process.env.INIO_LIVE_INVOICE_NUMBER;
  if (fromEnv) return fromEnv;
  const config = loadConfig(process.env);
  const token = await createTokenProvider(config).getToken();
  const res = await fetch(`${config.apiUrl}/invoices?limit=1`, {
    headers: { authorization: `Bearer ${token}` },
  });
  // Status only: the body may contain invoice data.
  if (!res.ok) throw new Error(`invoice list failed with HTTP ${res.status}`);
  const parsed = ListBody.safeParse(await res.json());
  if (!parsed.success) throw new Error('invoice list has an unexpected shape');
  const [first] = parsed.data.result;
  if (!first) throw new Error('invoice list is empty');
  return first.invoiceNo;
}

describe.skipIf(process.env.INIO_LIVE !== '1')('live Inio test environment', () => {
  let client: Client;
  let invoiceNo: string;

  async function call(args: Record<string, string>) {
    const result = await client.callTool({ name: 'get_invoice', arguments: args });
    const content = z.array(z.object({ type: z.string(), text: z.string() })).parse(result.content);
    return { isError: result.isError === true, count: content.length, text: content[0]?.text };
  }

  async function callTool(name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args });
    const content = z.array(z.object({ type: z.string(), text: z.string() })).parse(result.content);
    return { isError: result.isError === true, count: content.length, text: content[0]?.text };
  }

  /** Lists two customers; returns booleans and ids only so failures never print customer data. */
  async function listTwoCustomers() {
    const { isError, text } = await callTool('list_customers', { limit: 2 });
    expect(isError).toBe(false);
    const page = z
      .object({
        items: z.array(z.record(z.string(), z.unknown())),
        total: z.number(),
        limit: z.number(),
        offset: z.number(),
      })
      .parse(JSON.parse(text ?? ''));
    return page;
  }

  /** True when every PII-looking key in the customer carries "[redacted]"; never returns values. */
  function piiRedacted(customer: Record<string, unknown>): boolean {
    return Object.entries(customer)
      .filter(([k]) => /^(ssn|iban|zipcode|addressline\d*)$|email/i.test(k))
      .every(([, v]) => v === '[redacted]');
  }

  beforeAll(async () => {
    const env: Record<string, string> = { PATH: process.env.PATH ?? '' };
    for (const [k, v] of Object.entries(process.env)) {
      if (k.startsWith('INIO_') && v !== undefined) env[k] = v;
    }
    invoiceNo = await pickInvoiceNo();
    client = new Client({ name: 'live-test', version: '0.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ['dist/index.js'],
        cwd: ROOT,
        env,
        stderr: 'pipe',
      }),
    );
  }, 30_000);

  afterAll(async () => {
    await client?.close();
  });

  it('returns a redacted, non-envelope invoice by number', async () => {
    const { isError, count, text } = await call({ number: invoiceNo });
    expect({ isError, count }).toEqual({ isError: false, count: 1 });
    const inv = z.record(z.string(), z.unknown()).parse(JSON.parse(text ?? ''));
    expect(Object.keys(inv)).not.toContain('result');
    expect(Object.keys(inv)).not.toContain('success');
    // Compare booleans, not values, so a mismatch never prints invoice data.
    expect(inv.invoiceNo === invoiceNo).toBe(true);
    expect('IBAN' in inv ? inv.IBAN === '[redacted]' : true).toBe(true);
  }, 30_000);

  it('returns NOT_FOUND for an unknown invoice number', async () => {
    const { isError, count, text } = await call({ number: `no-such-invoice-${Date.now()}` });
    expect({ isError, count }).toEqual({ isError: true, count: 1 });
    expect(text?.startsWith('NOT_FOUND: ')).toBe(true);
  }, 30_000);

  const SUMMARY_KEYS = [
    'id',
    'customerNo',
    'customerName',
    'customerType',
    'serviceLineName',
    'directDebit',
    'orgNr',
    'createdAt',
  ];

  it('lists customers as summaries only', async () => {
    const page = await listTwoCustomers();
    expect(page.limit).toBe(2);
    expect(page.items.length <= 2).toBe(true);
    expect(page.items.length > 0).toBe(true);
    const extraKeys = page.items
      .flatMap((i) => Object.keys(i))
      .filter((k) => !SUMMARY_KEYS.includes(k));
    expect(extraKeys).toEqual([]);
  }, 30_000);

  it('gets the first listed customer by id, compact and redacted', async () => {
    const [first] = (await listTwoCustomers()).items;
    const id = z.string().parse(first?.id);
    const { isError, count, text } = await callTool('get_customer', { id });
    expect({ isError, count }).toEqual({ isError: false, count: 1 });
    const body = z
      .object({ customer: z.record(z.string(), z.unknown()) })
      .parse(JSON.parse(text ?? ''));
    expect(body.customer.id === id).toBe(true);
    expect(Object.keys(body)).not.toContain('externalCustomer');
    expect(text?.includes(':null')).toBe(false);
    expect(text?.includes('@')).toBe(false);
    expect(piiRedacted(body.customer)).toBe(true);
  }, 30_000);

  it('gets the first listed customer by number', async () => {
    const [first] = (await listTwoCustomers()).items;
    const id = z.string().parse(first?.id);
    const number = z.string().parse(first?.customerNo);
    const { isError, count, text } = await callTool('get_customer', { number });
    expect({ isError, count }).toEqual({ isError: false, count: 1 });
    const body = z
      .object({ customer: z.record(z.string(), z.unknown()) })
      .parse(JSON.parse(text ?? ''));
    expect(body.customer.id === id).toBe(true);
    expect(text?.includes('@')).toBe(false);
    expect(piiRedacted(body.customer)).toBe(true);
  }, 30_000);

  const INVOICE_SUMMARY_KEYS = [
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
  ];

  /** Booleans only: lists closed invoices and returns the first invoiceNo. */
  async function firstClosedInvoiceNo(): Promise<string> {
    const { isError, text } = await callTool('list_invoices', { status: ['closed'], limit: 2 });
    expect(isError).toBe(false);
    const page = z
      .object({ items: z.array(z.record(z.string(), z.unknown())), total: z.number() })
      .parse(JSON.parse(text ?? ''));
    expect(page.items.length > 0).toBe(true);
    const extraKeys = page.items
      .flatMap((i) => Object.keys(i))
      .filter((k) => !INVOICE_SUMMARY_KEYS.includes(k));
    expect(extraKeys).toEqual([]);
    return z.string().parse(page.items[0]?.invoiceNo);
  }

  it('lists closed invoices as summaries only', async () => {
    expect((await firstClosedInvoiceNo()).length > 0).toBe(true);
  }, 30_000);

  it('lists open invoices without an error (single-status workaround)', async () => {
    const { isError } = await callTool('list_invoices', { status: ['open'], limit: 1 });
    expect(isError).toBe(false);
  }, 30_000);

  it('lists paid invoices without an error', async () => {
    const { isError } = await callTool('list_invoices', { paymentStatus: ['paid'], limit: 1 });
    expect(isError).toBe(false);
  }, 30_000);

  it('gets an invoice by number with inherited values, redacted', async () => {
    const number = await firstClosedInvoiceNo();
    const { isError, count, text } = await callTool('get_invoice', {
      number,
      withInherited: true,
    });
    expect({ isError, count }).toEqual({ isError: false, count: 1 });
    const inv = z.record(z.string(), z.unknown()).parse(JSON.parse(text ?? ''));
    expect(inv.invoiceNo === number).toBe(true);
    expect('IBAN' in inv ? inv.IBAN === '[redacted]' : true).toBe(true);
    expect(text?.includes('@')).toBe(false);
  }, 30_000);

  it('gets retry attempts by invoice number', async () => {
    const number = await firstClosedInvoiceNo();
    const { isError, text } = await callTool('get_invoice_retry_attempts', { number });
    expect(isError).toBe(false);
    const body = z
      .object({ attempts: z.array(z.unknown()), directDebitEligible: z.boolean() })
      .safeParse(JSON.parse(text ?? ''));
    expect(body.success).toBe(true);
  }, 30_000);

  it('lists pauses for the customer of an invoice without temporalWorkflowId', async () => {
    const number = await firstClosedInvoiceNo();
    const inv = await callTool('get_invoice', { number });
    const customerId = z
      .object({ customerId: z.string() })
      .parse(JSON.parse(inv.text ?? '')).customerId;
    const { isError, text } = await callTool('list_customer_pauses', { customerId });
    expect(isError).toBe(false);
    const body = z.object({ pauses: z.array(z.unknown()) }).safeParse(JSON.parse(text ?? ''));
    expect(body.success).toBe(true);
    expect(text?.includes('temporalWorkflowId')).toBe(false);
  }, 30_000);

  it('gets an invoice without workflowsSettings by default and with it on request', async () => {
    const number = await firstClosedInvoiceNo();
    const plain = await callTool('get_invoice', { number });
    const flagged = await callTool('get_invoice', { number, includeWorkflowSettings: true });
    expect([plain.isError, flagged.isError]).toEqual([false, false]);
    expect(plain.text?.includes('"workflowsSettings"')).toBe(false);
    expect(flagged.text?.includes('"workflowsSettings"')).toBe(true);
  }, 30_000);

  it('gets a customer without workflowsSettings by default and with it on request', async () => {
    const [first] = (await listTwoCustomers()).items;
    const id = z.string().parse(first?.id);
    const plain = await callTool('get_customer', { id });
    const flagged = await callTool('get_customer', { id, includeWorkflowSettings: true });
    expect([plain.isError, flagged.isError]).toEqual([false, false]);
    expect(plain.text?.includes('"workflowsSettings"')).toBe(false);
    expect(flagged.text?.includes('"workflowsSettings"')).toBe(true);
  }, 30_000);
});
