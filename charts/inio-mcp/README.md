# inio-mcp Helm chart

Runs [inio-mcp](https://github.com/dnmitev/iniomcp) as a shared Streamable HTTP server. Setup, Secret, ingress-nginx, Gateway API and ArgoCD examples: [hosting guide](https://github.com/dnmitev/iniomcp/blob/main/docs/hosting.md#kubernetes-helm).

```bash
helm install inio-mcp oci://ghcr.io/dnmitev/charts/inio-mcp --version 0.5.0 -f values.yaml
```

| Value                                                                                 | Default                                 | Purpose                                                                                                  |
| ------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `inio.url`, `inio.authUrl`, `inio.clientId`                                           | (required)                              | Inio API base URL incl. `/v1`, token endpoint, API client id                                             |
| `existingSecret`                                                                      |                                         | Secret with `INIO_CLIENT_SECRET` and `MCP_AUTH_TOKEN` (required unless `secret.create`)                  |
| `secret.create`, `secret.clientSecret`, `secret.authToken`                            | `false`                                 | Let the chart create the Secret; for tests only                                                          |
| `inio.allowWrites`                                                                    | `false`                                 | Register write tools (`INIO_ALLOW_WRITES`)                                                               |
| `inio.writeTools`                                                                     | `[]`                                    | Only these write tools (`INIO_WRITE_TOOLS`)                                                              |
| `inio.maxPaymentAmount`                                                               |                                         | Largest single payment (`INIO_MAX_PAYMENT_AMOUNT`)                                                       |
| `inio.revealPii`                                                                      | `false`                                 | Turn redaction off (`INIO_REVEAL_PII`)                                                                   |
| `inio.logLevel`, `inio.requestTimeoutMs`                                              |                                         | `INIO_LOG_LEVEL`, `INIO_REQUEST_TIMEOUT_MS`                                                              |
| `allowedOrigins`                                                                      | `https://` + configured hosts           | `MCP_ALLOWED_ORIGINS`                                                                                    |
| `image.repository`, `image.tag`, `image.digest`                                       | `ghcr.io/dnmitev/inio-mcp`, appVersion, | Image; a digest wins over the tag                                                                        |
| `replicaCount`                                                                        | `2`                                     | Replicas (the server keeps no session state)                                                             |
| `podDisruptionBudget.enabled`, `maxUnavailable`                                       | `true`, `1`                             | PodDisruptionBudget; evicts one pod at a time, never blocks a drain                                      |
| `autoscaling.enabled`, `minReplicas`, `maxReplicas`, `targetCPUUtilizationPercentage` | `false`, `2`, `5`, `70`                 | CPU HorizontalPodAutoscaler (needs metrics-server and `resources.requests.cpu`); replaces `replicaCount` |
| `service.port`                                                                        | `3000`                                  | Service port                                                                                             |
| `ingress.enabled`, `className`, `host`, `tls.secretName`, `annotations`               | `false`, `nginx`                        | Ingress for `/mcp`                                                                                       |
| `httpRoute.enabled`, `parentRefs`, `hostnames`, `timeouts`, `annotations`             | `false`                                 | Gateway API HTTPRoute for `/mcp`                                                                         |
| `preStopSleepSeconds`                                                                 | `5`                                     | Delay before SIGTERM so the proxy drains first                                                           |
| `terminationGracePeriodSeconds`                                                       | `30`                                    | Pod termination grace                                                                                    |
| `resources`                                                                           | 50m / 96Mi request, 256Mi limit         | Container resources                                                                                      |
| `podAnnotations`, `nodeSelector`, `tolerations`, `affinity`                           |                                         | Scheduling and annotations                                                                               |

The pod runs as user 1000 with a read-only root filesystem, all capabilities dropped and `automountServiceAccountToken: false`. Probes check the TCP port (the server has no unauthenticated health endpoint).
