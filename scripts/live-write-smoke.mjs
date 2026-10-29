// Live smoke test for the write tools, driven the way an assistant uses them: the customer and
// invoice come from the caller (the conversation), not from configuration.
//
//   npm run smoke:writes -- <customerNo> [invoiceNo]
//
// Changes data in the Inio environment from .env: creates, updates and cancels a reminders pause
// 30-45 days ahead for the customer, and, with an invoice, sets and clears a stop-until date.
// Never postpones a due date (irreversible). Prints statuses and error codes only, no personal data.
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const [customerNo, invoiceNo] = process.argv.slice(2);
if (!customerNo) {
  console.error('Usage: npm run smoke:writes -- <customerNo> [invoiceNo]');
  process.exit(2);
}

const REASON = 'inio-mcp live write smoke';
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const dateOf = (value) => (typeof value === 'string' ? value.slice(0, 10) : undefined);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/index.js'],
  env: { ...process.env, INIO_ALLOW_WRITES: 'true', INIO_LOG_LEVEL: 'warn' },
  stderr: 'ignore',
});
const client = new Client({ name: 'live-write-smoke', version: '0' });

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args }, { timeout: 120_000 });
  const text = result.content[0]?.text ?? '';
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { isError: result.isError === true, text, json };
}

const failures = [];
function check(step, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(step);
}
// Error texts carry only codes, API messages and correlation ids, never personal data.
const errorOf = (r) => r.text.slice(0, 200);

await client.connect(transport);
let customerId;
let pauseId;
let pauseCancelled = false;
try {
  const { tools } = await client.listTools();
  check(
    'write tools registered',
    tools.some((t) => t.name === 'create_customer_pause'),
  );

  const customer = await call('get_customer', { number: customerNo });
  customerId = customer.json?.customer?.id;
  check(
    'get_customer',
    !customer.isError && typeof customerId === 'string',
    customer.isError ? errorOf(customer) : '',
  );

  if (customerId) {
    const created = await call('create_customer_pause', {
      customerId,
      scope: 'reminders',
      startAt: day(30),
      endAt: day(40),
      reason: REASON,
    });
    pauseId = created.json?.id;
    check(
      'create_customer_pause',
      !created.isError &&
        created.json?.status === 'scheduled' &&
        dateOf(created.json?.startAt) === day(30),
      created.isError ? errorOf(created) : '',
    );

    if (pauseId) {
      const updated = await call('update_customer_pause', {
        customerId,
        pauseId,
        endAt: day(45),
        reason: `${REASON}: extend`,
      });
      check(
        'update_customer_pause',
        !updated.isError && dateOf(updated.json?.endAt) === day(45),
        updated.isError ? errorOf(updated) : '',
      );

      const cancelled = await call('cancel_customer_pause', {
        customerId,
        pauseId,
        reason: `${REASON}: done`,
      });
      pauseCancelled = !cancelled.isError && cancelled.json?.status === 'cancelled';
      check('cancel_customer_pause', pauseCancelled, cancelled.isError ? errorOf(cancelled) : '');

      const listed = await call('list_customer_pauses', { customerId });
      const status = listed.json?.pauses?.find((p) => p.id === pauseId)?.status;
      check('list_customer_pauses shows it cancelled', status === 'cancelled');
    }
  }

  if (invoiceNo) {
    const set = await call('update_invoice_stop_until_dates', {
      number: invoiceNo,
      invoicing1: day(30),
      reason: REASON,
    });
    if (set.isError) {
      // Feature off, or an API rule (e.g. step already passed, debt collection): report, don't fail.
      console.log(`skip update_invoice_stop_until_dates (${errorOf(set)})`);
    } else {
      check(
        'stop-until set',
        set.json?.updated === true &&
          dateOf(set.json?.stopUntilDates?.invoicing1StopUntilDate) === day(30),
      );
      const cleared = await call('update_invoice_stop_until_dates', {
        number: invoiceNo,
        invoicing1: null,
        reason: `${REASON}: clear`,
      });
      check(
        'stop-until cleared',
        !cleared.isError && cleared.json?.stopUntilDates?.invoicing1StopUntilDate === undefined,
      );
    }
  }
} finally {
  if (customerId && pauseId && !pauseCancelled) {
    const cleanup = await call('cancel_customer_pause', {
      customerId,
      pauseId,
      reason: `${REASON}: cleanup`,
    });
    console.log(`cleanup cancel_customer_pause: ${cleanup.isError ? errorOf(cleanup) : 'ok'}`);
  }
  await client.close();
}

console.log(
  failures.length === 0 ? 'All write smoke checks passed.' : `${failures.length} check(s) failed.`,
);
process.exit(failures.length === 0 ? 0 : 1);
