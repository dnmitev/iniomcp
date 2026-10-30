# inio-mcp

Model Context Protocol (MCP) server for the [Inio](https://inio.com) REST API. Connect AI assistants such as Claude, Cursor or VS Code to your own Inio data: customers, invoices, pauses, retry attempts and payments.

> **Status:** 0.4.0. Read-only by default, with opt-in write tools; stdio or a shared HTTP server. Published as `@dnmitev/inio-mcp` until it moves to the `@inio` scope.

## Install

You need Node.js 24 or later and Inio API client credentials (OAuth2 client credentials for your Inio API realm).

```bash
export INIO_CLIENT_ID=...       # your Inio API client id
export INIO_CLIENT_SECRET=...   # your Inio API client secret
export INIO_AUTH_URL=...        # token endpoint (or realm issuer URL) of your Inio API realm
export INIO_URL=...             # Inio API gateway base URL, including /v1
npx -y @dnmitev/inio-mcp@0.4.0
```

| Variable                  | Required  | Default     | Purpose                                                                                                                                                                                                                                   |
| ------------------------- | --------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INIO_CLIENT_ID`          | yes       |             | API client id (OAuth2 client credentials)                                                                                                                                                                                                 |
| `INIO_CLIENT_SECRET`      | yes       |             | API client secret                                                                                                                                                                                                                         |
| `INIO_AUTH_URL`           | yes       |             | Token endpoint (or realm issuer URL)                                                                                                                                                                                                      |
| `INIO_URL`                | yes       |             | API base URL incl. `/v1`, must be `https`                                                                                                                                                                                                 |
| `INIO_REVEAL_PII`         | no        | `false`     | `true` turns off redaction of the fields listed in [Data protection](#data-protection)                                                                                                                                                    |
| `INIO_LOG_LEVEL`          | no        | `info`      | `fatal` … `trace`, or `silent`                                                                                                                                                                                                            |
| `INIO_REQUEST_TIMEOUT_MS` | no        | `30000`     | Timeout per Inio API or token request, 1000–600000 ms. A timeout returns `TIMEOUT` (reported in whole seconds, rounded up). One tool call can take up to about 5 × this value + 5 s if a token refresh and a rate-limit retry both happen |
| `MCP_TRANSPORT`           | no        | `stdio`     | `stdio`, or `http` for a shared server (see [Shared HTTP server](#shared-http-server))                                                                                                                                                    |
| `MCP_AUTH_TOKEN`          | http only |             | Bearer token every HTTP request must send; at least 32 characters, no whitespace. Generate with `openssl rand -hex 32`                                                                                                                    |
| `PORT`                    | no        | `3000`      | HTTP port                                                                                                                                                                                                                                 |
| `HOST`                    | no        | `127.0.0.1` | HTTP bind address (`0.0.0.0` in the Docker image)                                                                                                                                                                                         |
| `MCP_ALLOWED_ORIGINS`     | no        |             | Comma-separated browser origins allowed besides localhost, e.g. `https://app.example.com`; matched by hostname                                                                                                                            |
| `INIO_ALLOW_WRITES`       | no        | `false`     | `true` registers the write tools (see below); off by default                                                                                                                                                                              |

### Claude Desktop

Add this to `~/Library/Application Support/Claude/claude_desktop_config.json` (Windows: `%APPDATA%\Claude\claude_desktop_config.json`) and restart Claude Desktop:

```json
{
  "mcpServers": {
    "inio": {
      "command": "npx",
      "args": ["-y", "@dnmitev/inio-mcp@0.4.0"],
      "env": {
        "INIO_CLIENT_ID": "your-client-id",
        "INIO_CLIENT_SECRET": "your-client-secret",
        "INIO_AUTH_URL": "https://<your-keycloak>/realms/<realm>/protocol/openid-connect/token",
        "INIO_URL": "https://<your-inio-api-gateway>/v1"
      }
    }
  }
}
```

These config files (Claude Desktop, Cursor and the Docker example below) hold the client secret in plaintext. Keep them readable only by you (`chmod 600` on macOS and Linux), never commit a project `.cursor/mcp.json`, and prefer VS Code's secret prompt below where you can.

### Cursor

Add the same `inio` entry to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project), under `mcpServers`.

### VS Code

Add this to `.vscode/mcp.json` in your workspace. VS Code prompts for the secret once and stores it securely:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "inio-secret",
      "description": "Inio API client secret",
      "password": true
    }
  ],
  "servers": {
    "inio": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@dnmitev/inio-mcp@0.4.0"],
      "env": {
        "INIO_CLIENT_ID": "your-client-id",
        "INIO_CLIENT_SECRET": "${input:inio-secret}",
        "INIO_AUTH_URL": "https://<your-keycloak>/realms/<realm>/protocol/openid-connect/token",
        "INIO_URL": "https://<your-inio-api-gateway>/v1"
      }
    }
  }
}
```

### Docker

The image runs the same server as a non-root user, over stdio by default (HTTP: see [Shared HTTP server](#shared-http-server)). Pass the variables with `-e` and keep stdin open with `-i`:

```json
{
  "mcpServers": {
    "inio": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "INIO_CLIENT_ID",
        "-e",
        "INIO_CLIENT_SECRET",
        "-e",
        "INIO_AUTH_URL",
        "-e",
        "INIO_URL",
        "ghcr.io/dnmitev/inio-mcp:0.4.0"
      ],
      "env": {
        "INIO_CLIENT_ID": "your-client-id",
        "INIO_CLIENT_SECRET": "your-client-secret",
        "INIO_AUTH_URL": "https://<your-keycloak>/realms/<realm>/protocol/openid-connect/token",
        "INIO_URL": "https://<your-inio-api-gateway>/v1"
      }
    }
  }
}
```

Then ask, for example: "Which open invoices does customer C-1001 have?"

### Pinning and verification

The examples pin version 0.4.0. Change the version on purpose when you upgrade; do not drop it. The pin covers the package itself: npx still resolves its dependencies within their declared ranges on each fresh install.

- **npm:** the package is published with npm provenance. The Provenance section on the package's npmjs.com page shows the source repository and workflow that built it; `npm view @dnmitev/inio-mcp@0.4.0 dist.attestations` gives the URL of the attestation bundle that records them. `npm audit signatures`, run in a project that installed the package (for example `npm init -y && npm i --ignore-scripts @dnmitev/inio-mcp@0.4.0 && npm audit signatures`), checks the registry signatures and provenance attestations of everything installed.
- **Docker:** look up the digest with `docker buildx imagetools inspect ghcr.io/dnmitev/inio-mcp:0.4.0` and use `ghcr.io/dnmitev/inio-mcp@sha256:<digest>`. Pinning the digest stops the tag from changing under you; it does not by itself prove who built the image.

## Shared HTTP server

One server can serve a whole team over Streamable HTTP. It holds the Inio client credentials; team members only get an MCP token. Every request to `/mcp` must send `Authorization: Bearer <MCP_AUTH_TOKEN>`, otherwise it gets 401. Browser requests from origins other than localhost (or `MCP_ALLOWED_ORIGINS`) get 403.

Start it with npx:

```bash
export MCP_AUTH_TOKEN=$(openssl rand -hex 32)   # share this with your team
MCP_TRANSPORT=http npx -y @dnmitev/inio-mcp@0.4.0   # plus the four INIO_* variables
```

Or with Docker (the image listens on `0.0.0.0:3000` in HTTP mode and stops cleanly on `docker stop`):

```bash
docker run -d --name inio-mcp -p 127.0.0.1:3000:3000 \
  -e MCP_TRANSPORT=http -e MCP_AUTH_TOKEN \
  -e INIO_CLIENT_ID -e INIO_CLIENT_SECRET -e INIO_AUTH_URL -e INIO_URL \
  ghcr.io/dnmitev/inio-mcp:0.4.0
```

### Connect a client

Claude Code:

```bash
claude mcp add --transport http inio https://mcp.example.com/mcp --header "Authorization: Bearer $INIO_MCP_TOKEN"
```

Cursor (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "inio": {
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

VS Code (`.vscode/mcp.json`; VS Code prompts for the token once and stores it securely):

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "inio-token",
      "description": "inio-mcp token",
      "password": true
    }
  ],
  "servers": {
    "inio": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer ${input:inio-token}" }
    }
  }
}
```

For Claude Desktop, use the local setup [above](#claude-desktop).

### Security

- Put the server behind a reverse proxy that terminates TLS, and do not expose port 3000 directly. The server has no TLS of its own.
- One server serves one Inio tenant, with that tenant's credentials. Everyone holding the token has the same access, and `INIO_ALLOW_WRITES` and `INIO_REVEAL_PII` apply to all of them.
- There is one token. To rotate it, change `MCP_AUTH_TOKEN` and restart the server.
- The token is checked before the request body is read; requests without a valid token get 401 and their body is never read. Authenticated requests larger than 256 KiB get 413.
- When `HOST` is not a loopback address (the Docker image uses `0.0.0.0`), the server logs a warning at startup: the token is then the only barrier, so keep the port behind the proxy.

## Tools

These tools are read-only. Results are compacted (empty values dropped). Email addresses, phone numbers, address lines, zip codes, SSNs, bank details and invoice links are redacted unless `INIO_REVEAL_PII=true`; names, city, organisation and VAT numbers, references and free text are not. See [Data protection](#data-protection) for the exact list.

| Tool                         | Purpose                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `list_customers`             | Customer summaries, filtered by customer number, direct debit or service line, with sort and paging       |
| `get_customer`               | One customer with its service line and active pause, by UUID or customer number                           |
| `get_customer_pause`         | One customer pause by customer UUID and pause UUID                                                        |
| `list_customer_pauses`       | Pauses of a customer, optionally filtered by status                                                       |
| `list_invoices`              | Invoice summaries, filtered by invoice number, customer, status or payment status, with sort and paging   |
| `get_invoice`                | One invoice by UUID or invoice number                                                                     |
| `get_invoice_retry_attempts` | Direct-debit retry attempts of an invoice, with failed and successful counts and direct-debit eligibility |

Options on the detail tools:

- `get_invoice` takes `withInherited` to add inherited values (IBAN, bank, effective pause). With an invoice number this makes two API calls.
- `get_invoice` and `get_customer` take `includeWorkflowSettings` to add `workflowsSettings` (distribution method, escalation fees and timing, enabled stages). It is large, so it is off by default.

If the Inio API rate-limits a request (HTTP 429), the server waits for `Retry-After` (at most 5 s) and retries once; a second 429 is returned as `RATE_LIMITED`.

## Write tools (opt-in)

Write tools are registered only when the server runs with `INIO_ALLOW_WRITES=true`. They are marked as destructive, so MCP clients can ask you to confirm each call (Claude Desktop does unless you allow the tool permanently). Every write is recorded in Inio's audit fields as `inio-mcp`. The Inio API has no roles for API clients: with writes enabled, anything these tools can do is allowed for your credentials.

| Tool                              | What it changes                                                                                                                                                                                                                                                                                    | Undo                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `create_customer_pause`           | Pauses reminders and/or debt-collection transfers for a customer from a future date                                                                                                                                                                                                                | Cancel the pause                                                         |
| `update_customer_pause`           | Changes a pause's dates or scope (active pauses: end date only)                                                                                                                                                                                                                                    | Update it again                                                          |
| `cancel_customer_pause`           | Cancels a scheduled or active pause                                                                                                                                                                                                                                                                | **Cannot be undone**; create a new one                                   |
| `update_invoice_due_date`         | Postpones an invoice's due date; sends the `invoiceDueDatePostponed` webhook to your systems                                                                                                                                                                                                       | **Cannot be undone** (postpone only)                                     |
| `update_invoice_stop_until_dates` | Sets or clears the dates until which reminders and debt-collection steps are held back (needs the stop-until feature)                                                                                                                                                                              | Set it again or clear it (null); the previous date is not kept           |
| `update_customer`                 | Changes a customer's name, distribution emails, mobile number, language or addresses (null clears a field). No SSN, org or VAT number                                                                                                                                                              | Update it again; the previous values are not kept                        |
| `reset_invoice_stage`             | Moves an invoice back to `invoiced` (new due date) or `reminded`; may waive outstanding fees. Re-sends to the end customer only with `redistribute: true`                                                                                                                                          | **Cannot be undone**                                                     |
| `create_credit_invoice`           | Credits items of an invoice with a new credit invoice. Sent to the end customer only with `distributionEnabled: true`                                                                                                                                                                              | **Cannot be undone**                                                     |
| `match_credit_invoice`            | Matches an existing credit invoice against an invoice, lowering its remaining amount                                                                                                                                                                                                               | **Cannot be undone**                                                     |
| `create_payment`                  | Records one payment against an invoice: `direct_payment`, `good_will`, `bank` or `reminder_fee_waiver`. A full payment must be asked for with `fullPayment: true`. Each call records a new payment                                                                                                 | **Cannot be undone**                                                     |
| `create_customer`                 | Creates one customer (consumer `C` with SSN, or business `B` with orgNr and vatNo). Database only; nothing is sent to the customer. Some assistants (Claude among them) decline to send an SSN, so create consumers in the back office if yours does. A customerNo that already exists is rejected | Update it with `update_customer`; **cannot be deleted** with these tools |

If a write times out, cannot reach the API or gets a server error (HTTP 5xx), the change may or may not have been applied, and the result says to check the customer or invoice before trying again. If the API accepts a write but its answer cannot be read, the tool reports success with a note to check before retrying.

Not available: reversing a payment (the public API does not expose the payment allocation ids that reversal needs) and creating invoices (creating one sends it to the end customer at once). Use the Inio back office for these.

## Logs

The server writes JSON log lines to stderr (stdout carries the MCP protocol). Claude Desktop saves them to `~/Library/Logs/Claude/mcp-server-inio.log`. Each tool call logs its duration, outcome and approximate token cost (`approxTokens`); set `INIO_LOG_LEVEL=debug` to also see every API call and token refresh. Secrets and tokens are never logged.

## Data protection

What the server redacts from tool results (unless `INIO_REVEAL_PII=true`):

<!-- redacted-fields -->

- any field whose name contains `email`, and email addresses inside any text
- any field whose name contains `phone`
- address lines: `addressLine`, `addressLine1`, `addressLine2`, …
- `zipCode`
- `ssn`
- `iban`, `bankAccount`, `accountNumber`
- invoice links: `pdfURL`, `digitalInvoiceURL` (anyone holding the link can open the invoice)

<!-- /redacted-fields -->

Error messages always hide email addresses, and the per-field error messages for the fields listed above, even with `INIO_REVEAL_PII=true`. Other error text is returned as the API gives it. Everything else is returned as the API gives it, including customer names, city, organisation and VAT numbers, references, free-text fields, amounts and invoice stages. For consumers (customer type `C`) a name, or a sole trader's organisation number, is personal data.

- Tool results go to the LLM provider behind your assistant (for example Anthropic for Claude, or the model provider you chose in Cursor or VS Code). Your organisation needs a data processing agreement with that provider that covers your customers' data.
- Arguments of write tools, such as the SSN, contact details and addresses in `create_customer` and `update_customer`, are in your prompt and in the tool call. They reach the provider whatever `INIO_REVEAL_PII` says.
- The server stores nothing. It keeps the Inio access token in memory only.
- Logs (stderr) contain tool names, durations and outcomes. Failed API calls are logged with their path, which can include a customer or invoice number or id; at `debug` level every API call is. Logs never contain tokens, secrets or tool results.

## Release model

inio-mcp has a single maintainer. Releases are published only by the GitHub Actions release workflow, from version tags: it publishes to npm with provenance and pushes the image to GHCR. See [Pinning and verification](#pinning-and-verification) for how to check a release. The package moves to the `@inio` scope and the company GitHub organisation later; the README will say when.

## Development

To run from source, clone the repository, run `npm ci && npm run build`, and point your client at `node /absolute/path/to/iniomcp/dist/index.js`.

| Command                                            | Purpose                                                                                                                                                                                                                                                                                |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                      | Run the server from source with Node's watch mode                                                                                                                                                                                                                                      |
| `npm run inspect`                                  | Open the server in the MCP Inspector                                                                                                                                                                                                                                                   |
| `npm test`                                         | Unit tests                                                                                                                                                                                                                                                                             |
| `npm run test:integration`                         | Builds, then tests the built server against a Keycloak container and a fake Inio API (needs Docker)                                                                                                                                                                                    |
| `npm run test:package`                             | Packs the npm package, installs it into a temp project and checks the installed server                                                                                                                                                                                                 |
| `npm run test:live`                                | Opt-in tests against a real Inio environment: set `INIO_LIVE=1` and the `INIO_*` variables (or a local `.env`)                                                                                                                                                                         |
| `npm run smoke:writes -- <customerNo> [invoiceNo]` | Live check of the write tools for a customer (and invoice) you name: renames the customer and restores the name, creates, updates and cancels a pause 30–45 days ahead, sets and clears a stop-until date. Changes data; never postpones a due date, resets a stage or creates credits |
| `npm run mutation`                                 | Mutation testing (Stryker)                                                                                                                                                                                                                                                             |
| `MUTATE=src/http.ts npm run mutation -- --force`   | Mutation testing for selected files only (comma-separated)                                                                                                                                                                                                                             |
| `npm run lint` / `npm run typecheck`               | oxlint (type-aware) + Prettier / TypeScript 7                                                                                                                                                                                                                                          |

## License

[Apache License 2.0](LICENSE). The license covers this source code only. It does not grant access to the Inio API; you need your own Inio API credentials.
