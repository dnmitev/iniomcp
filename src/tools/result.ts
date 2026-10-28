import { z } from 'zod';
import { InioApiError } from '../inio-client.ts';
import { redact } from '../redact.ts';

/** Formats an error as the tool's error text: "<code>: <message> (correlationId <id>)" for API errors. */
export function errorText(err: unknown): string {
  if (err instanceof InioApiError) {
    const suffix = err.correlationId ? ` (correlationId ${err.correlationId})` : '';
    return `${err.code}: ${err.message}${suffix}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Successful tool result carrying one text item. */
export function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

/** Error tool result carrying one text item. */
export function fail(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  return typeof value === 'object' && Object.keys(value).length === 0;
}

/** Deep copy with null, undefined, "", [] and {} removed at any depth (after compacting children). */
export function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compact).filter((v) => !isEmpty(v));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .map(([k, v]) => [k, compact(v)] as const)
      .filter(([, v]) => !isEmpty(v)),
  );
}

/** JSON text for a tool result: compacted, then redacted unless revealPii. */
export function present(value: unknown, revealPii: boolean): string {
  const compacted = compact(value);
  return JSON.stringify(revealPii ? compacted : redact(compacted));
}

/** Paging fields to spread into a list tool's input schema. */
export const PageInput = {
  limit: z.int().min(1).max(100).default(25).describe('Page size, 1-100'),
  offset: z.int().min(0).default(0).describe('Number of items to skip'),
};

const ListPayload = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

/** Maps an Inio list payload to a page; nextOffset only when this page has items and more remain. */
export function toPage<T>(payload: unknown, mapItem: (item: Record<string, unknown>) => T) {
  const parsed = ListPayload.safeParse(payload);
  if (!parsed.success) {
    throw new InioApiError(200, 'UPSTREAM_ERROR', 'Unexpected list payload from the Inio API.');
  }
  const { data, total, limit, offset } = parsed.data;
  const items = data.map(mapItem);
  const next = offset + items.length;
  return {
    items,
    total,
    limit,
    offset,
    ...(items.length > 0 && next < total ? { nextOffset: next } : {}),
  };
}

/** Page text for a list tool: each item cut to `fields` and compacted, then redacted unless revealPii. */
export function presentPage(
  payload: unknown,
  fields: readonly string[],
  revealPii: boolean,
): string {
  const page = toPage(payload, (item) =>
    compact(Object.fromEntries(fields.map((k) => [k, item[k]]))),
  );
  // Compact items, not the page: present() would drop an empty items array.
  return JSON.stringify(revealPii ? page : redact(page));
}
