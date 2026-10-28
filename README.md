# inio-mcp

Model Context Protocol (MCP) server for the [Inio](https://inio.com) REST API. Connect AI assistants such as Claude, Cursor or VS Code to your own Inio data: customers, invoices, pauses, retry attempts and payments.

> **Status:** early development. Not yet published to npm. See [docs/PLANNING.md](docs/PLANNING.md).

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

The server is read-only by default.

## License

[Apache License 2.0](LICENSE). The license covers this source code only. It does not grant access to the Inio API; you need your own Inio API credentials.
