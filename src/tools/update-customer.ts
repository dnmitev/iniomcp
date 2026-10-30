import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { InioClient } from '../inio-client.ts';
import { noopLogger, type Logger } from '../logger.ts';
import { REDACTION_NOTE } from '../redact.ts';
import { CustomerRef, customerPath } from './customer-ref.ts';
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
  acceptedUnreadable,
  EXACTLY_ONE_REF,
  exactlyOneRef,
  ok,
  present,
  writeFailure,
} from './result.ts';
import { withToolLogging } from '../tool-logging.ts';

type Deps = {
  client: Pick<InioClient, 'patch'>;
  revealPii: boolean;
  logger?: Pick<Logger, 'info'>;
};

const optionalLine = line.nullable().optional();

// Every field optional: the API merges a partial address into the stored one.
const Address = z
  .strictObject({
    countryCode: countryCode.optional(),
    city: city.optional(),
    zipCode: zipCode.optional(),
    addressLine1: line.optional(),
    addressLine2: optionalLine,
    addressLine3: optionalLine,
    addressLine4: optionalLine,
    addressLine5: optionalLine,
  })
  .refine((a) => Object.keys(a).length > 0, { message: 'Provide at least one address field.' });

const Fields = {
  customerName: z
    .string()
    .min(2)
    .max(100)
    .optional()
    .describe('New customer name, 2-100 characters'),
  distributionEmailAddress: email('Primary', true),
  distributionEmailAddress2: email('Second', true),
  distributionEmailAddress3: email('Third', true),
  mobilePhoneNo: z
    .string()
    .regex(/^\+\d{1,17}$/)
    .nullable()
    .optional()
    .describe('Mobile phone number in international format, e.g. +46701234567, or null to clear'),
  languageCode: z
    .enum(['EN', 'SV', 'BG', 'DE'])
    .nullable()
    .optional()
    .describe('Language: EN, SV, BG or DE, or null to clear'),
  customerAddress: Address.optional().describe(
    'Address fields to change, the rest is kept: countryCode, city, zipCode, addressLine1, addressLine2-5 (null clears addressLine2-5)',
  ),
  shippingAddress: Address.nullable()
    .optional()
    .describe(
      'Shipping address fields to change, same shape as customerAddress, or null to remove the shipping address',
    ),
};

const Input = z
  .strictObject({ ...CustomerRef, ...Fields })
  .refine(exactlyOneRef, EXACTLY_ONE_REF)
  .refine((a) => Object.keys(Fields).some((k) => k in a), {
    message: 'Provide at least one field to update.',
  })
  .refine(distinctEmails, DISTINCT_EMAILS);

// The API answers with a one-element array holding the updated customer.
const Payload = z.tuple([z.record(z.string(), z.unknown())]);

export function registerUpdateCustomer(
  server: McpServer,
  { client, revealPii, logger = noopLogger }: Deps,
): void {
  server.registerTool(
    'update_customer',
    {
      title: 'Update customer',
      description:
        'Update a customer by UUID (id) or customer number (number); pass exactly one. Only the fields you give are changed: null clears an optional field, and customerAddress and shippingAddress are merged field by field. Customer type, SSN, organisation number, VAT number and workflow settings cannot be changed with this tool. Changes the customer record only; nothing is sent to the customer. Returns the updated customer. ' +
        REDACTION_NOTE,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: Input,
    },
    withToolLogging(logger, 'update_customer', async ({ id, number, ...body }) => {
      try {
        const parsed = Payload.safeParse(await client.patch(customerPath({ id, number }), body));
        if (!parsed.success) {
          return acceptedUnreadable();
        }
        // workflowsSettings is large and not editable here; leave it out as get_customer does.
        const [{ workflowsSettings: _, ...customer }] = parsed.data;
        return ok(present(customer, revealPii));
      } catch (err) {
        return writeFailure(err);
      }
    }),
  );
}
