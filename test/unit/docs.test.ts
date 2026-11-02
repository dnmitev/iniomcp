import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { version } = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')));

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.name.endsWith('.md') ? [path] : [];
  });
}

const docs = markdownFiles(join(root, 'docs'));
const readme = join(root, 'README.md');

describe('docs', () => {
  it('pins every package and image reference to the package.json version', () => {
    const pins = [readme, ...docs].flatMap((file) =>
      [
        ...readFileSync(file, 'utf8').matchAll(
          /(?:@dnmitev\/inio-mcp@|ghcr\.io\/dnmitev\/inio-mcp:)(\d+\.\d+\.\d+)/g,
        ),
      ].map((m) => ({ file: file.slice(root.length), pin: m[1] })),
    );
    expect(pins.length).toBeGreaterThan(10);
    expect(pins.filter((p) => p.pin !== version)).toEqual([]);
  });

  it('has no broken relative links in docs/', () => {
    const broken = docs.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/\]\(([^)\s]+)\)/g)]
        .map((m) => (m[1] ?? '').split('#')[0] ?? '')
        .filter((target) => target !== '' && !/^[a-z]+:/i.test(target))
        .filter((target) => !existsSync(resolve(dirname(file), target)))
        .map((target) => `${file.slice(root.length)} -> ${target}`),
    );
    expect(broken).toEqual([]);
  });

  it('points every absolute link to this repository at a file that exists', () => {
    const missing = [readme, ...docs].flatMap((file) =>
      [
        ...readFileSync(file, 'utf8').matchAll(
          /https:\/\/github\.com\/dnmitev\/iniomcp\/blob\/main\/([^)#\s]+)/g,
        ),
      ]
        .map((m) => m[1] ?? '')
        .filter((target) => !existsSync(join(root, target)))
        .map((target) => `${file.slice(root.length)} -> ${target}`),
    );
    expect(missing).toEqual([]);
  });

  it('links from the README into docs/ with absolute GitHub URLs (npm does not ship docs/)', () => {
    const relative = [...readFileSync(readme, 'utf8').matchAll(/\]\((\.?\/?docs\/[^)]*)\)/g)].map(
      (m) => m[1],
    );
    expect(relative).toEqual([]);
  });
});
