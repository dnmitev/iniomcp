#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { pino } from 'pino';
import { loadConfig, type Config } from './config.ts';
import { createLogger } from './logger.ts';
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
  await createServer(config, { logger }).connect(new StdioServerTransport());
  const { allowWrites, revealPii, logLevel } = config;
  logger.info({ version, transport: 'stdio', allowWrites, revealPii, logLevel }, 'server started');
}
