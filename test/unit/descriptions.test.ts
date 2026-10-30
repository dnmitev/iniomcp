import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { createServer } from '../../src/server.ts';
import type { Config } from '../../src/config.ts';
import { REDACTION_NOTE, SENSITIVE_KEYS, isSensitiveKey } from '../../src/redact.ts';

const CONFIG: Config = {
  clientId: 'mcp-client',
  clientSecret: 's3cr3t',
  authUrl: 'https://kc.example/realms/api/protocol/openid-connect/token',
  apiUrl: 'https://api.example/v1',
  allowWrites: true,
  revealPii: false,
  transport: 'stdio',
  logLevel: 'info',
  requestTimeoutMs: 30000,
};

async function listTools() {
  const server = createServer(CONFIG, { fetch: vi.fn<typeof fetch>() });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 't', version: '0' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return (await client.listTools()).tools;
}

describe('tool descriptions', () => {
  it('use the shared REDACTION_NOTE and not the old sentence', async () => {
    const tools = await listTools();
    const mentioning = tools.filter((t) => (t.description ?? '').includes('INIO_REVEAL_PII'));
    expect(mentioning).toHaveLength(17);
    for (const t of tools) {
      expect(t.description ?? '').not.toContain('Personal data is redacted');
    }
    for (const t of mentioning) {
      expect(t.description).toContain(REDACTION_NOTE);
    }
  });
});

describe('README redacted-fields list', () => {
  const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  const block = /<!-- redacted-fields -->([\s\S]*?)<!-- \/redacted-fields -->/.exec(readme)?.[1];
  const tokens = [...(block ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '');

  it('has a marked block with tokens', () => {
    expect(block).not.toBeUndefined();
    expect(tokens.length).toBeGreaterThan(0);
  });

  it('lists only sensitive keys', () => {
    for (const t of tokens) expect(isSensitiveKey(t)).toBe(true);
  });

  it('lists every SENSITIVE_KEYS entry', () => {
    for (const key of SENSITIVE_KEYS) {
      expect(tokens.some((t) => t.toLowerCase() === key.toLowerCase())).toBe(true);
    }
  });

  it('lists the email, phone and addressline patterns', () => {
    expect(tokens.some((t) => t.toLowerCase().includes('email'))).toBe(true);
    expect(tokens.some((t) => t.toLowerCase().includes('phone'))).toBe(true);
    expect(tokens.some((t) => /^addressline\d*$/i.test(t))).toBe(true);
  });

  it('REDACTION_NOTE points at INIO_REVEAL_PII', () => {
    expect(REDACTION_NOTE).toContain('INIO_REVEAL_PII');
  });
});

describe('REDACTION_NOTE text', () => {
  const [redacted, kept] = REDACTION_NOTE.toLowerCase().split('; ');

  it.each([
    'email',
    'phone',
    'address lines',
    'zip',
    'ssn',
    'iban',
    'bank account',
    'invoice links',
  ])('lists %s as redacted', (term) => {
    expect(redacted).toContain(term);
  });

  it.each(['names', 'city', 'organisation', 'vat', 'references', 'free text'])(
    'lists %s as not redacted',
    (term) => {
      expect(kept).toContain(term);
    },
  );
});
