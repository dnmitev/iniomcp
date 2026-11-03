---
phase: 11-helm-chart-and-eks
plan: 02
subsystem: release
tags: [helm, oci, ghcr, release, eks, argocd]

provides:
  - release.yml `chart` job: package and push oci://ghcr.io/dnmitev/charts/inio-mcp, skip if the version exists, read back
  - 0.5.0 released (npm, GHCR image, Helm chart, GitHub Release)
  - Docs test guards chart `--version` and `targetRevision` pins
  - inio-mcp running on the owner's EKS via ArgoCD (ingress-nginx, existingSecret)
affects: [v0.4 Hosted]

key-decisions:
  - "Chart version and appVersion come from the tag; release job waits for the chart job"
  - "Live key-drift check at the gate surfaced 9 invoice and 62 customer keys; reviewed and added to the reviewed lists (userRealName stays visible)"
  - "Live IBAN/redaction checks are customer-type aware (Greptile P1)"

duration: ~2h (including owner checkpoints)
completed: 2026-11-03T09:00:00Z
description: "Chart published from the release workflow, 0.5.0 released everywhere, and deployed to EKS through ArgoCD"
type: Summary
about: "inio-mcp"
---

# Phase 11 Plan 02: Publish, release 0.5.0, deploy to EKS Summary

**The release workflow now publishes the Helm chart to `oci://ghcr.io/dnmitev/charts/inio-mcp`; 0.5.0 shipped to npm, GHCR and GitHub; the team runs it on EKS through ArgoCD on the team's host, and Claude Code connects and lists all 7 read tools.**

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Chart published by the release workflow | Pass | `chart` job (contents: read, packages: write; pinned setup-helm), skip-if-exists, read-back; release job needs it; devops-reviewer APPROVE |
| AC-2: 0.5.0 prepared and guarded | Pass | package.json, lock, Chart.yaml, all pins 0.5.0; docs test covers chart pins; CHANGELOG [0.5.0] - 2026-11-02 |
| AC-3: Released | Pass | npm latest 0.5.0 with provenance; GHCR 0.5.0/0.5/latest sha256:f64c180f…a8529d4 (amd64, arm64), smoke test passed before push; chart 0.5.0 pullable anonymously (public); GitHub Release v0.5.0 latest |
| AC-4: Running on EKS | Pass | Owner deployed with ArgoCD; Claude Code: connected, authenticated, protocol 2026-07-28, 7 tools |

## Verification

| Check | Result |
|-------|--------|
| Local gates (lint, typecheck, test, integration, package) | Green; `npm test` 2083 passed |
| PR #41 CI (incl. chart job, kind smoke) | Green |
| Release run 41446762855 | verify, live, npm, image, chart, release all success |
| `npx -y @dnmitev/inio-mcp@0.5.0` (outside the repo) | Starts, asks for configuration |
| Hosted EKS | `claude mcp` shows inio-http connected, 7 tools |

## Deviations from Plan

1. **Live gate findings fixed before release:** the key-drift check flagged 9 invoice and 62 customer keys from the real API; reviewed and added to `test/response-keys.ts`. Live IBAN checks made customer-type aware (Greptile P1).
2. **Chart visibility:** GHCR created the chart package public; no owner action needed.

### Deferred Items
- `userRealName` is visible for all customer types; redact for consumers if the owner prefers.
- PodDisruptionBudget/topology spread (from 11-01) still open.

## Next Phase Readiness

**Ready:** v0.3 complete. v0.4 Hosted builds on the running EKS deployment.

**Concerns:** Hosted instance uses one static bearer token shared by the team; per-user identity comes with v0.4.

**Blockers:** None

---
*Phase: 11-helm-chart-and-eks, Plan: 02*
*Completed: 2026-11-03*
