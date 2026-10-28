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
});
