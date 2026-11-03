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

Every request to `/mcp` must send `Authorization: Bearer <MCP_AUTH_TOKEN>`, otherwise it gets 401. Browser requests from origins other than localhost (or `MCP_ALLOWED_ORIGINS`) get 403. `GET /healthz` needs no token and returns `ok` for load balancer and Kubernetes probes; it never calls the Inio API. Every other path gets 404.

Start it with npx:

```bash
export MCP_AUTH_TOKEN=$(openssl rand -hex 32)   # share this with your team
MCP_TRANSPORT=http npx -y @dnmitev/inio-mcp@0.5.0   # plus the four INIO_* variables
```

Or with Docker (the image listens on `0.0.0.0:3000` in HTTP mode and stops cleanly on `docker stop`):

```bash
docker run -d --name inio-mcp -p 127.0.0.1:3000:3000 \
  -e MCP_TRANSPORT=http -e MCP_AUTH_TOKEN \
  -e INIO_CLIENT_ID -e INIO_CLIENT_SECRET -e INIO_AUTH_URL -e INIO_URL \
  ghcr.io/dnmitev/inio-mcp:0.5.0
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

## Kubernetes (Helm)

The chart in [`charts/inio-mcp`](../charts/inio-mcp/README.md) runs the server in HTTP mode with two replicas and a PodDisruptionBudget (optional CPU autoscaling), a read-only root filesystem, no Linux capabilities and a numeric non-root user. It is published as an OCI chart:

```bash
helm install inio-mcp oci://ghcr.io/dnmitev/charts/inio-mcp --version 0.5.0 -f values.yaml
```

### Secret

The chart reads `INIO_CLIENT_SECRET` and `MCP_AUTH_TOKEN` from an existing Secret. Create it by hand:

```bash
kubectl create secret generic inio-mcp \
  --from-literal=INIO_CLIENT_SECRET='<client secret>' \
  --from-literal=MCP_AUTH_TOKEN="$(openssl rand -hex 32)"
```

Or with External Secrets Operator, producing the same Secret name:

```yaml
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: inio-mcp
spec:
  secretStoreRef: { name: aws-secrets-manager, kind: ClusterSecretStore }
  target: { name: inio-mcp }
  data:
    - secretKey: INIO_CLIENT_SECRET
      remoteRef: { key: inio-mcp, property: client_secret }
    - secretKey: MCP_AUTH_TOKEN
      remoteRef: { key: inio-mcp, property: mcp_auth_token }
```

The chart does not own the Secret, so changing it does not restart the pods. Restart them (`kubectl rollout restart deploy/inio-mcp`) or use a tool such as Reloader.

### Values

With ingress-nginx:

```yaml
existingSecret: inio-mcp
inio:
  url: https://<your-inio-api-gateway>/v1
  authUrl: https://<your-keycloak>/realms/<realm>/protocol/openid-connect/token
  clientId: your-client-id
ingress:
  enabled: true
  className: nginx
  host: mcp.example.com
  tls:
    secretName: mcp-example-com-tls
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: 256k
    nginx.ingress.kubernetes.io/proxy-read-timeout: '120'
    nginx.ingress.kubernetes.io/proxy-send-timeout: '120'
    nginx.ingress.kubernetes.io/proxy-buffering: 'off'
```

With Gateway API instead (or as well, during a migration; both point at the same Service):

```yaml
httpRoute:
  enabled: true
  parentRefs:
    - name: shared-gateway
      namespace: gateway-system
      sectionName: https
  hostnames: [mcp.example.com]
  timeouts:
    request: 120s
```

TLS ends at the Gateway listener. Route `timeouts` need Gateway API v1.1 or later CRDs; leave them out on older gateways. Gateway API has no standard field for body size or buffering; the server already caps bodies at 256 KiB and streams responses. `MCP_ALLOWED_ORIGINS` defaults to `https://` plus the configured hosts. Write tools, the allowlist and the payment limit are under `inio` (see the [chart README](../charts/inio-mcp/README.md)).

### ArgoCD

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: inio-mcp
  namespace: argocd
spec:
  project: default
  source:
    repoURL: ghcr.io/dnmitev/charts
    chart: inio-mcp
    targetRevision: 0.5.0
    helm:
      valuesObject:
        existingSecret: inio-mcp
        # … the values above
  destination:
    server: https://kubernetes.default.svc
    namespace: inio-mcp
  syncPolicy:
    syncOptions: [CreateNamespace=true]
```

An OCI Helm source needs a repository entry in ArgoCD with `enableOCI: true` for `ghcr.io/dnmitev/charts` (the package is public, so no credentials). To upgrade, change `targetRevision`. On Argo CD 3.1 or later you can instead use native OCI: `repoURL: oci://ghcr.io/dnmitev/charts/inio-mcp` and no `chart` field.

## Security

- Put the server behind a reverse proxy that terminates TLS, and do not expose port 3000 directly. The server has no TLS of its own.
- One server serves one Inio tenant, with that tenant's credentials. Everyone holding the token has the same access, and `INIO_ALLOW_WRITES` and `INIO_REVEAL_PII` apply to all of them.
- The server cannot tell people apart: write calls are logged with the tool, the identifiers changed and the outcome, but not with a person. Over HTTP most clients today also do not identify their app on each request, so the log usually has no client name either (it does in local stdio setups). Inio's audit fields show `inio-mcp` for every write. Keep the team small or give each group its own server and token.
- Requests with a missing or wrong token are logged at `warn` with the connecting address, at most once a minute; the next such line says how many were held back in between. Behind a reverse proxy that address is the proxy's, so use the proxy's access log to find the real client.
- There is one token. To rotate it, change `MCP_AUTH_TOKEN` and restart the server.
- The token is checked before the request body is read; requests without a valid token get 401 and their body is never read. Authenticated requests larger than 256 KiB get 413.
- When `HOST` is not a loopback address (the Docker image uses `0.0.0.0`), the server logs a warning at startup: the token is then the only barrier, so keep the port behind the proxy.
