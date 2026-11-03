# Claude Code

Three ways to connect Claude Code to inio-mcp. Pick one:

- **Local (npx):** the server runs on your machine with your Inio API credentials. Needs Node.js 24 or later.
- **Docker:** the same, in a container. Needs Docker.
- **Hosted:** your team runs one server ([hosting guide](../hosting.md)) and gives you a URL and a token. You need no Inio credentials.

`claude mcp add` stores the server in your local project settings by default. Add `--scope user` to use it in every project, or `--scope project` to share it through `.mcp.json` (never with secrets in it).

## Local (npx)

Read the secret without echoing it, so it stays out of your shell history:

```bash
read -rs INIO_CLIENT_SECRET   # paste your Inio API client secret
claude mcp add inio \
  -e INIO_CLIENT_ID=your-client-id \
  -e INIO_CLIENT_SECRET="$INIO_CLIENT_SECRET" \
  -e INIO_AUTH_URL=https://<your-keycloak>/realms/<realm>/protocol/openid-connect/token \
  -e INIO_URL=https://<your-inio-api-gateway>/v1 \
  -- npx -y @dnmitev/inio-mcp@0.6.0
```

Claude Code saves the values in its settings file (`~/.claude.json`), in plaintext. Optional variables (write tools, PII, log level, timeout) are listed in the [README](../../README.md#install); add them with more `-e` flags.

## Docker

The image runs the same server as a non-root user, over stdio by default. `-i` keeps stdin open for the MCP protocol, and `--rm` removes the container when the client stops it.

```bash
read -rs INIO_CLIENT_SECRET
claude mcp add inio \
  -e INIO_CLIENT_ID=your-client-id \
  -e INIO_CLIENT_SECRET="$INIO_CLIENT_SECRET" \
  -e INIO_AUTH_URL=https://<your-keycloak>/realms/<realm>/protocol/openid-connect/token \
  -e INIO_URL=https://<your-inio-api-gateway>/v1 \
  -- docker run -i --rm -e INIO_CLIENT_ID -e INIO_CLIENT_SECRET -e INIO_AUTH_URL -e INIO_URL \
  ghcr.io/dnmitev/inio-mcp:0.6.0
```

## Hosted

```bash
read -rs INIO_MCP_TOKEN   # paste the token your admin gave you
claude mcp add --transport http inio https://mcp.example.com/mcp \
  --header "Authorization: Bearer $INIO_MCP_TOKEN"
```

## Check it works

Run `claude mcp list`: `inio` should show as connected. In a session, `/mcp` shows the server and its tools. Then try a question from the [examples](../examples.md).

## Logs and troubleshooting

`claude --debug` shows MCP startup errors, including the server's stderr. See [Troubleshooting](../../README.md#troubleshooting) for common errors.
