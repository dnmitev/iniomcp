#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { pino } from 'pino';
import { loadConfig, type Config } from './config.ts';
import { createLogger } from './logger.ts';
import { startHttpServer } from './http.ts';
import { createServer, version } from './server.ts';

// stdout is the MCP channel: everything else goes to stderr.
let config: Config | undefined;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}

if (config) {
  const logger = createLogger(config.logLevel, pino.destination(2));
  const { allowWrites, revealPii, logLevel } = config;
  if (config.http) {
    const { http } = config;
    const { host, port } = http;
    const server = await startHttpServer({ ...config, http }, { logger });
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      setTimeout(() => process.exit(1), 2_000).unref();
      server
        .close()
        .then(() => {
          logger.info('server stopped');
          logger.flush(() => process.exit(0));
        })
        .catch((err: unknown) => {
          logger.error({ err }, 'shutdown failed');
          logger.flush(() => process.exit(1));
        });
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
    logger.info(
      { version, transport: 'http', host, port, allowWrites, revealPii, logLevel },
      'server started',
    );
  } else {
    await createServer(config, { logger }).connect(new StdioServerTransport());
    logger.info(
      { version, transport: 'stdio', allowWrites, revealPii, logLevel },
      'server started',
    );
  }
}
