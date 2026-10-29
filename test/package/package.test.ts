import { execFile, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const TOOLS = [
  'get_customer',
  'get_customer_pause',
  'get_invoice',
  'get_invoice_retry_attempts',
  'list_customer_pauses',
  'list_customers',
  'list_invoices',
];

const InstalledPackage = z.object({
  name: z.string(),
  version: z.string(),
  private: z.unknown().optional(),
  publishConfig: z.unknown(),
  bin: z.record(z.string(), z.string()),
  engines: z.record(z.string(), z.string()),
  license: z.string(),
});

let tmp: string;
let app: string;
let files: string[];
let bin: string;
const clients: Client[] = [];

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'inio-mcp-pack-'));
  const packed = await run('npm', ['pack', '--pack-destination', tmp], { cwd: ROOT });
  const tarballName = packed.stdout.trim().split('\n').pop() ?? '';
  const tarball = join(tmp, tarballName);
  const listing = await run('tar', ['-tzf', tarball]);
  files = listing.stdout.split('\n').filter((l) => l.length > 0);
  app = join(tmp, 'app');
  await mkdir(app);
  await writeFile(join(app, 'package.json'), JSON.stringify({ name: 'app', private: true }));
  await run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', tarball], { cwd: app });
  bin = join(app, 'node_modules', '.bin', 'inio-mcp');
}, 180_000);

afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()));
  if (tmp) await rm(tmp, { recursive: true, force: true });
}, 30_000);

describe('packed tarball', () => {
  it.each([
    'package/dist/index.js',
    'package/README.md',
    'package/LICENSE',
    'package/NOTICE',
    'package/CHANGELOG.md',
    'package/package.json',
  ])('contains %s', (path) => {
    expect(files).toContain(path);
  });

  it('contains only dist JavaScript and the five top-level files', () => {
    const allowed = new Set([
      'package/package.json',
      'package/README.md',
      'package/LICENSE',
      'package/NOTICE',
      'package/CHANGELOG.md',
    ]);
    const unexpected = files.filter(
      (f) => !allowed.has(f) && !/^package\/dist\/.+\.js$/.test(f) && f !== 'package/dist/',
    );
    expect(unexpected).toEqual([]);
  });

  it('never mentions the old package name @inio/mcp in packed text files', async () => {
    const root = join(app, 'node_modules', '@dnmitev', 'inio-mcp');
    const textFiles = files
      .filter((f) => /^package\/(README\.md|CHANGELOG\.md|package\.json|dist\/.+\.js)$/.test(f))
      .map((f) => f.slice('package/'.length));
    expect(textFiles.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const f of textFiles) {
      if ((await readFile(join(root, f), 'utf8')).includes('@inio/mcp')) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});

describe('installed package.json', () => {
  async function installed() {
    const raw = await readFile(
      join(app, 'node_modules', '@dnmitev', 'inio-mcp', 'package.json'),
      'utf8',
    );
    return InstalledPackage.parse(JSON.parse(raw));
  }

  it('is named @dnmitev/inio-mcp at version 0.1.0', async () => {
    const pkg = await installed();
    expect({ name: pkg.name, version: pkg.version }).toEqual({
      name: '@dnmitev/inio-mcp',
      version: '0.1.0',
    });
  });

  it('is not private', async () => {
    expect('private' in (await installed())).toBe(false);
  });

  it('publishes publicly with provenance', async () => {
    expect((await installed()).publishConfig).toEqual({ access: 'public', provenance: true });
  });

  it('exposes the inio-mcp bin at dist/index.js', async () => {
    expect((await installed()).bin['inio-mcp']).toBe('dist/index.js');
  });

  it('requires Node >=24', async () => {
    expect((await installed()).engines.node).toBe('>=24');
  });

  it('is Apache-2.0 licensed', async () => {
    expect((await installed()).license).toBe('Apache-2.0');
  });
});

describe('installed inio-mcp binary', () => {
  it('exits 1 with the config error on stderr and nothing on stdout when env is empty', () => {
    const res = spawnSync(bin, [], {
      env: { PATH: process.env.PATH ?? '' },
      encoding: 'utf8',
      timeout: 15_000,
      input: '',
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Invalid Inio MCP configuration');
    expect(res.stdout).toBe('');
  });

  it('serves the seven read tools over stdio', async () => {
    const client = new Client({ name: 'package-test', version: '0.0.0' });
    clients.push(client);
    await client.connect(
      new StdioClientTransport({
        command: bin,
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
  }, 30_000);
});
