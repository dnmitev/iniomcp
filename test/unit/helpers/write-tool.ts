import { expect, vi } from 'vitest';
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import type { InioClient } from '../../../src/inio-client.ts';

export type Get = InioClient['get'];
export type Post = InioClient['post'];
export type Patch = InioClient['patch'];

type Register = (
  server: McpServer,
  deps: {
    client: InioClient;
    revealPii: boolean;
    logger: { info: (obj: object, msg?: string) => void };
  },
) => void;

const unexpected = () => Promise.reject(new Error('unexpected call'));

/** Spins up one write tool on an in-memory MCP server with a fake Inio client. */
export function makeHarness(register: Register, toolName: string) {
  const open: Client[] = [];
  async function setup(impl: { get?: Get; post?: Post; patch?: Patch }, revealPii = false) {
    const inio = {
      get: vi.fn<Get>(impl.get ?? unexpected),
      post: vi.fn<Post>(impl.post ?? unexpected),
      patch: vi.fn<Patch>(impl.patch ?? unexpected),
    };
    const logger = { info: vi.fn<(obj: object, msg?: string) => void>() };
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    register(server, { client: inio, revealPii, logger });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    open.push(client);
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const call = (args: Record<string, unknown>) =>
      client.callTool({ name: toolName, arguments: args });
    return { inio, call, client, logger };
  }
  const close = async () => {
    await Promise.all(open.splice(0).map((c) => c.close()));
  };
  return { setup, close };
}

export function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  expect(content).toHaveLength(1);
  expect(content[0]?.type).toBe('text');
  return content[0]?.text ?? '';
}

export const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

/** Invalid and valid YYYY-MM-DD cases shared by every date input. */
export const BAD_DATES = [
  '2026-02-30',
  '2026-13-01',
  '2026-00-10',
  '2026-1-1',
  '26-01-01',
  '2026-01-01T00:00:00Z',
  ' 2026-01-01',
  '2027-02-29',
  '01/02/2026',
  '',
];
export const GOOD_DATES = ['2026-12-01', '2028-02-29', '2026-01-31'];
