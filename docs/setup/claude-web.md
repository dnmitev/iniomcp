# Claude on the web, Desktop and mobile (connector)

Claude on the web (claude.ai), the Claude Desktop app and the Claude mobile apps share one list of connectors. Add the hosted server once and it is available in all three. You need nothing installed: no Node.js, no Docker and no Inio credentials.

This works when your team's server has [OAuth sign-in](../hosting.md#sign-in-with-oauth) turned on. Ask your admin for:

- the server URL, for example `https://mcp.example.com/mcp`
- the OAuth client ID for Claude, for example `claude`
- your sign-in account (username and how to set your password)

If the server only has a shared token, use [Claude Code](claude-code.md#hosted), [VS Code](vscode.md#hosted), [Cursor](cursor.md#hosted) or [Claude Desktop with mcp-remote](claude-desktop.md#hosted) instead. Personal Claude plans have no field for a fixed token.

## Add the connector

1. In Claude, open **Customize → Connectors** and click **+ Add**, then **Add custom connector**.
2. Enter a name (`Inio`) and the server URL, then continue.
3. Under **Authentication**, keep **Sign in now** (Claude detects it from the server).
4. Under the OAuth client option, choose your own client and enter the client ID from your admin. Leave the client secret empty.
5. Click **Add**, then **Connect**. A sign-in page from your organization opens. Sign in with your account.

On a Team or Enterprise plan, an Owner adds the connector under **Organization settings → Connectors**, and each member clicks **Connect** and signs in.

## Use it

Turn the connector on in a chat from the tools menu, then ask, for example, "show me the open invoices of customer 1042". See [examples](../examples.md) for more.

Claude keeps you signed in and refreshes your access in the background. You sign in again after a long break; how long depends on your organization's settings.

## Check it works

- **Connectors** shows the connector as connected, and its tool list has the read tools (`get_invoice`, `list_invoices`, `list_customers`, …).
- If your admin turned on write tools, those appear too. Claude asks before it runs one.

## Troubleshooting

| Symptom                                                                        | Cause and fix                                                                                                                                                                |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Couldn't reach the MCP server" and no sign-in page                            | The server does not offer OAuth sign-in, or its sign-in metadata is not reachable. Ask your admin to check [OAuth sign-in](../hosting.md#sign-in-with-oauth).                |
| The sign-in page shows "Invalid parameter: redirect_uri" or "Client not found" | The client ID is wrong, or the client does not allow Claude's redirect address. Ask your admin.                                                                              |
| "Authorization with the MCP server failed" after signing in                    | The access token was refused (for example, the wrong audience). Your admin finds the reason in the server log as `unauthorized request` or `token verification unavailable`. |
| It worked, then stopped after some days                                        | Your sign-in expired. Open **Connectors** and connect again.                                                                                                                 |

Every tool call is logged on the server with your user id and username, so your admin can see who did what.
