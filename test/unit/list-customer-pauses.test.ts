import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { registerListCustomerPauses } from '../../src/tools/list-customer-pauses.ts';
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
  registerListCustomerPauses(server, { client: inio, revealPii, logger });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  mcpClient = client;
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const call = (args: Record<string, unknown>) =>
    client.callTool({ name: 'list_customer_pauses', arguments: args });
  return { inio, call, client, logger };
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  expect(content).toHaveLength(1);
  expect(content[0]?.type).toBe('text');
  return content[0]?.text ?? '';
}

const okList = () => Promise.resolve([API_PAUSE]);

describe('list_customer_pauses registration', () => {
  it('lists the tool as list_customer_pauses with title List customer pauses', async () => {
    const { client } = await setup(okList);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['list_customer_pauses']);
    expect(tools[0]?.title).toBe('List customer pauses');
  });

  it('marks the tool read-only and open-world', async () => {
    const { client } = await setup(okList);
    const { tools } = await client.listTools();
    expect(tools[0]?.annotations?.readOnlyHint).toBe(true);
    expect(tools[0]?.annotations?.openWorldHint).toBe(true);
  });

  it('advertises a strict schema with customerId and status only', async () => {
    const { client } = await setup(okList);
    const { tools } = await client.listTools();
    const schema = tools[0]?.inputSchema;
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual(['customerId', 'status']);
    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['customerId'],
      properties: {
        customerId: { type: 'string', format: 'uuid' },
        status: { enum: ['scheduled', 'active', 'completed', 'cancelled'] },
      },
    });
  });
});

describe('list_customer_pauses query', () => {
  it('fetches /customers/<id>/pauses without a status value when none is given', async () => {
    const { inio, call } = await setup(okList);
    await call({ customerId: CID });
    expect(inio.get).toHaveBeenCalledTimes(1);
    const [path, options] = inio.get.mock.calls[0] ?? [];
    expect(path).toBe(`/customers/${CID}/pauses`);
    expect(options?.query?.status).toBeUndefined();
  });

  it.each(['scheduled', 'active', 'completed', 'cancelled'])(
    'sends status %s when given',
    async (status) => {
      const { inio, call } = await setup(okList);
      const result = await call({ customerId: CID, status });
      expect(result.isError).not.toBe(true);
      expect(inio.get).toHaveBeenCalledWith(`/customers/${CID}/pauses`, { query: { status } });
    },
  );
});

describe('list_customer_pauses input validation', () => {
  it.each([
    ['a missing customerId', {}, 'customerId'],
    ['a non-uuid customerId', { customerId: 'c-1' }, 'customerId'],
    ['an unknown status', { customerId: CID, status: 'paused' }, 'status'],
    ['a limit key', { customerId: CID, limit: 5 }, 'Unrecognized key: "limit"'],
    ['a page key', { customerId: CID, page: 1 }, 'Unrecognized key: "page"'],
    ['an unknown key', { customerId: CID, foo: 1 }, 'Unrecognized key: "foo"'],
  ])('rejects %s without calling the API', async (_label, args, fragment) => {
    const { inio, call } = await setup(okList);
    const result = await call(args);
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toMatch(/^Input validation error: /);
    expect(text).toContain(fragment);
    expect(inio.get).not.toHaveBeenCalled();
  });
});

describe('list_customer_pauses output', () => {
  it('wraps the pauses and removes temporalWorkflowId', async () => {
    const { call } = await setup(okList);
    const result = await call({ customerId: CID });
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toBe(JSON.stringify({ pauses: [PAUSE] }));
    expect(textOf(result)).not.toContain('temporalWorkflowId');
    expect(textOf(result)).not.toContain('wf-secret-123');
  });

  it('removes temporalWorkflowId from every pause', async () => {
    const { call } = await setup(() => Promise.resolve([API_PAUSE, API_PAUSE]));
    expect(textOf(await call({ customerId: CID }))).toBe(
      JSON.stringify({ pauses: [PAUSE, PAUSE] }),
    );
  });

  it('returns exactly {"pauses":[]} for no pauses', async () => {
    const { call } = await setup(() => Promise.resolve([]));
    const result = await call({ customerId: CID });
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toBe('{"pauses":[]}');
  });

  it('drops empty pause fields', async () => {
    const pause = { ...API_PAUSE, endAt: null, reason: '' };
    const { call } = await setup(() => Promise.resolve([pause]));
    const { endAt: _e, reason: _r, ...rest } = PAUSE;
    expect(JSON.parse(textOf(await call({ customerId: CID })))).toStrictEqual({ pauses: [rest] });
  });

  it('redacts an email in createdBy', async () => {
    const pause = { ...API_PAUSE, createdBy: 'jane@home.example' };
    const { call } = await setup(() => Promise.resolve([pause]));
    const text = textOf(await call({ customerId: CID }));
    expect(text).toContain('"createdBy":"[redacted-email]"');
    expect(text).not.toContain('jane@home.example');
  });

  it('keeps the createdBy email when revealPii is true', async () => {
    const pause = { ...API_PAUSE, createdBy: 'jane@home.example' };
    const { call } = await setup(() => Promise.resolve([pause]), true);
    expect(textOf(await call({ customerId: CID }))).toContain('"createdBy":"jane@home.example"');
  });

  it('does not return structuredContent', async () => {
    const { call } = await setup(okList);
    expect((await call({ customerId: CID })).structuredContent).toBeUndefined();
  });
});

describe('list_customer_pauses errors', () => {
  it.each([
    ['null', null],
    ['an object', { data: [API_PAUSE] }],
    ['a string', 'nope'],
  ])('rejects %s as an unexpected pause payload', async (_label, payload) => {
    const { call } = await setup(() => Promise.resolve(payload));
    const result = await call({ customerId: CID });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('UPSTREAM_ERROR: Unexpected pause payload from the Inio API.');
  });

  it('formats an InioApiError with its correlation id', async () => {
    const { call } = await setup(() =>
      Promise.reject(new InioApiError(404, 'NOT_FOUND', 'No such customer', 'c-7')),
    );
    const result = await call({ customerId: CID });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('NOT_FOUND: No such customer (correlationId c-7)');
  });
});

describe('list_customer_pauses tool-call logging', () => {
  it('logs one tool call line with outcome ok', async () => {
    const { call, logger } = await setup(okList);
    const bytes = Buffer.byteLength(textOf(await call({ customerId: CID })), 'utf8');
    expect(logger.info.mock.calls).toEqual([
      [
        {
          tool: 'list_customer_pauses',
          durationMs: expect.any(Number),
          outcome: 'ok',
          responseBytes: bytes,
          approxTokens: Math.ceil(bytes / 4),
        },
        'tool call',
      ],
    ]);
  });

  it('logs outcome error and no pause content when the API call fails', async () => {
    const { call, logger } = await setup(() =>
      Promise.reject(new InioApiError(500, 'INTERNAL', 'Boom')),
    );
    await call({ customerId: CID });
    expect(logger.info.mock.calls).toEqual([
      [expect.objectContaining({ tool: 'list_customer_pauses', outcome: 'error' }), 'tool call'],
    ]);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(CID);
  });
});
