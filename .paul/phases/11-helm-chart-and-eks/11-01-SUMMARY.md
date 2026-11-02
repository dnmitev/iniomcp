---
phase: 11-helm-chart-and-eks
plan: 01
subsystem: deploy
tags: [helm, kubernetes, ingress-nginx, gateway-api, kind, kubeconform]

provides:
  - Helm chart charts/inio-mcp (Deployment, Service, optional Ingress, optional HTTPRoute, tests-only Secret, NOTES)
  - CI job `chart`: strict lint, kubeconform x3, render-without-Secret check, kind install + 401/200 smoke
  - docs/hosting.md Kubernetes section (Secret, ESO, ingress-nginx, Gateway API, ArgoCD); chart README
  - Test: Chart.yaml version/appVersion = package.json
affects: [11-02 chart publish and 0.5.0 release]

key-decisions:
  - "runAsUser/runAsGroup 1000: the image's USER is the name 'node', which Kubernetes cannot verify as non-root (found by the kind smoke run)"
  - "Secrets only via secretKeyRef from existingSecret; secret.create for tests only; render fails without either"
  - "MCP_ALLOWED_ORIGINS defaults to https:// + ingress host and HTTPRoute hostnames"
  - "CI pins: setup-helm v5.0.1, kind-action v1.15.1, Helm v4.3.1, kind v0.33.0, kubeconform v0.8.0 (sha256), CRDs-catalog commit 63669a57, smoke image 0.4.0 by digest"
  - "Helm templates excluded from Prettier (Go templates)"

duration: ~1.5h
completed: 2026-11-02T22:30:00Z
description: "Helm chart with Ingress and Gateway API routes, hardened pod, validated in CI and smoke-tested on kind"
type: Summary
about: "inio-mcp"
---

# Phase 11 Plan 01: Helm chart Summary

**`charts/inio-mcp` runs the HTTP server on Kubernetes with two hardened replicas, secrets from an existing Secret, and an ingress-nginx Ingress and/or Gateway API HTTPRoute; CI lints it, validates three variants against Kubernetes and Gateway API schemas, and installs it on kind for a 401/200 smoke test.**

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Chart runs safely | Pass | Non-root uid 1000, read-only root, caps dropped, no privilege escalation, seccomp RuntimeDefault, no SA token; tcpSocket probes; preStop sleep; required inio.* and Secret source |
| AC-2: Ingress + Gateway API | Pass | Both optional, can coexist; HTTPRoute v1 with PathPrefix /mcp and rule timeouts |
| AC-3: Validated in CI | Pass (local), CI on first PR | Locally: strict lint, kubeconform v0.8.0 3/3, kind v0.33.0 install 2/2 Running, 401/200 |
| AC-4: Documented, version-guarded | Pass | hosting.md Kubernetes section; chart README; docs test checks Chart.yaml versions and charts/**/*.md |

## Verification

| Check | Result |
|-------|--------|
| `helm lint --strict` (3 value sets) | Pass |
| kubeconform v0.8.0 strict (Ingress, HTTPRoute, both) | 3/3, 3/3, 5/5 valid |
| kind smoke (local) | 2/2 pods Running; 401 / 200 |
| `npm test` | 2083 passed |
| devops-reviewer | No blockers or majors; 10 minors, 8 applied |

## Deviations from Plan

1. **Bug found by the kind run:** `runAsNonRoot` with the image's non-numeric `USER node` blocked container start; the chart now sets uid/gid 1000.
2. **Review minors applied:** CRDs-catalog pinned to a commit; `helm lint --strict` (Chart.yaml `license` moved to an annotation); failure-diagnostics step; smoke image by digest; Gateway API v1.1 note; Argo CD native-OCI note; NOTES scheme follows TLS.
3. **Not applied:** PodDisruptionBudget/topology spread (deferred); chart publishing (11-02, as planned).

### Deferred Items
- Optional PodDisruptionBudget (`minAvailable: 1`) and topology spread for the 2 replicas.
- Docs pin test does not cover chart `--version` / `targetRevision` values yet (bump to 0.5.0 in 11-02, then extend).

## Next Phase Readiness

**Ready:** 11-02 adds `helm package` + OCI push to release.yml, bumps to 0.5.0, releases, and deploys to EKS via ArgoCD.

**Concerns:** The CI `chart` job and kubeconform v0.8.0 run for the first time on the PR.

**Blockers:** None

---
*Phase: 11-helm-chart-and-eks, Plan: 01*
*Completed: 2026-11-02*
