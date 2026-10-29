// Live smoke test for the write tools, driven the way an assistant uses them: the customer and
// invoice come from the caller (the conversation), not from configuration.
//
//   npm run smoke:writes -- <customerNo> [invoiceNo]
//
// Changes data in the Inio environment from .env: renames the customer and restores the name,
// creates, updates and cancels a reminders pause 30-45 days ahead for the customer, and, with an
// invoice, sets and clears a stop-until date. Never postpones a due date, resets a stage or
// creates credits (irreversible, or reaching the end customer). Prints statuses and error codes only, no personal data.
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
// A write that timed out or lost its response may still have been applied.
const maybeApplied = (r) => r.isError && r.text.includes('may or may not have been applied');

await client.connect(transport);
let customerId;
let originalName;
let nameChanged = false;
let pauseId;
let pauseCancelled = false;
let stopUntilSet = false;
let pauseUncertain = false;
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

  originalName = customer.json?.customer?.customerName;
  if (customerId && (typeof originalName !== 'string' || originalName.length > 90)) {
    // Never rename what cannot be restored exactly (missing, or no room for the suffix).
    console.log('skip update_customer (original name cannot be restored)');
  } else if (customerId) {
    // Any rename error may hide an applied change, so restore unless a restore is confirmed.
    nameChanged = true;
    const renamed = await call('update_customer', {
      id: customerId,
      customerName: `${originalName} (smoke)`,
    });
    check(
      'update_customer',
      !renamed.isError && renamed.json?.customerName === `${originalName} (smoke)`,
      renamed.isError ? errorOf(renamed) : '',
    );
    if (!renamed.isError) {
      const restored = await call('update_customer', {
        id: customerId,
        customerName: originalName,
      });
      // Any failed restore leaves the name possibly changed, so the finally block retries it.
      nameChanged = restored.isError;
      check(
        'update_customer restored',
        !restored.isError && restored.json?.customerName === originalName,
        restored.isError ? errorOf(restored) : '',
      );
    }
  }

  if (customerId) {
    const created = await call('create_customer_pause', {
      customerId,
      scope: 'reminders',
      startAt: day(30),
      endAt: day(40),
      reason: REASON,
    });
    pauseId = created.json?.id;
    pauseUncertain = maybeApplied(created);
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
    const before = await call('get_invoice', { number: invoiceNo });
    check('get_invoice', !before.isError, before.isError ? errorOf(before) : '');
    if (before.json?.metadata?.invoicing1StopUntilDate) {
      // Never overwrite an existing hold: the previous date could not be restored.
      console.log(
        'skip update_invoice_stop_until_dates (invoicing1 already has a stop-until date)',
      );
    } else if (!before.isError) {
      const set = await call('update_invoice_stop_until_dates', {
        number: invoiceNo,
        invoicing1: day(30),
        reason: REASON,
      });
      const expectedRejection =
        /^FEATURE_DISABLED:/.test(set.text) ||
        (/^BAD_REQUEST:/.test(set.text) && !set.text.includes(' Fields: '));
      if (set.isError && expectedRejection) {
        // Feature off, or a business rule (step already passed, debt collection): expected.
        // A BAD_REQUEST with field errors means the request itself was wrong, so it fails.
        console.log(`skip update_invoice_stop_until_dates (${errorOf(set)})`);
      } else {
        stopUntilSet = !set.isError || maybeApplied(set);
        check(
          'stop-until set',
          set.json?.updated === true &&
            dateOf(set.json?.stopUntilDates?.invoicing1StopUntilDate) === day(30),
          set.isError ? errorOf(set) : '',
        );
        if (!set.isError) {
          const cleared = await call('update_invoice_stop_until_dates', {
            number: invoiceNo,
            invoicing1: null,
            reason: `${REASON}: clear`,
          });
          // Any failed clear leaves the date possibly set, so the finally block retries it.
          stopUntilSet = cleared.isError;
          check(
            'stop-until cleared',
            !cleared.isError && cleared.json?.stopUntilDates?.invoicing1StopUntilDate === undefined,
            cleared.isError ? errorOf(cleared) : '',
          );
        }
      }
    }
  }
} finally {
  if (customerId && nameChanged) {
    const cleanup = await call('update_customer', { id: customerId, customerName: originalName });
    check('cleanup update_customer', !cleanup.isError, cleanup.isError ? errorOf(cleanup) : '');
  }
  if (invoiceNo && stopUntilSet) {
    const cleanup = await call('update_invoice_stop_until_dates', {
      number: invoiceNo,
      invoicing1: null,
      reason: `${REASON}: cleanup`,
    });
    check(
      'cleanup update_invoice_stop_until_dates',
      !cleanup.isError,
      cleanup.isError ? errorOf(cleanup) : '',
    );
  }
  if (customerId && !pauseId && pauseUncertain) {
    // The create may have been applied without an id coming back: cancel leftovers of this script.
    const listed = await call('list_customer_pauses', { customerId, status: 'scheduled' });
    for (const p of listed.json?.pauses ?? []) {
      if (typeof p.reason === 'string' && p.reason.startsWith(REASON)) {
        const cleanup = await call('cancel_customer_pause', {
          customerId,
          pauseId: p.id,
          reason: `${REASON}: cleanup`,
        });
        check('cleanup leftover pause', !cleanup.isError, cleanup.isError ? errorOf(cleanup) : '');
      }
    }
  }
  if (customerId && pauseId && !pauseCancelled) {
    const cleanup = await call('cancel_customer_pause', {
      customerId,
      pauseId,
      reason: `${REASON}: cleanup`,
    });
    check(
      'cleanup cancel_customer_pause',
      !cleanup.isError,
      cleanup.isError ? errorOf(cleanup) : '',
    );
  }
  await client.close();
}

console.log(
  failures.length === 0 ? 'All write smoke checks passed.' : `${failures.length} check(s) failed.`,
);
process.exit(failures.length === 0 ? 0 : 1);
