# inio-mcp

Model Context Protocol (MCP) server for the [Inio](https://inio.com) REST API. Connect AI assistants such as Claude, Cursor or VS Code to your own Inio data: customers, invoices, pauses, retry attempts and payments.

> **Status:** 0.1.0, read-only, stdio only. Published as `@dnmitev/inio-mcp` until it moves to the `@inio` scope.

## Install

You need Node.js 24 or later and Inio API client credentials (OAuth2 client credentials for your Inio API realm).

```bash
export INIO_CLIENT_ID=...       # your Inio API client id
export INIO_CLIENT_SECRET=...   # your Inio API client secret
export INIO_AUTH_URL=...        # token endpoint (or realm issuer URL) of your Inio API realm
export INIO_URL=...             # Inio API gateway base URL, including /v1
npx -y @dnmitev/inio-mcp
```

| Variable             | Required | Default | Purpose                                                  |
| -------------------- | -------- | ------- | -------------------------------------------------------- |
| `INIO_CLIENT_ID`     | yes      |         | API client id (OAuth2 client credentials)                |
| `INIO_CLIENT_SECRET` | yes      |         | API client secret                                        |
| `INIO_AUTH_URL`      | yes      |         | Token endpoint (or realm issuer URL)                     |
| `INIO_URL`           | yes      |         | API base URL incl. `/v1`, must be `https`                |
| `INIO_REVEAL_PII`    | no       | `false` | `true` disables redaction of personal data               |
| `INIO_LOG_LEVEL`     | no       | `info`  | `fatal` … `trace`, or `silent`                           |
| `MCP_TRANSPORT`      | no       | `stdio` | Only `stdio` is supported; HTTP comes in a later release |
| `INIO_ALLOW_WRITES`  | no       | `false` | Reserved for write tools (none in 0.1.0)                 |

### Claude Desktop

Add this to `~/Library/Application Support/Claude/claude_desktop_config.json` (Windows: `%APPDATA%\Claude\claude_desktop_config.json`) and restart Claude Desktop:

```json
{
  "mcpServers": {
    "inio": {
      "command": "npx",
      "args": ["-y", "@dnmitev/inio-mcp"],
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
      "args": ["-y", "@dnmitev/inio-mcp"],
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

The image runs the same stdio server as a non-root user. Pass the variables with `-e` and keep stdin open with `-i`:

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
        "ghcr.io/dnmitev/inio-mcp:0.1"
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

If the Inio API rate-limits a request (HTTP 429), the server waits for `Retry-After` (at most 5 s) and retries once; a second 429 is returned as `RATE_LIMITED`.

## Logs

The server writes JSON log lines to stderr (stdout carries the MCP protocol). Claude Desktop saves them to `~/Library/Logs/Claude/mcp-server-inio.log`. Each tool call logs its duration, outcome and approximate token cost (`approxTokens`); set `INIO_LOG_LEVEL=debug` to also see every API call and token refresh. Secrets and tokens are never logged.

## Development

To run from source, clone the repository, run `npm ci && npm run build`, and point your client at `node /absolute/path/to/iniomcp/dist/index.js`.

| Command                              | Purpose                                                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                        | Run the server from source with Node's watch mode                                                              |
| `npm run inspect`                    | Open the server in the MCP Inspector                                                                           |
| `npm test`                           | Unit tests                                                                                                     |
| `npm run test:integration`           | Builds, then tests the built server against a Keycloak container and a fake Inio API (needs Docker)            |
| `npm run test:package`               | Packs the npm package, installs it into a temp project and checks the installed server                         |
| `npm run test:live`                  | Opt-in tests against a real Inio environment: set `INIO_LIVE=1` and the `INIO_*` variables (or a local `.env`) |
| `npm run mutation`                   | Mutation testing (Stryker)                                                                                     |
| `npm run lint` / `npm run typecheck` | oxlint (type-aware) + Prettier / TypeScript 7                                                                  |

## License

[Apache License 2.0](LICENSE). The license covers this source code only. It does not grant access to the Inio API; you need your own Inio API credentials.
