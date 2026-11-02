# Hosting a shared server

One server can serve a whole team over Streamable HTTP. It holds the Inio client credentials; team members only get an MCP token and connect with the "Hosted" setup in their [client guide](https://github.com/dnmitev/iniomcp#set-up-your-client).

## Local or hosted?

|                        | Local (npx or Docker per user)          | Hosted (one server for the team) |
| ---------------------- | --------------------------------------- | -------------------------------- |
| Inio credentials       | Every user has the client id and secret | Only the server has them         |
| What users get         | Full credentials                        | One shared MCP token             |
| Settings (writes, PII) | Each user chooses                       | The admin chooses, for everyone  |
| Runs where             | Each user's machine                     | A server or cluster behind TLS   |
| Good for               | One person, trying it out               | A team on one Inio tenant        |

## Run the server

Every request to `/mcp` must send `Authorization: Bearer <MCP_AUTH_TOKEN>`, otherwise it gets 401. Browser requests from origins other than localhost (or `MCP_ALLOWED_ORIGINS`) get 403.

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

## Connect users

Give each user the URL (for example `https://mcp.example.com/mcp`) and the token over a secure channel. The "Hosted" section of each client guide shows the setup: [Claude Desktop](setup/claude-desktop.md#hosted), [Claude Code](setup/claude-code.md#hosted), [VS Code](setup/vscode.md#hosted), [Cursor](setup/cursor.md#hosted).

## Limit what the team can change

Everyone with the token gets the same tools. If the team only needs some writes, register only those and cap payments:

```bash
INIO_ALLOW_WRITES=true
INIO_WRITE_TOOLS=create_customer_pause,update_customer_pause,cancel_customer_pause
# INIO_MAX_PAYMENT_AMOUNT only matters if create_payment is in the list
INIO_MAX_PAYMENT_AMOUNT=500
```

## Security

- Put the server behind a reverse proxy that terminates TLS, and do not expose port 3000 directly. The server has no TLS of its own.
- One server serves one Inio tenant, with that tenant's credentials. Everyone holding the token has the same access, and `INIO_ALLOW_WRITES` and `INIO_REVEAL_PII` apply to all of them.
- The server cannot tell people apart: write calls are logged with the tool, the identifiers changed and the outcome, but not with a person. Over HTTP most clients today also do not identify their app on each request, so the log usually has no client name either (it does in local stdio setups). Inio's audit fields show `inio-mcp` for every write. Keep the team small or give each group its own server and token.
- Requests with a missing or wrong token are logged at `warn` with the connecting address, at most once a minute; the next such line says how many were held back in between. Behind a reverse proxy that address is the proxy's, so use the proxy's access log to find the real client.
- There is one token. To rotate it, change `MCP_AUTH_TOKEN` and restart the server.
- The token is checked before the request body is read; requests without a valid token get 401 and their body is never read. Authenticated requests larger than 256 KiB get 413.
- When `HOST` is not a loopback address (the Docker image uses `0.0.0.0`), the server logs a warning at startup: the token is then the only barrier, so keep the port behind the proxy.
