/** Sentence appended to every tool description that returns personal data; keep in sync with the key sets and redact(). */
export const REDACTION_NOTE =
  'Business customers (customerType B) have only invoice links and SSNs redacted. Consumers (C) and unknown types also have email addresses (also inside text), phone numbers, address lines, zip codes, city, customer name, your reference and bank details (IBAN, bank account and account numbers) redacted; invoices returned by write tools use consumer rules. INIO_REVEAL_PII=true turns redaction off.';

export type CustomerKind = 'business' | 'consumer';

export const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'iban',
  'ssn',
  'bankaccount',
  'accountnumber',
  'digitalinvoiceurl',
  'zipcode',
  'pdfurl',
  'customername',
  'city',
  'yourreference',
]);
/** The only keys redacted for business customers: invoice links and SSN (a sole trader's is personal). */
export const BUSINESS_SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'pdfurl',
  'digitalinvoiceurl',
  'ssn',
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

/** Deep copy of a JSON value with PII keys (any depth, case-insensitive) replaced by "[redacted]" and, for consumers, email addresses in strings by "[redacted-email]". An object's own customerType ("B" = business, any other value = consumer) overrides `type` for it and its children. */
export function redact(value: unknown, type: CustomerKind = 'consumer'): unknown {
  if (Array.isArray(value)) return value.map((v) => redact(v, type));
  if (value !== null && typeof value === 'object') {
    const own =
      'customerType' in value ? (value.customerType === 'B' ? 'business' : 'consumer') : type;
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        (own === 'business' ? BUSINESS_SENSITIVE_KEYS.has(k.toLowerCase()) : isSensitiveKey(k))
          ? '[redacted]'
          : redact(v, own),
      ]),
    );
  }
  return typeof value === 'string' && type === 'consumer' ? redactText(value) : value;
}
