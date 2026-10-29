import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

export const invoice: Record<string, unknown> = JSON.parse(
  readFileSync(new URL('./fixtures/invoice.json', import.meta.url), 'utf8'),
);

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

export const customer = z.record(z.string(), z.unknown()).parse(fixture('customer.json'));
export const serviceLine = z.record(z.string(), z.unknown()).parse(fixture('service-line.json'));
export const pauses = z.array(z.record(z.string(), z.unknown())).parse(fixture('pauses.json'));
export const retryAttempts = z
  .record(z.string(), z.unknown())
  .parse(fixture('retry-attempts.json'));

/** with-inherited differs from the plain invoice by a key it lacks and a changed bank name. */
export const INHERITED_FEE_DATE = '2026-10-15T00:00:00.000Z';
export const INHERITED_BANK = 'Inherited Bank';
const withInherited = {
  ...invoice,
  feeApplicationDate: INHERITED_FEE_DATE,
  bankName: INHERITED_BANK,
};

/** Invoice numbers the fake API answers with 429: once, then 200 / always. */
export const RATE_ONCE = 'RATE-ONCE';
export const RATE_ALWAYS = 'RATE-ALWAYS';

/** Customer whose POST /pauses always answers 409 with field errors. */
export const CONFLICT_CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c9';
export const CREATED_PAUSE_ID = '00000000-0000-4000-8000-000000000030';
export const CONFLICT_MESSAGE = 'Pause overlaps an existing pause';

export const CREDIT_INVOICE_ID = '00000000-0000-4000-8000-000000000040';
export const CREDIT_INVOICE_NO = 'CR-1001';
export const CREDIT_PAYMENT_REFERENCE = '1234567';
export const PAYMENT_ID = '00000000-0000-4000-8000-000000000060';
export const RESET_WORKFLOW_ID = 'wf-reset-example';

export interface RecordedRequest {
  method: string;
  url: string;
  authorization: string | undefined;
  /** Raw request body, empty for GET. */
  body: string;
  /** x-user-real-name header, as sent. */
  userRealName: string | undefined;
}

export interface FakeInioApi {
  /** Base URL including /v1, e.g. http://127.0.0.1:1234/v1 */
  url: string;
  requests: RecordedRequest[];
  /** Makes RATE-ONCE answer 429 again on its next request. */
  resetRateLimit(): void;
  /** Forgets invoice changes made by write requests (due date, stop-until dates). */
  resetWrites(): void;
  close(): Promise<void>;
}

const JWT = /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/;

/** Serves the real single-envelope response shape for the invoice lookups used by get_invoice. */
export async function startFakeInioApi(): Promise<FakeInioApi> {
  const requests: RecordedRequest[] = [];
  let rateOnceServed = false;
  // Write requests change what the invoice GET returns afterwards.
  let dueDate: unknown;
  let stopMetadata: Record<string, unknown> = {};
  const currentInvoice = () => ({
    ...invoice,
    ...(dueDate === undefined ? {} : { dueDate }),
    metadata: { ...z.record(z.string(), z.unknown()).parse(invoice.metadata), ...stopMetadata },
  });
  const handle = (req: IncomingMessage, res: ServerResponse, raw: string): void => {
    const url = req.url ?? '';
    const method = req.method ?? '';
    const header = req.headers['x-user-real-name'];
    requests.push({
      method,
      url,
      authorization: req.headers.authorization,
      body: raw,
      userRealName: typeof header === 'string' ? header : undefined,
    });
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (!JWT.test(req.headers.authorization ?? '')) {
      return send(401, {
        success: false,
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'Unauthorized',
      });
    }
    const ok = (result: unknown) =>
      send(200, { success: true, status: 200, correlationId: 'it-ok', result });
    const list = (data: unknown[]) => ok({ data, limit: 25, offset: 0, total: data.length });
    const { pathname } = new URL(url, 'http://fake.example');
    const path = pathname.split('/').map((p) => decodeURIComponent(p));
    const [, v1, root, a, b, c] = path;
    const invoiceId = String(invoice.id);
    const invoiceNo = String(invoice.invoiceNo);
    const customerId = String(customer.id);
    const customerNo = String(customer.customerNo);
    if (method !== 'GET') {
      const body = z
        .record(z.string(), z.unknown())
        .catch({})
        .parse(raw === '' ? {} : JSON.parse(raw));
      const pause = pauses[0] ?? {};
      if (v1 === 'v1' && root === 'customers' && method === 'PATCH') {
        const byNo = a === 'by-number';
        const key = byNo ? b : a;
        const rest = byNo ? c : b;
        if (rest === undefined && key === (byNo ? customerNo : customerId)) {
          return ok([{ ...customer, ...body }]);
        }
      }
      if (v1 === 'v1' && root === 'customers' && b === 'pauses') {
        if (method === 'POST' && c === undefined) {
          if (a === CONFLICT_CUSTOMER_ID) {
            return send(409, {
              success: false,
              status: 409,
              code: 'CONFLICT',
              message: CONFLICT_MESSAGE,
              correlationId: 'it-409',
              fieldErrors: [
                {
                  fieldName: 'startAt',
                  errorCode: 'overlap',
                  message: 'Overlaps pause 2026-11-01',
                },
              ],
            });
          }
          const created = {
            ...body,
            id: CREATED_PAUSE_ID,
            customerId: a,
            status: 'scheduled',
            createdBy: 'agent@inio.example',
            temporalWorkflowId: 'wf-created-example',
            createdAt: '2026-10-29T00:00:00.000Z',
            updatedAt: '2026-10-29T00:00:00.000Z',
          };
          return send(201, { success: true, status: 201, correlationId: 'it-ok', result: created });
        }
        if (a === customerId && c === pause.id && method === 'PATCH') {
          const { reason: _reason, ...changes } = body;
          return ok({ ...pause, ...changes, updatedAt: '2026-10-29T00:00:00.000Z' });
        }
        if (a === customerId && c === pause.id && path[6] === 'cancel' && method === 'POST') {
          return ok({ ...pause, status: 'cancelled', updatedAt: '2026-10-29T00:00:00.000Z' });
        }
      }
      if (v1 === 'v1' && root === 'payments' && a === undefined && method === 'POST') {
        return send(201, {
          success: true,
          status: 201,
          correlationId: 'it-ok',
          result: [PAYMENT_ID],
        });
      }
      if (v1 === 'v1' && root === 'invoices' && method === 'POST') {
        const byNo = a === 'by-number';
        const key = byNo ? b : a;
        const action = byNo ? c : b;
        if (key === (byNo ? invoiceNo : invoiceId)) {
          if (action === 'update-due-date') {
            dueDate = body.dueDate;
            return ok('Success');
          }
          if (action === 'reset-stage' && !byNo) {
            return ok({
              targetStage: body.targetStage,
              dueDate: body.dueDate ?? null,
              plannedSteps: ['waive-fees', 'restart-workflow'],
              feeWaiveAmount: 0,
              feePaidKept: 0,
              willWaiveOutstandingFee: false,
              willRedistribute: body.redistribute,
              willReRunSetup: true,
              workflowId: RESET_WORKFLOW_ID,
            });
          }
          if (action === 'credit-invoice') {
            return send(201, {
              success: true,
              status: 201,
              correlationId: 'it-ok',
              result: {
                id: CREDIT_INVOICE_ID,
                invoiceNo: body.invoiceNo,
                paymentReference: CREDIT_PAYMENT_REFERENCE,
                creditInvoiceItems: z
                  .array(z.record(z.string(), z.unknown()))
                  .catch([])
                  .parse(body.invoiceItems)
                  .map((item, i) => ({
                    id: `00000000-0000-4000-8000-00000000005${i}`,
                    ...item,
                  })),
              },
            });
          }
          if (action === 'match-credit-invoice') return ok(CREDIT_INVOICE_ID);
          if (action === 'update-stop-until-dates') {
            stopMetadata = {
              ...stopMetadata,
              ...z.record(z.string(), z.unknown()).catch({}).parse(body.metadata),
            };
            return ok('Success');
          }
        }
      }
    } else if (v1 === 'v1' && root === 'customers') {
      if (a === undefined) return list([customer]);
      if (a === 'by-number' && b === customerNo && c === undefined) {
        return ok({ externalCustomer: customer, serviceLine, effectivePause: { isPaused: false } });
      }
      if (a === customerId && b === undefined) {
        return ok({ externalCustomer: customer, serviceLine, effectivePause: { isPaused: false } });
      }
      if (a === customerId && b === 'pauses' && c === undefined) return ok(pauses);
      if (a === customerId && b === 'pauses' && c === pauses[0]?.id) return ok(pauses[0]);
    }
    if (method === 'GET' && v1 === 'v1' && root === 'invoices') {
      if (a === undefined) return list([invoice]);
      const suffix = a === 'by-number' ? path[5] : b;
      const key = a === 'by-number' ? b : a;
      if (a === 'by-number' && (b === RATE_ALWAYS || (b === RATE_ONCE && !rateOnceServed))) {
        if (b === RATE_ONCE) rateOnceServed = true;
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' });
        res.end(
          JSON.stringify({
            success: false,
            status: 429,
            code: 'TOO_MANY_REQUESTS',
            message: 'Too many requests',
            correlationId: 'it-429',
          }),
        );
        return;
      }
      const byNumber = a === 'by-number';
      // by-number serves only the invoice number (and RATE-ONCE after its 429); with-inherited is id-only.
      const known = byNumber ? key === invoiceNo || key === RATE_ONCE : key === invoiceId;
      if (known && suffix === undefined) return ok(currentInvoice());
      if (known && !byNumber && suffix === 'with-inherited') return ok(withInherited);
      if (known && suffix === 'retry-attempts') return ok(retryAttempts);
    }
    const missing = decodeURIComponent(url.split('/').pop() ?? '');
    send(404, {
      success: false,
      status: 404,
      code: 'NOT_FOUND',
      message: `Invoice with number ${missing} could not be found`,
      correlationId: 'it-404',
      i18nKey: 'errors.invoices.not_found',
    });
  };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => handle(req, res, Buffer.concat(chunks).toString('utf8')));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('fake API has no port');
  const { port } = address;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    resetRateLimit: () => {
      rateOnceServed = false;
    },
    resetWrites: () => {
      dueDate = undefined;
      stopMetadata = {};
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
