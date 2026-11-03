---
phase: 13-deploy-connect-release
plan: 01
subsystem: deploy-docs-release
tags: [helm, oauth, docs, release, self-hosting]

provides:
  - Chart values oauth.issuer / publicUrl / audience / allowUntypedTokens; Ingress and HTTPRoute route /.well-known/oauth-protected-resource
  - docs/hosting.md "Sign-in with OAuth", docs/setup/claude-web.md, docs/self-hosting.md (Inio clients, agent platforms)
  - Strict access-token type check with MCP_OAUTH_ALLOW_UNTYPED_TOKENS opt-in (Entra-style providers)
  - 0.7.0 released (npm, GHCR, chart, GitHub Release)
affects: [next milestone]

key-decisions:
  - "Chart: OAuth-off render unchanged; publicUrl defaults to https://<ingress.host>/mcp; MCP_AUTH_TOKEN key optional with OAuth"
  - "Tokens must be marked as access tokens (header at+jwt or payload typ Bearer); explicit non-access markers always refused; untyped tokens only with MCP_OAUTH_ALLOW_UNTYPED_TOKENS (owner decision, option 2)"
  - "Self-hosting by Inio clients with their own API-to-API credentials and their own identity provider is supported as is"
  - "Docker image budget 210 MB (jose +0.4 MB)"
  - "AC-4 (owner signs in from claude.ai) deferred by the owner: provider config prepared privately, not applied yet"

duration: ~4h (incl. review rounds and owner discussion)
completed: 2026-11-03T17:00:00Z
description: "OAuth sign-in shipped in the chart and docs, strict token-type check with opt-in, self-hosting guide, 0.7.0 released"
type: Summary
about: "inio-mcp"
---

# Phase 13 Plan 01: Deploy, connect, release Summary

**The chart can turn on OAuth sign-in with a few values and routes the sign-in metadata path. The docs cover provider setup generically, the Claude web/Desktop/mobile connector and self-hosting by Inio clients. Access tokens must now be marked as such, with an opt-in for Entra-style providers. 0.7.0 is published everywhere. The owner's sign-in from claude.ai is deferred to the owner's rollout.**

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Chart | Pass | OAuth values and routes; OAuth-off render identical apart from version labels; lint/kubeconform ×3; kind smoke asserts metadata JSON (jq) and the challenge; devops-reviewer APPROVE (minors applied) |
| AC-2: Docs | Pass | Hosting guide OAuth section (settings, provider checklist, troubleshooting, token-type rule), connector guide, self-hosting page; docs test green; no provider-specific details in the repo |
| AC-3: Released | Pass | npm latest 0.7.0 with provenance; GHCR 0.7.0/0.7/latest sha256:d8bb68b5… (amd64, arm64), smoke 200/401/200; chart 0.7.0 pullable; GitHub Release v0.7.0 Latest |
| AC-4: Signed in from Claude | Deferred | The owner chose to close v0.4 before applying the provider config. The rollout steps are recorded in STATE |

## Verification

| Check | Result |
|-------|--------|
| `npm test` | 2329 passed |
| `npm run test:integration` | 54 passed (incl. real Keycloak OAuth tests) |
| Docker package tests | 11 passed on a fresh image (budget 210 MB) |
| PR #47 CI | All jobs green |
| Release run 41674686081 | verify, live, image, npm, chart, release all success |

## Deviations from Plan

1. **Greptile P1 (security), ID tokens accepted when the audience equals the client ID:**
   - Fixed with a token-type check.
   - An outside Cursor agent then pushed a stricter variant that would have rejected Entra-style providers.
   - The owner chose strict by default, with the `MCP_OAUTH_ALLOW_UNTYPED_TOKENS` opt-in (TDD loop).
   - Bots on the repo are now disabled.
2. **Greptile P2:** `secret.create` no longer requires `authToken` with OAuth on.
3. **Added: self-hosting guide for Inio clients**, at the owner's request, plus an agent-platforms table (Azure AI Foundry, TrueFoundry, Amazon Bedrock AgentCore), marked as untested.
4. **Docker image budget** raised from 200 MB to 210 MB.

### Deferred Items
- AC-4 owner sign-in from claude.ai on the hosted instance (owner rollout).
- Tenant check (e.g. `MCP_OAUTH_REQUIRED_CLAIM`) before Inio hosts instances for external clients.
- Agent platforms untested; AgentCore Authorization header pass-through open.
- Malformed tokens trigger a (cached, throttled) discovery fetch before rejection.
- Token claims email/name from the provider; preferred_username logged.

## Next Phase Readiness

**Ready:** v0.4 complete. Next milestone candidates in ROADMAP.

**Blockers:** None

---
*Phase: 13-deploy-connect-release, Plan: 01*
*Completed: 2026-11-03*
