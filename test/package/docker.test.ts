import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { afterAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const execFileAsync = promisify(execFile);
const image = process.env.DOCKER_IMAGE ?? '';

const TOOLS = [
  'get_customer',
  'get_customer_pause',
  'get_invoice',
  'get_invoice_retry_attempts',
  'list_customer_pauses',
  'list_customers',
  'list_invoices',
];

const ExecError = z.object({
  code: z.number().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
});

const clients: Client[] = [];

afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()));
});

/** Runs docker and returns exit code, stdout and stderr (never throws on a non-zero exit). */
async function docker(args: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync('docker', args, { timeout: 60_000 });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = ExecError.parse(e);
    return { code: err.code ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

describe.skipIf(!process.env.DOCKER_IMAGE)('docker image', () => {
  it('serves the seven read tools over stdio', async () => {
    const client = new Client({ name: 'docker-test', version: '0.0.0' });
    clients.push(client);
    await client.connect(
      new StdioClientTransport({
        command: 'docker',
        args: [
          'run',
          '-i',
          '--rm',
          '-e',
          'INIO_CLIENT_ID',
          '-e',
          'INIO_CLIENT_SECRET',
          '-e',
          'INIO_AUTH_URL',
          '-e',
          'INIO_URL',
          image,
        ],
        env: {
          PATH: process.env.PATH ?? '',
          INIO_CLIENT_ID: 'x',
          INIO_CLIENT_SECRET: 'y',
          INIO_AUTH_URL: 'https://auth.example/realms/r',
          INIO_URL: 'https://api.example/v1',
        },
        stderr: 'pipe',
      }),
    );
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);
  }, 60_000);

  it('runs as uid 1000', async () => {
    const res = await docker(['run', '--rm', '--entrypoint', 'id', image, '-u']);
    expect(res.stdout.trim()).toBe('1000');
  }, 60_000);

  it('runs as the user node', async () => {
    const res = await docker(['run', '--rm', '--entrypoint', 'id', image, '-un']);
    expect(res.stdout.trim()).toBe('node');
  }, 60_000);

  it('exits 1 with the config error on stderr and nothing on stdout when env is empty', async () => {
    const res = await docker(['run', '--rm', image]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('Invalid Inio MCP configuration');
    expect(res.stdout).toBe('');
  }, 60_000);

  it('contains no source, tests or .env in /app', async () => {
    const res = await docker(['run', '--rm', '--entrypoint', 'sh', image, '-c', 'ls -A /app']);
    expect(res.code).toBe(0);
    const entries = res.stdout.split('\n').filter((l) => l.length > 0);
    for (const forbidden of ['src', 'test', '.env']) expect(entries).not.toContain(forbidden);
  }, 60_000);

  it('installs production dependencies only', async () => {
    const res = await docker([
      'run',
      '--rm',
      '--entrypoint',
      'sh',
      image,
      '-c',
      'ls -A /app/node_modules',
    ]);
    expect(res.code).toBe(0);
    const entries = res.stdout.split('\n').filter((l) => l.length > 0);
    expect(entries.length).toBeGreaterThan(0);
    for (const dev of ['vitest', 'typescript', '@stryker-mutator', 'testcontainers']) {
      expect(entries).not.toContain(dev);
    }
  }, 60_000);

  it('is smaller than 200 MB', async () => {
    const res = await docker(['image', 'inspect', image, '--format', '{{.Size}}']);
    expect(res.code).toBe(0);
    expect(Number(res.stdout.trim())).toBeLessThan(200_000_000);
  }, 60_000);
});
