import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { registerGetCustomerPause } from '../../src/tools/get-customer-pause.ts';
import { InioApiError, type InioClient } from '../../src/inio-client.ts';

const CID = '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b';
const PID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const PAUSE = {
  id: PID,
  customerId: CID,
  scope: 'customer',
  startAt: '2026-03-01T00:00:00Z',
  endAt: '2026-04-01T00:00:00Z',
  status: 'active',
  reason: 'Hardship',
  createdBy: 'agent-7',
  createdAt: '2026-02-01T00:00:00Z',
  updatedAt: '2026-02-02T00:00:00Z',
};
const API_PAUSE = { ...PAUSE, temporalWorkflowId: 'wf-secret-123' };

type Get = InioClient['get'];

let mcpClient: Client | undefined;

afterEach(async () => {
  await mcpClient?.close();
  mcpClient = undefined;
});

async function setup(get: Get, revealPii = false) {
  const inio = { get: vi.fn<Get>(get) };
  const logger = { info: vi.fn<(obj: object, msg?: string) => void>() };
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerGetCustomerPause(server, { client: inio, revealPii, logger });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  mcpClient = client;
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const call = (args: Record<string, unknown>) =>
    client.callTool({ name: 'get_customer_pause', arguments: args });
  return { inio, call, client, logger };
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  expect(content).toHaveLength(1);
  expect(content[0]?.type).toBe('text');
  return content[0]?.text ?? '';
}

const okPause = () => Promise.resolve(API_PAUSE);
const args = { customerId: CID, pauseId: PID };

describe('get_customer_pause registration', () => {
  it('lists the tool as get_customer_pause with title Get customer pause', async () => {
    const { client } = await setup(okPause);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['get_customer_pause']);
    expect(tools[0]?.title).toBe('Get customer pause');
  });

  it('marks the tool read-only and open-world', async () => {
    const { client } = await setup(okPause);
    const { tools } = await client.listTools();
    expect(tools[0]?.annotations?.readOnlyHint).toBe(true);
    expect(tools[0]?.annotations?.openWorldHint).toBe(true);
  });

  it('advertises a strict schema with required customerId and pauseId', async () => {
    const { client } = await setup(okPause);
    const { tools } = await client.listTools();
    const schema = tools[0]?.inputSchema;
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual(['customerId', 'pauseId']);
    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        customerId: { type: 'string', format: 'uuid' },
        pauseId: { type: 'string', format: 'uuid' },
      },
    });
    expect([...(schema?.required ?? [])].sort()).toEqual(['customerId', 'pauseId']);
  });
});

describe('get_customer_pause behavior', () => {
  it('fetches /customers/<customerId>/pauses/<pauseId>', async () => {
    const { inio, call } = await setup(okPause);
    await call(args);
    expect(inio.get.mock.calls).toEqual([[`/customers/${CID}/pauses/${PID}`]]);
  });

  it('returns the pause without temporalWorkflowId', async () => {
    const { call } = await setup(okPause);
    const result = await call(args);
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toBe(JSON.stringify(PAUSE));
    expect(textOf(result)).not.toContain('wf-secret-123');
  });

  it('drops empty fields', async () => {
    const { call } = await setup(() => Promise.resolve({ ...API_PAUSE, endAt: null, reason: '' }));
    const { endAt: _e, reason: _r, ...rest } = PAUSE;
    expect(JSON.parse(textOf(await call(args)))).toStrictEqual(rest);
  });

  it('redacts an email in createdBy, and keeps it with revealPii', async () => {
    const pause = { ...API_PAUSE, createdBy: 'jane@home.example' };
    const redacted = await setup(() => Promise.resolve(pause));
    const text = textOf(await redacted.call(args));
    expect(text).toContain('"createdBy":"[redacted-email]"');
    expect(text).not.toContain('jane@home.example');
    await mcpClient?.close();
    const revealed = await setup(() => Promise.resolve(pause), true);
    expect(textOf(await revealed.call(args))).toContain('"createdBy":"jane@home.example"');
  });

  it('does not return structuredContent', async () => {
    const { call } = await setup(okPause);
    expect((await call(args)).structuredContent).toBeUndefined();
  });
});

describe('get_customer_pause input validation', () => {
  it.each([
    ['a missing pauseId', { customerId: CID }, 'pauseId'],
    ['a missing customerId', { pauseId: PID }, 'customerId'],
    ['a non-uuid customerId', { customerId: 'c-1', pauseId: PID }, 'customerId'],
    ['a non-uuid pauseId', { customerId: CID, pauseId: '../x' }, 'pauseId'],
    ['an unknown key', { ...args, foo: 1 }, 'Unrecognized key: "foo"'],
  ])('rejects %s without calling the API', async (_label, bad, fragment) => {
    const { inio, call } = await setup(okPause);
    const result = await call(bad);
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toMatch(/^Input validation error: /);
    expect(text).toContain(fragment);
    expect(inio.get).not.toHaveBeenCalled();
  });
});

describe('get_customer_pause errors', () => {
  it.each([
    ['null', null],
    ['an array', [API_PAUSE]],
    ['a string', 'nope'],
  ])('rejects %s as an unexpected pause payload', async (_label, payload) => {
    const { call } = await setup(() => Promise.resolve(payload));
    const result = await call(args);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('UPSTREAM_ERROR: Unexpected pause payload from the Inio API.');
  });

  it('formats an InioApiError with its correlation id', async () => {
    const { call } = await setup(() =>
      Promise.reject(new InioApiError(404, 'NOT_FOUND', 'No such pause', 'c-9')),
    );
    const result = await call(args);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('NOT_FOUND: No such pause (correlationId c-9)');
  });
});

describe('get_customer_pause tool-call logging', () => {
  it('logs one tool call line with outcome ok', async () => {
    const { call, logger } = await setup(okPause);
    const bytes = Buffer.byteLength(textOf(await call(args)), 'utf8');
    expect(logger.info.mock.calls).toEqual([
      [
        {
          tool: 'get_customer_pause',
          durationMs: expect.any(Number),
          outcome: 'ok',
          responseBytes: bytes,
          approxTokens: Math.ceil(bytes / 4),
        },
        'tool call',
      ],
    ]);
  });

  it('logs outcome error and no ids when the API call fails', async () => {
    const { call, logger } = await setup(() =>
      Promise.reject(new InioApiError(500, 'INTERNAL', 'Boom')),
    );
    await call(args);
    expect(logger.info.mock.calls).toEqual([
      [expect.objectContaining({ tool: 'get_customer_pause', outcome: 'error' }), 'tool call'],
    ]);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(PID);
  });
});
