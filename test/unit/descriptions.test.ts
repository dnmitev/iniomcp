import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { createServer } from '../../src/server.ts';
import { WRITE_TOOL_NAMES, type Config } from '../../src/config.ts';
import {
  BUSINESS_SENSITIVE_KEYS,
  REDACTION_NOTE,
  SENSITIVE_KEYS,
  isSensitiveKey,
} from '../../src/redact.ts';

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
  writeTools: new Set(WRITE_TOOL_NAMES),
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

describe('write tool descriptions state later effects', () => {
  it.each([
    ['cancel_customer_pause', /resume/i],
    ['update_invoice_stop_until_dates', /next schedule|run again/i],
    ['update_customer', /future/i],
    ['reset_invoice_stage', /restart/i],
  ])('%s says what happens later', async (name, phrase) => {
    const tools = await listTools();
    expect(tools.find((t) => t.name === name)?.description ?? '').toMatch(phrase);
  });
});

describe('README redacted-fields lists', () => {
  const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  const tokensOf = (mode: string) => {
    const block = new RegExp(
      `<!-- redacted-fields:${mode} -->([\\s\\S]*?)<!-- /redacted-fields:${mode} -->`,
    ).exec(readme)?.[1];
    return {
      block,
      tokens: [...(block ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? ''),
    };
  };
  const lower = (tokens: string[]) => tokens.map((t) => t.toLowerCase());

  describe('consumer block', () => {
    const { block, tokens } = tokensOf('consumer');

    it('has a marked block with tokens', () => {
      expect(block).not.toBeUndefined();
      expect(tokens.length).toBeGreaterThan(0);
    });

    it('lists only sensitive keys', () => {
      for (const t of tokens) expect(isSensitiveKey(t)).toBe(true);
    });

    it('lists every SENSITIVE_KEYS entry', () => {
      for (const key of SENSITIVE_KEYS) expect(lower(tokens)).toContain(key);
    });

    it('lists the new customer name, city and reference keys', () => {
      for (const key of ['customername', 'city', 'yourreference']) {
        expect(lower(tokens)).toContain(key);
      }
    });

    it('lists the email, phone and addressline patterns', () => {
      expect(tokens.some((t) => t.toLowerCase().includes('email'))).toBe(true);
      expect(tokens.some((t) => t.toLowerCase().includes('phone'))).toBe(true);
      expect(tokens.some((t) => /^addressline\d*$/i.test(t))).toBe(true);
    });
  });

  describe('business block', () => {
    const { block, tokens } = tokensOf('business');

    it('has a marked block with tokens', () => {
      expect(block).not.toBeUndefined();
      expect(tokens.length).toBeGreaterThan(0);
    });

    it('lists exactly the BUSINESS_SENSITIVE_KEYS', () => {
      expect([...new Set(lower(tokens))].sort((a, b) => a.localeCompare(b))).toEqual(
        [...BUSINESS_SENSITIVE_KEYS].sort((a, b) => a.localeCompare(b)),
      );
    });
  });
});

describe('REDACTION_NOTE text', () => {
  it('points at INIO_REVEAL_PII=true as the off switch', () => {
    expect(REDACTION_NOTE).toContain('INIO_REVEAL_PII=true');
  });

  it('says business customers (customerType B) only have invoice links redacted', () => {
    expect(REDACTION_NOTE).toContain('customerType B');
    expect(REDACTION_NOTE.toLowerCase()).toContain('invoice links');
  });

  it('says consumers (C) and unknown types have the listed fields redacted', () => {
    expect(REDACTION_NOTE).toMatch(/consumers? \(C\)/i);
    expect(REDACTION_NOTE.toLowerCase()).toContain('unknown');
  });

  it.each(['customer name', 'city', 'email', 'phone', 'address lines', 'zip', 'ssn', 'iban'])(
    'lists %s among the consumer fields',
    (term) => {
      expect(REDACTION_NOTE.toLowerCase()).toContain(term);
    },
  );

  it('says invoices returned by write tools use consumer rules', () => {
    expect(REDACTION_NOTE).toContain('write tools');
  });
});
