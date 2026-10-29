import { z } from 'zod';
import { InioApiError } from '../inio-client.ts';
import { isSensitiveKey, redact, redactText } from '../redact.ts';

const MAX_FIELD_ERRORS = 10;

/** Formats an error as the tool's error text: "<code>: <message> (correlationId <id>)" for API errors; emails in messages are redacted. */
export function errorText(err: unknown): string {
  if (err instanceof InioApiError) {
    const suffix = err.correlationId ? ` (correlationId ${err.correlationId})` : '';
    const fieldErrors = err.fieldErrors ?? [];
    const shown = fieldErrors.slice(0, MAX_FIELD_ERRORS).map(({ fieldName, message }) => {
      // The message may echo the rejected value, so hide it for PII fields ("0.iban" → iban).
      const sensitive = isSensitiveKey(fieldName.split('.').at(-1) ?? fieldName);
      return `${fieldName}: ${sensitive ? '[redacted]' : message}`;
    });
    const more = fieldErrors.length - shown.length;
    if (more > 0) shown.push(`… and ${more} more`);
    const fields = shown.length > 0 ? ` Fields: ${shown.join('; ')}` : '';
    return `${err.code}: ${redactText(err.message)}${suffix}${redactText(fields)}`;
  }
  return redactText(err instanceof Error ? err.message : String(err));
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

/** JSON text for a tool result, redacted unless revealPii; the caller compacts the parts it wants compacted. */
export function presentRaw(value: unknown, revealPii: boolean): string {
  return JSON.stringify(revealPii ? value : redact(value));
}

/** JSON text for a tool result: compacted, then redacted unless revealPii. */
export function present(value: unknown, revealPii: boolean): string {
  return presentRaw(compact(value), revealPii);
}

/** Refine check and message for tools addressed by id or number: exactly one of the two. */
export const exactlyOneRef = (a: {
  id?: string | undefined;
  number?: string | undefined;
}): boolean => (a.id === undefined) !== (a.number === undefined);
export const EXACTLY_ONE_REF = { message: 'Provide exactly one of id or number.' };

/** A real calendar date as YYYY-MM-DD (zod's ISO date checks month lengths and leap years). */
export const IsoDate = z.iso.date();

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
  return presentRaw(page, revealPii);
}

/** True for an API error whose HTTP status is 2xx: the write went through but the client could not parse the answer. */
export const isUnreadableSuccess = (err: unknown): boolean =>
  err instanceof InioApiError && err.status >= 200 && err.status < 300;
