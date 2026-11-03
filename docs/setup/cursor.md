# Cursor

Three ways to connect Cursor to inio-mcp. Pick one:

- **Local (npx):** the server runs on your machine with your Inio API credentials. Needs Node.js 24 or later.
- **Docker:** the same, in a container. Needs Docker.
- **Hosted:** your team runs one server ([hosting guide](../hosting.md)) and gives you a URL and a token. You need no Inio credentials.

Add the configuration to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project). The file holds secrets in plaintext: keep it readable only by you (`chmod 600`), and never commit a project `.cursor/mcp.json`.

## Local (npx)

```json
{
  "mcpServers": {
    "inio": {
      "command": "npx",
      "args": ["-y", "@dnmitev/inio-mcp@0.6.0"],
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

Optional variables (write tools, PII, log level, timeout) are listed in the [README](../../README.md#install); add them to `env`.

## Docker

The image runs the same server as a non-root user, over stdio by default. `-i` keeps stdin open for the MCP protocol, and `--rm` removes the container when the client stops it.

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
        "ghcr.io/dnmitev/inio-mcp:0.6.0"
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

## Hosted

```json
{
  "mcpServers": {
    "inio": {
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer <token from your admin>" }
    }
  }
}
```

## Check it works

Open **Cursor Settings → MCP**: `inio` should show a green dot and its tools. In the agent chat, try a question from the [examples](../examples.md).

## Logs and troubleshooting

**View → Output**, then pick **MCP Logs** (or the `inio` server) in the dropdown. See [Troubleshooting](../../README.md#troubleshooting) for common errors.
