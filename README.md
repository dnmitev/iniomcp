# inio-mcp

Model Context Protocol (MCP) server for the [Inio](https://inio.com) REST API. Connect AI assistants such as Claude, Cursor or VS Code to your own Inio data: customers, invoices, pauses, retry attempts and payments.

> **Status:** early development. Seven read-only tools work today; not yet published to npm. See [docs/PLANNING.md](docs/PLANNING.md).

## Planned usage

```bash
export INIO_CLIENT_ID=...       # your Inio API client id
export INIO_CLIENT_SECRET=...   # your Inio API client secret
export INIO_AUTH_URL=...        # OIDC token endpoint of your Inio API realm
export INIO_URL=...             # Inio API gateway base URL, including /v1
npx -y @inio/mcp
```

| Variable             | Required | Default | Purpose                                            |
| -------------------- | -------- | ------- | -------------------------------------------------- |
| `INIO_CLIENT_ID`     | yes      |         | API client id (OAuth2 client credentials)          |
| `INIO_CLIENT_SECRET` | yes      |         | API client secret                                  |
| `INIO_AUTH_URL`      | yes      |         | Token endpoint (or realm issuer URL)               |
| `INIO_URL`           | yes      |         | API base URL incl. `/v1`, must be `https`          |
| `INIO_ALLOW_WRITES`  | no       | `false` | Enables tools that create or change data           |
| `INIO_REVEAL_PII`    | no       | `false` | Disables redaction of SSN, IBAN and similar fields |
| `MCP_TRANSPORT`      | no       | `stdio` | `stdio` or `http`                                  |
| `INIO_LOG_LEVEL`     | no       | `info`  | `fatal` … `trace`, or `silent`                     |

The server is read-only by default.

## Tools

All tools are read-only. Results are compacted (empty values dropped) and personal data is redacted unless `INIO_REVEAL_PII=true`.

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

## Use with Claude Desktop (from source)

Until the npm package is published, build the server and point Claude Desktop at it:

```bash
git clone https://github.com/dnmitev/iniomcp.git && cd iniomcp
npm ci && npm run build
```

Add this to `~/Library/Application Support/Claude/claude_desktop_config.json` (Windows: `%APPDATA%\Claude\claude_desktop_config.json`) and restart Claude Desktop:

```json
{
  "mcpServers": {
    "inio": {
      "command": "node",
      "args": ["/absolute/path/to/iniomcp/dist/index.js"],
      "env": {
        "INIO_CLIENT_ID": "your-client-id",
        "INIO_CLIENT_SECRET": "your-client-secret",
        "INIO_AUTH_URL": "https://<your-keycloak>/realms/<realm>/protocol/openid-connect/token",
        "INIO_URL": "https://<your-inio-api-gateway>/v1",
        "INIO_LOG_LEVEL": "info"
      }
    }
  }
}
```

Then ask, for example: "Show me invoice INV-1001".

## Logs

The server writes JSON log lines to stderr (stdout carries the MCP protocol). Claude Desktop saves them to `~/Library/Logs/Claude/mcp-server-inio.log`. Each tool call logs its duration, outcome and approximate token cost (`approxTokens`); set `INIO_LOG_LEVEL=debug` to also see every API call and token refresh. Secrets and tokens are never logged.

## Development

| Command                              | Purpose                                                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                        | Run the server from source with Node's watch mode                                                              |
| `npm run inspect`                    | Open the server in the MCP Inspector                                                                           |
| `npm test`                           | Unit tests                                                                                                     |
| `npm run test:integration`           | Builds, then tests the built server against a Keycloak container and a fake Inio API (needs Docker)            |
| `npm run test:live`                  | Opt-in tests against a real Inio environment: set `INIO_LIVE=1` and the `INIO_*` variables (or a local `.env`) |
| `npm run mutation`                   | Mutation testing (Stryker)                                                                                     |
| `npm run lint` / `npm run typecheck` | oxlint (type-aware) + Prettier / TypeScript 7                                                                  |

## License

[Apache License 2.0](LICENSE). The license covers this source code only. It does not grant access to the Inio API; you need your own Inio API credentials.
