import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';

export const invoice: Record<string, unknown> = JSON.parse(
  readFileSync(new URL('./fixtures/invoice.json', import.meta.url), 'utf8'),
);

export interface RecordedRequest {
  method: string;
  url: string;
  authorization: string | undefined;
}

export interface FakeInioApi {
  /** Base URL including /v1, e.g. http://127.0.0.1:1234/v1 */
  url: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

const JWT = /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/;

/** Serves the real single-envelope response shape for the invoice lookups used by get_invoice. */
export async function startFakeInioApi(): Promise<FakeInioApi> {
  const requests: RecordedRequest[] = [];
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
    const id = String(invoice.id);
    const no = String(invoice.invoiceNo);
    if (
      url === `/v1/invoices/${id}` ||
      url === `/v1/invoices/by-number/${encodeURIComponent(no)}`
    ) {
      return send(200, { success: true, status: 200, correlationId: 'it-ok', result: invoice });
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
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
