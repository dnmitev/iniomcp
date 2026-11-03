# Claude Desktop

Three ways to connect Claude Desktop to inio-mcp. Pick one:

- **Local (npx):** the server runs on your machine with your Inio API credentials. Needs Node.js 24 or later.
- **Docker:** the same, in a container. Needs Docker.
- **Hosted:** your team runs one server ([hosting guide](../hosting.md)) and gives you a URL and a token. You need no Inio credentials.

The config file is `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS and `%APPDATA%\Claude\claude_desktop_config.json` on Windows (Settings → Developer → Edit Config opens it). Restart Claude Desktop after every change.

The file holds secrets in plaintext. Keep it readable only by you (`chmod 600` on macOS).

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

Claude Desktop's config file only starts local programs, so it reaches a hosted server through [mcp-remote](https://www.npmjs.com/package/mcp-remote), a small bridge that sends your token with every request. It needs Node.js.

```json
{
  "mcpServers": {
    "inio": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote@0.15.1",
        "https://mcp.example.com/mcp",
        "--header",
        "Authorization:${INIO_MCP_AUTH}"
      ],
      "env": {
        "INIO_MCP_AUTH": "Bearer <token from your admin>"
      }
    }
  }
}
```

The header is written as `Authorization:${INIO_MCP_AUTH}` with no space, and the space after `Bearer` sits in `env`: Claude Desktop on Windows breaks arguments that contain spaces. Keep the mcp-remote version pinned.

## Check it works

Open a new chat and ask: "Which Inio tools do you have?" Claude should list tools such as `get_invoice` and `list_customers`. Then try a question from the [examples](../examples.md).

## Logs and troubleshooting

Logs are in `~/Library/Logs/Claude/mcp-server-inio.log` (macOS) or `%APPDATA%\Claude\logs\mcp-server-inio.log` (Windows). See [Troubleshooting](../../README.md#troubleshooting) for common errors.
