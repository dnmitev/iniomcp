import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { toNodeHandler } from '@modelcontextprotocol/node';
import {
  createMcpHandler,
  localhostAllowedOrigins,
  originValidationResponse,
} from '@modelcontextprotocol/server';
import type { Config } from './config.ts';
import { noopLogger, type Logger } from './logger.ts';
import { createServerFactory } from './server.ts';

type Deps = { fetch?: typeof globalThis.fetch; logger?: Logger; now?: () => number };
export type HttpConfig = Config & { http: NonNullable<Config['http']> };

const digest = (value: string) => createHash('sha256').update(value).digest();

// ponytail: MCP JSON-RPC requests are a few KiB; raise if a tool takes large input.
const MAX_REQUEST_BODY_BYTES = 256 * 1024;
const DRAIN_GRACE_MS = 500;
const UNAUTHORIZED_LOG_INTERVAL_MS = 60_000;

type Reply = { status: 200 | 404 | 401; body: string; headers?: Record<string, string> };

const replyNotFound: Reply = { status: 404, body: 'Not Found' };
const healthHeaders = { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' };
const replyHealthy: Reply = { status: 200, body: 'ok', headers: healthHeaders };
const replyHealthyHead: Reply = { status: 200, body: '', headers: healthHeaders };
const replyUnauthorized: Reply = {
  status: 401,
  body: 'Unauthorized',
  headers: { 'WWW-Authenticate': 'Bearer' },
};

/** Web-standard handler for POST/GET/DELETE /mcp behind a static bearer token and Origin allowlist, plus open GET/HEAD /healthz. */
export function createHttpHandler(
  config: HttpConfig,
  deps: Deps = {},
): (req: Request) => Promise<Response> {
  return buildHandler(config, deps).handle;
}

function buildHandler(config: HttpConfig, deps: Deps) {
  const { logger = noopLogger } = deps;
  const { authToken, allowedOrigins } = config.http;
  const expected = digest(authToken);
  // ponytail: MCP_ALLOWED_ORIGINS matches by hostname only (any scheme or port on that host).
  // The bearer token is the real barrier; Origin is the DNS-rebinding layer.
  // Upgrade to a full-origin match if needed.
  const origins = [...localhostAllowedOrigins(), ...allowedOrigins.map((o) => new URL(o).hostname)];
  const mcp = createMcpHandler(createServerFactory(config, { ...deps, logger }), {
    onerror: (e) => logger.warn({ err: e.message }, 'mcp handler error'),
  });

  /** Method + path + bearer gate, usable before any body is read. Returns the reply to send (404, 401, or 200 for /healthz), or null to proceed to /mcp. */
  const gate = (
    method: string | undefined,
    path: string,
    authorization: string | null | undefined,
  ): Reply | null => {
    if (path === '/healthz' && (method === 'GET' || method === 'HEAD')) {
      return method === 'GET' ? replyHealthy : replyHealthyHead;
    }
    if (path !== '/mcp') return replyNotFound;
    const match = /^Bearer +(\S+)$/i.exec(authorization ?? '');
    if (!match?.[1] || !timingSafeEqual(digest(match[1]), expected)) return replyUnauthorized;
    return null;
  };

  const handle = async (req: Request): Promise<Response> => {
    const reply = gate(req.method, new URL(req.url).pathname, req.headers.get('authorization'));
    if (reply) return new Response(reply.body, reply);
    return originValidationResponse(req, origins) ?? mcp.fetch(req);
  };
  return { handle, gate, logger, close: () => mcp.close() };
}

export async function startHttpServer(
  config: HttpConfig,
  deps: Deps = {},
): Promise<{ port: number; close(): Promise<void> }> {
  const { handle, gate, logger, close } = buildHandler(config, deps);
  const { now = Date.now } = deps;
  // Rate-limited so a scanner cannot flood the log; the skipped count rides on the next line.
  let lastUnauthorizedLog = -Infinity;
  let suppressed = 0;
  const logUnauthorized = (remoteAddress: string | undefined, path: string) => {
    const t = now();
    if (t - lastUnauthorizedLog < UNAUTHORIZED_LOG_INTERVAL_MS) {
      suppressed++;
      return;
    }
    lastUnauthorizedLog = t;
    logger.warn(
      { remoteAddress, path, ...(suppressed > 0 && { suppressed }) },
      'unauthorized request',
    );
    suppressed = 0;
  };
  const nodeHandler = toNodeHandler(
    { fetch: handle },
    { maxRequestBodySize: MAX_REQUEST_BODY_BYTES },
  );
  const server: Server = createServer((req, res) => {
    const path = URL.parse(req.url ?? '/', 'http://localhost')?.pathname ?? '';
    const reply = gate(req.method, path, req.headers.authorization);
    if (!reply) {
      void nodeHandler(req, res);
      return;
    }
    if (reply.status === 401) logUnauthorized(req.socket.remoteAddress, path);
    // Reply (404, 401, /healthz) before the body is read, then drop the connection so an open upload cannot pin it.
    res.writeHead(reply.status, {
      'Content-Type': 'text/plain',
      Connection: 'close',
      ...reply.headers,
    });
    res.end(reply.body);
  });
  let onError: (err: Error) => void = () => {};
  await new Promise<void>((resolve, reject) => {
    onError = reject;
    server.once('error', onError);
    server.listen(config.http.port, config.http.host, resolve);
  });
  server.off('error', onError);
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- listen on TCP always yields AddressInfo
    port: (server.address() as AddressInfo).port,
    close: async () => {
      const serverClosed = new Promise<void>((resolve, fail) => {
        server.close((err) => (err ? fail(err) : resolve()));
      });
      // In-flight requests get a short grace period before being cut.
      const cut = setTimeout(() => server.closeAllConnections(), DRAIN_GRACE_MS);
      cut.unref();
      try {
        // Connections finished by the handler shutdown go idle; close them now.
        await Promise.all([serverClosed, close().finally(() => server.closeIdleConnections())]);
      } finally {
        clearTimeout(cut);
      }
    },
  };
}
