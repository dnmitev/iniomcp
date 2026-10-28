import { createServer, type Server } from 'node:http';
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

export interface RecordedRequest {
  method: string;
  url: string;
  authorization: string | undefined;
}

export interface FakeInioApi {
  /** Base URL including /v1, e.g. http://127.0.0.1:1234/v1 */
  url: string;
  requests: RecordedRequest[];
  /** Makes RATE-ONCE answer 429 again on its next request. */
  resetRateLimit(): void;
  close(): Promise<void>;
}

const JWT = /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/;

/** Serves the real single-envelope response shape for the invoice lookups used by get_invoice. */
export async function startFakeInioApi(): Promise<FakeInioApi> {
  const requests: RecordedRequest[] = [];
  let rateOnceServed = false;
  const server: Server = createServer((req, res) => {
    const url = req.url ?? '';
    requests.push({ method: req.method ?? '', url, authorization: req.headers.authorization });
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
    if (v1 === 'v1' && root === 'customers') {
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
    if (v1 === 'v1' && root === 'invoices') {
      if (a === undefined) return list([invoice]);
      const suffix = a === 'by-number' ? path[5] : b;
      const key = a === 'by-number' ? b : a;
      if (a === 'by-number' && (b === RATE_ALWAYS || (b === RATE_ONCE && !rateOnceServed))) {
        if (b === RATE_ONCE) rateOnceServed = true;
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' });
        return res.end(
          JSON.stringify({
            success: false,
            status: 429,
            code: 'TOO_MANY_REQUESTS',
            message: 'Too many requests',
            correlationId: 'it-429',
          }),
        );
      }
      const byNumber = a === 'by-number';
      // by-number serves only the invoice number (and RATE-ONCE after its 429); with-inherited is id-only.
      const known = byNumber ? key === invoiceNo || key === RATE_ONCE : key === invoiceId;
      if (known && suffix === undefined) return ok(invoice);
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
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
