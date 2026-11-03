import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { toNodeHandler } from '@modelcontextprotocol/node';
import {
  type AuthInfo,
  createMcpHandler,
  localhostAllowedOrigins,
  originValidationResponse,
} from '@modelcontextprotocol/server';
import { errors } from 'jose';
import type { Config } from './config.ts';
import { noopLogger, type Logger } from './logger.ts';
import { createTokenVerifier, protectedResourceMetadata, resourceMetadataUrl } from './oauth.ts';
import { createServerFactory } from './server.ts';

type Deps = { fetch?: typeof globalThis.fetch; logger?: Logger; now?: () => number };
export type HttpConfig = Config & { http: NonNullable<Config['http']> };

const digest = (value: string) => createHash('sha256').update(value).digest();

// ponytail: MCP JSON-RPC requests are a few KiB; raise if a tool takes large input.
const MAX_REQUEST_BODY_BYTES = 256 * 1024;
const DRAIN_GRACE_MS = 500;
const WARN_INTERVAL_MS = 60_000;

type Reply = { status: 200 | 404 | 401; body: string; headers?: Record<string, string> };
/** A reply to send as is, or the request is authenticated (authInfo only for access tokens) and proceeds to /mcp. */
type Outcome = { reply: Reply } | { reply?: undefined; authInfo?: AuthInfo };

const replyNotFound: Reply = { status: 404, body: 'Not Found' };
const healthHeaders = { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' };
const replyHealthy: Reply = { status: 200, body: 'ok', headers: healthHeaders };
const replyHealthyHead: Reply = { status: 200, body: '', headers: healthHeaders };
const unauthorized = (challenge: string): Outcome => ({
  reply: { status: 401, body: 'Unauthorized', headers: { 'WWW-Authenticate': challenge } },
});
const PRM_PREFIX = '/.well-known/oauth-protected-resource';

/** Web-standard handler for POST/GET/DELETE /mcp behind a static bearer token and Origin allowlist, plus open GET/HEAD /healthz. */
export function createHttpHandler(
  config: HttpConfig,
  deps: Deps = {},
): (req: Request) => Promise<Response> {
  return buildHandler(config, deps).handle;
}

function buildHandler(config: HttpConfig, deps: Deps) {
  const { logger = noopLogger, now = Date.now } = deps;
  const { authToken, allowedOrigins, oauth } = config.http;
  const expected = authToken === undefined ? undefined : digest(authToken);
  // ponytail: MCP_ALLOWED_ORIGINS matches by hostname only (any scheme or port on that host).
  // The bearer token is the real barrier; Origin is the DNS-rebinding layer.
  // Upgrade to a full-origin match if needed.
  const origins = [...localhostAllowedOrigins(), ...allowedOrigins.map((o) => new URL(o).hostname)];
  const mcp = createMcpHandler(createServerFactory(config, { ...deps, logger }), {
    onerror: (e) => logger.warn({ err: e.message }, 'mcp handler error'),
  });
  const verifier = oauth && createTokenVerifier({ ...oauth, fetch: deps.fetch });
  const prmPaths = oauth
    ? new Set([PRM_PREFIX, new URL(resourceMetadataUrl(oauth.resourceUrl)).pathname])
    : new Set<string>();
  const prmBody = oauth ? JSON.stringify(protectedResourceMetadata(oauth)) : '';
  const prmHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  const challenge = oauth
    ? `Bearer resource_metadata="${resourceMetadataUrl(oauth.resourceUrl)}"`
    : 'Bearer';

  // Rate-limited so a scanner cannot flood the log; the skipped count rides on the next line.
  const throttledWarn = () => {
    let last = -Infinity;
    let suppressed = 0;
    return (fields: object, msg: string) => {
      const t = now();
      if (t - last < WARN_INTERVAL_MS) {
        suppressed++;
        return;
      }
      last = t;
      logger.warn({ ...fields, ...(suppressed > 0 && { suppressed }) }, msg);
      suppressed = 0;
    };
  };
  const warnUnauthorized = throttledWarn();
  const warnProvider = throttledWarn();

  /** Method + path + bearer gate, usable before any body is read. The static token is checked first (constant-time), then the JWT. */
  const authenticate = async (
    method: string | undefined,
    path: string,
    authorization: string | null | undefined,
  ): Promise<Outcome> => {
    if (path === '/healthz' && (method === 'GET' || method === 'HEAD')) {
      return { reply: method === 'GET' ? replyHealthy : replyHealthyHead };
    }
    if (prmPaths.has(path) && (method === 'GET' || method === 'HEAD')) {
      return { reply: { status: 200, body: method === 'GET' ? prmBody : '', headers: prmHeaders } };
    }
    if (path !== '/mcp') return { reply: replyNotFound };
    const token = /^Bearer +(\S+)$/i.exec(authorization ?? '')?.[1];
    if (!token) return unauthorized(challenge);
    if (expected && timingSafeEqual(digest(token), expected)) return {};
    if (!verifier) return unauthorized(challenge);
    try {
      return { authInfo: await verifier.verifyAccessToken(token) };
    } catch (err) {
      // JOSE errors mean a bad token; anything else is the provider being unreachable or misbehaving.
      if (!(err instanceof errors.JOSEError) || err instanceof errors.JWKSTimeout) {
        warnProvider(
          { err: err instanceof Error ? err.message : String(err) },
          'token verification unavailable',
        );
      }
      return unauthorized(`${challenge}, error="invalid_token"`);
    }
  };

  const serve = async (req: Request, authInfo?: AuthInfo) =>
    originValidationResponse(req, origins) ?? mcp.fetch(req, authInfo && { authInfo });

  const handle = async (req: Request): Promise<Response> => {
    const out = await authenticate(
      req.method,
      new URL(req.url).pathname,
      req.headers.get('authorization'),
    );
    return out.reply ? new Response(out.reply.body, out.reply) : serve(req, out.authInfo);
  };
  return { handle, serve, authenticate, warnUnauthorized, logger, close: () => mcp.close() };
}

export async function startHttpServer(
  config: HttpConfig,
  deps: Deps = {},
): Promise<{ port: number; close(): Promise<void> }> {
  const { serve, authenticate, warnUnauthorized, close } = buildHandler(config, deps);
  const nodeHandler = toNodeHandler(
    { fetch: (r, ctx) => serve(r, ctx?.authInfo) },
    { maxRequestBodySize: MAX_REQUEST_BODY_BYTES },
  );
  const server: Server = createServer((req, res) => {
    const path = URL.parse(req.url ?? '/', 'http://localhost')?.pathname ?? '';
    void authenticate(req.method, path, req.headers.authorization)
      .then((out) => {
        if (!out.reply) {
          Object.assign(req, { auth: out.authInfo });
          void nodeHandler(req, res);
          return;
        }
        const { reply } = out;
        if (reply.status === 401) {
          warnUnauthorized(
            { remoteAddress: req.socket.remoteAddress, path },
            'unauthorized request',
          );
        }
        // Reply (404, 401, /healthz) before the body is read, then drop the connection so an open upload cannot pin it.
        res.writeHead(reply.status, {
          'Content-Type': 'text/plain',
          Connection: 'close',
          ...reply.headers,
        });
        res.end(reply.body);
      })
      .catch(() => {
        if (res.headersSent) res.destroy();
        else res.writeHead(500, { Connection: 'close' }).end();
      });
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
