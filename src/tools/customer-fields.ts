import { z } from 'zod';

/** Field schemas shared by create_customer (full address) and update_customer (partial address). */
export const line = z.string().min(1).max(60);
export const countryCode = z.string().regex(/^[A-Za-z]{2}$/);
export const city = z.string().min(1).max(50);
export const zipCode = z.string().regex(/^[0-9A-Za-z ]{4,6}$/);

/** A distribution email field; `clearable` adds null for update_customer. */
export const email = (which: string, clearable: boolean) => {
  const base = clearable ? z.email().nullable() : z.email();
  return base
    .optional()
    .describe(`${which} distribution email address${clearable ? ', or null to clear' : ''}`);
};

/** Refine check: the distribution emails given are different, compared ignoring case. */
export const distinctEmails = (a: {
  distributionEmailAddress?: string | null | undefined;
  distributionEmailAddress2?: string | null | undefined;
  distributionEmailAddress3?: string | null | undefined;
}): boolean => {
  const emails = [
    a.distributionEmailAddress,
    a.distributionEmailAddress2,
    a.distributionEmailAddress3,
  ]
    .filter((e) => typeof e === 'string')
    // Email addresses are case-insensitive in practice, so A@x and a@x count as the same.
    .map((e) => e.toLowerCase());
  return new Set(emails).size === emails.length;
};
export const DISTINCT_EMAILS = { message: 'Distribution email addresses must be different.' };
