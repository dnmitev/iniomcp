/** Sentence appended to every tool description that returns personal data; keep in sync with SENSITIVE_KEYS and redact(). */
export const REDACTION_NOTE =
  'Email addresses (also inside text), phone numbers, address lines, zip codes, SSNs, bank details (IBAN, bank account and account numbers) and invoice links are redacted unless the server runs with INIO_REVEAL_PII=true; names, city, organisation and VAT numbers, references, free text and amounts are not.';

export const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'iban',
  'ssn',
  'bankaccount',
  'accountnumber',
  'digitalinvoiceurl',
  'zipcode',
  'pdfurl',
]);
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/** True for keys whose values are personal data, matched case-insensitively. */
export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return (
    SENSITIVE_KEYS.has(k) ||
    k.includes('email') ||
    k.includes('phone') ||
    /^addressline\d*$/.test(k)
  );
}

/** Replaces email addresses in a string with "[redacted-email]". */
export function redactText(value: string): string {
  return value.replace(EMAIL, '[redacted-email]');
}

/** Deep copy of a JSON value with PII keys (any depth, case-insensitive) replaced by "[redacted]" and email addresses in strings by "[redacted-email]". */
export function redact(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(redact);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, isSensitiveKey(k) ? '[redacted]' : redact(v)]),
  );
}
