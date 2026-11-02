# VS Code

Three ways to connect VS Code (GitHub Copilot agent mode) to inio-mcp. Pick one:

- **Local (npx):** the server runs on your machine with your Inio API credentials. Needs Node.js 24 or later.
- **Docker:** the same, in a container. Needs Docker.
- **Hosted:** your team runs one server ([hosting guide](../hosting.md)) and gives you a URL and a token. You need no Inio credentials.

Add the configuration to `.vscode/mcp.json` in your workspace, or run **MCP: Open User Configuration** for all workspaces. VS Code prompts for each `${input:...}` value once and stores it securely, so no secret ends up in the file.

## Local (npx)

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

Optional variables (write tools, PII, log level, timeout) are listed in the [README](../../README.md#install); add them to `env`.

## Docker

The image runs the same server as a non-root user, over stdio by default. `-i` keeps stdin open for the MCP protocol, and `--rm` removes the container when the client stops it.

Use the same `inputs` block, and this server entry:

```json
{
  "servers": {
    "inio": {
      "type": "stdio",
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
        "INIO_CLIENT_SECRET": "${input:inio-secret}",
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

## Check it works

Run **MCP: List Servers**: `inio` should be running. In the Chat view, switch to agent mode and open the tools picker to see the inio tools. Then try a question from the [examples](../examples.md).

## Logs and troubleshooting

**MCP: List Servers** → `inio` → **Show Output** shows the server's log. See [Troubleshooting](../../README.md#troubleshooting) for common errors.
