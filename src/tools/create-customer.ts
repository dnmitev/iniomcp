import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { InioApiError, type InioClient } from '../inio-client.ts';
import { noopLogger, type Logger, type TokenProvider } from '../auth.ts';
import { CustomerRef } from './customer-ref.ts';
import {
  city,
  countryCode,
  DISTINCT_EMAILS,
  distinctEmails,
  email,
  line,
  zipCode,
} from './customer-fields.ts';
import {
  clientIdOf,
  errorText,
  fail,
  isUncertainOutcome,
  isUnreadableSuccess,
  ok,
  present,
} from './result.ts';
import { withToolLogging } from '../tool-logging.ts';

type Deps = {
  client: Pick<InioClient, 'post'>;
  revealPii: boolean;
  logger?: Pick<Logger, 'info'>;
  tokens: Pick<TokenProvider, 'getToken'>;
};

// Full address: the API wants country, city, zip and the first line.
const Address = z.strictObject({
  countryCode,
  city,
  zipCode,
  addressLine1: line,
  addressLine2: line.optional(),
  addressLine3: line.optional(),
  addressLine4: line.optional(),
  addressLine5: line.optional(),
});

const id = (max: number, text: string) => z.string().min(1).max(max).describe(text);

const Input = z
  .strictObject({
    customerNo: CustomerRef.number
      .unwrap()
      .describe('New customer number, 1-50 characters; must not exist yet'),
    customerName: z.string().min(2).max(100).describe('Customer name, 2-100 characters'),
    customerType: z.enum(['B', 'C']).describe('B for a business, C for a consumer'),
    languageCode: z.enum(['EN', 'SV', 'BG', 'DE']).describe('Language: EN, SV, BG or DE'),
    serviceLineName: id(
      60,
      'Service line name, 1-60 characters; copy it from get_customer of an existing customer',
    ),
    customerAddress: Address.describe(
      'Customer address: countryCode, city, zipCode and addressLine1 are required; addressLine2-5 are optional',
    ),
    shippingAddress: Address.optional().describe('Shipping address, same shape as customerAddress'),
    distributionEmailAddress: email('Primary', false),
    distributionEmailAddress2: email('Second', false),
    distributionEmailAddress3: email('Third', false),
    mobilePhoneNo: z
      .string()
      .regex(/^\+\d{1,17}$/)
      .optional()
      .describe('Mobile phone number in international format, e.g. +46701234567'),
    SSN: id(
      25,
      'Personal identity number, 1-25 characters; required for customerType C, not allowed for B',
    ).optional(),
    orgNr: id(
      25,
      'Organisation number, 1-25 characters; required for customerType B, not allowed for C',
    ).optional(),
    vatNo: id(
      100,
      'VAT number, 1-100 characters; required for customerType B, not allowed for C',
    ).optional(),
  })
  .refine(distinctEmails, DISTINCT_EMAILS)
  .refine((a) => a.customerType === 'B' || a.SSN !== undefined, {
    message: 'SSN is required for customerType C.',
  })
  .refine((a) => a.customerType === 'C' || a.SSN === undefined, {
    message: 'SSN is only for customerType C.',
  })
  .refine((a) => a.customerType === 'C' || (a.orgNr !== undefined && a.vatNo !== undefined), {
    message: 'orgNr and vatNo are required for customerType B.',
  })
  .refine((a) => a.customerType === 'B' || (a.orgNr === undefined && a.vatNo === undefined), {
    message: 'orgNr and vatNo are only for customerType B.',
  });

const Answer = z.array(z.string().min(1)).length(1);

const UNREADABLE = 'The customer was created, but the API answer could not be read.';

export function registerCreateCustomer(
  server: McpServer,
  { client, revealPii, logger = noopLogger, tokens }: Deps,
): void {
  server.registerTool(
    'create_customer',
    {
      title: 'Create customer',
      description:
        'Creates a customer. customerNo must be new: a customerNo that exists is rejected, and serviceLineName can be copied from get_customer of an existing customer. A consumer (customerType C) needs SSN; a business (customerType B) needs orgNr and vatNo. If you cannot send an SSN, say that the consumer must be created in the Inio back office. A retry with the same customerNo is rejected, but after an unclear outcome check get_customer by number before trying again. The customer is only created; nothing is sent to the customer. This cannot be undone with these tools. Returns the new customer id and customerNo. Personal data is redacted unless the server runs with INIO_REVEAL_PII=true.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: Input,
    },
    withToolLogging(logger, 'create_customer', async (input) => {
      const summary = { created: true, customerNo: input.customerNo };
      try {
        const clientId = clientIdOf(await tokens.getToken());
        const answer = Answer.safeParse(await client.post('/customers', [{ ...input, clientId }]));
        // The customer exists once the POST resolves, so an unreadable answer is still success.
        if (!answer.success) return ok(present({ ...summary, note: UNREADABLE }, revealPii));
        return ok(
          present({ created: true, id: answer.data[0], customerNo: input.customerNo }, revealPii),
        );
      } catch (err) {
        // A 2xx the client could not parse (no result envelope) also means the customer exists.
        if (isUnreadableSuccess(err))
          return ok(present({ ...summary, note: UNREADABLE }, revealPii));
        if (err instanceof InioApiError && err.status === 409)
          return fail(
            `${errorText(err)} A customer with this customerNo already exists; call get_customer by number to see it.`,
          );
        const hint = ` The customer may or may not have been created. Do not retry yet: call get_customer with number ${input.customerNo} first.`;
        return fail(errorText(err) + (isUncertainOutcome(err) ? hint : ''));
      }
    }),
  );
}
