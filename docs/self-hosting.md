# Self-hosting for Inio clients

You can run inio-mcp yourself, in your own cloud, cluster or agent platform, with your own Inio API credentials. Nothing runs at Inio except the Inio API you already use. Your data goes from the Inio API through your server to the AI assistant you choose.

One server serves one Inio tenant: yours.

## What you need

- **Your Inio API credentials:** the API-to-API client ID and secret your integrations already use, plus the API base URL (ending in `/v1`) and the token URL. They become `INIO_CLIENT_ID`, `INIO_CLIENT_SECRET`, `INIO_URL` and `INIO_AUTH_URL`. A separate client just for the MCP server is a good idea, so you can see and revoke its use on its own. Ask your Inio contact.
- **Network access** from where the server runs to the Inio API gateway and the token URL.
- For a shared server: a hostname with TLS in front of the server.

## Pick how to run it

| Setup                      | Good for                                    | Guide                                                                  |
| -------------------------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| Local, per person (npx)    | Developers trying it in their own assistant | [Client guides](https://github.com/dnmitev/iniomcp#set-up-your-client) |
| Local, per person (Docker) | The same, without installing Node.js        | [Client guides](https://github.com/dnmitev/iniomcp#set-up-your-client) |
| Shared server (Docker)     | A team on one VM or container service       | [Hosting a shared server](hosting.md#run-the-server)                   |
| Shared server (Kubernetes) | A team on Kubernetes, with GitOps           | [Helm chart](hosting.md#kubernetes-helm)                               |

Use the published releases rather than building from source: the npm package `@dnmitev/inio-mcp` (with provenance), the image `ghcr.io/dnmitev/inio-mcp` (amd64 and arm64) and the chart `oci://ghcr.io/dnmitev/charts/inio-mcp`. Pin the version, and for the image the digest ([Pinning and verification](https://github.com/dnmitev/iniomcp#pinning-and-verification)). Building from the repository works too; it is licensed under Apache-2.0.

## Decide how people sign in to a shared server

| Option                       | Works with                                                                                               | Set                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Shared token                 | Claude Code, VS Code, Cursor, Claude Desktop with mcp-remote, agent platforms that send a request header | `MCP_AUTH_TOKEN`                                                      |
| OAuth with your own provider | Claude on the web, Desktop connectors and mobile, plus everything above                                  | `MCP_OAUTH_ISSUER`, `MCP_PUBLIC_URL`, optionally `MCP_OAUTH_AUDIENCE` |

Both can be on at once. With a shared token, everyone who has it has the same access and the logs cannot tell people apart. With OAuth, each person signs in with their own account at your identity provider (for example Microsoft Entra ID, Okta, Google or Keycloak), and every tool call is logged with their user id and username. Follow the [provider checklist](hosting.md#sign-in-with-oauth).

With **Microsoft Entra ID**:

- set `MCP_OAUTH_AUDIENCE` to your app registration's Application ID URI (for example `api://inio-mcp`), not to its client ID;
- register the MCP server URL as an Application ID URI on that app, or Claude's token request fails with `AADSTS9010010`.

## Choose what the assistant may do

The server is read-only and redacts personal data until you change that. Set these once for everyone on the server:

| Setting                   | Default         | Effect                                                                              |
| ------------------------- | --------------- | ----------------------------------------------------------------------------------- |
| `INIO_ALLOW_WRITES`       | `false`         | Registers the write tools (pauses, due dates, credit invoices, payments, customers) |
| `INIO_WRITE_TOOLS`        | all write tools | Only these write tools                                                              |
| `INIO_MAX_PAYMENT_AMOUNT` | no limit        | Largest single payment                                                              |
| `INIO_REVEAL_PII`         | `false`         | Turns redaction off                                                                 |

What is redacted is listed in [Data protection](https://github.com/dnmitev/iniomcp#data-protection): business customers are returned in full except invoice links and SSNs; consumers also have names and addresses hidden. Tool results are sent to the AI provider your assistant uses, so include that provider in your data-protection review.

## Keep it up to date

- Read the [CHANGELOG](https://github.com/dnmitev/iniomcp/blob/main/CHANGELOG.md) before you upgrade, and change the pinned version on purpose.
- Releases are tested against a live Inio environment before they are published.
- Rotate the shared token and your API secret like any other credential. A restart picks up new values.

## Checklist

- [ ] API client ID and secret, API URL and token URL from Inio
- [ ] Server reachable only through TLS; Inio API reachable from the server
- [ ] Shared token, OAuth with your provider, or both
- [ ] Writes, write allowlist, payment limit and redaction decided
- [ ] Version (and image digest) pinned
- [ ] Users have the URL and their client's [setup guide](https://github.com/dnmitev/iniomcp#set-up-your-client)
