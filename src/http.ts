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
import type { Logger } from './logger.ts';
import { createServerFactory } from './server.ts';

type Deps = { fetch?: typeof globalThis.fetch; logger?: Logger };
export type HttpConfig = Config & { http: NonNullable<Config['http']> };

const digest = (value: string) => createHash('sha256').update(value).digest();

const unauthorized = () =>
  new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });

/** Web-standard handler for POST/GET/DELETE /mcp behind a static bearer token and Origin allowlist. */
export function createHttpHandler(
  config: HttpConfig,
  deps: Deps = {},
): (req: Request) => Promise<Response> {
  return buildHandler(config, deps).handle;
}

function buildHandler(config: HttpConfig, deps: Deps) {
  const { authToken, allowedOrigins } = config.http;
  const expected = digest(authToken);
  // ponytail: MCP_ALLOWED_ORIGINS matches by hostname only (any scheme or port on that host).
  // The bearer token is the real barrier; Origin is the DNS-rebinding layer.
  // Upgrade to a full-origin match if needed.
  const origins = [...localhostAllowedOrigins(), ...allowedOrigins.map((o) => new URL(o).hostname)];
  const mcp = createMcpHandler(createServerFactory(config, deps));

  const handle = async (req: Request): Promise<Response> => {
    if (new URL(req.url).pathname !== '/mcp') return new Response('Not Found', { status: 404 });
    const match = /^Bearer +(\S+)$/i.exec(req.headers.get('authorization') ?? '');
    if (!match?.[1] || !timingSafeEqual(digest(match[1]), expected)) return unauthorized();
    return originValidationResponse(req, origins) ?? mcp.fetch(req);
  };
  return { handle, close: () => mcp.close() };
}

export async function startHttpServer(
  config: HttpConfig,
  deps: Deps = {},
): Promise<{ port: number; close(): Promise<void> }> {
  const { handle, close } = buildHandler(config, deps);
  const nodeHandler = toNodeHandler({ fetch: handle });
  const server: Server = createServer((req, res) => void nodeHandler(req, res));
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
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      }).then(close),
  };
}
