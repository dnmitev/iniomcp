# Business Story: inio-mcp

## 01-the-problem

**Title:** Inio Data Locked Out of AI Assistants

- Inio clients needed to query customer data, invoices, pauses, and payment details from AI assistants like Claude and Cursor
- No integration existed: accessing Inio data from assistants required writing custom code
- Finance and operations teams couldn't leverage AI tools for their daily Inio workflows
- Business users were blocked from AI-assisted analysis of customer accounts and payment histories

**Sources:** .paul/PROJECT.md (Core Value, Target Users)

## 02-who-benefits

**Title:** Finance, Operations, and Developer Teams

- Inio clients' developers gain instant API access through natural language without building integrations
- Finance and operations users can ask about invoices, payments, retry attempts, and customer pauses directly in their AI tools
- Any team with Inio credentials gets immediate read access, with opt-in write operations for advanced users
- Teams work in Claude Desktop, Cursor, Visual Studio Code, or any Model Context Protocol assistant

**Sources:** .paul/PROJECT.md (Target Users, Core Value), CHANGELOG.md [0.1.0], .paul/PROJECT.md (Requirements)

## 03-what-shipped

**Title:** Four Environment Variables and One Command

- Published npm package `@dnmitev/inio-mcp` and Docker image `ghcr.io/dnmitev/inio-mcp`
- Setup takes four environment variables: client ID, client secret, auth URL, and API URL
- Installation is one command: `npx -y @dnmitev/inio-mcp`
- Ships with 7 read tools and 11 opt-in write tools for 18 operations total

**Sources:** .paul/PROJECT.md (Core Value, What This Is, Current State table), CHANGELOG.md [0.1.0] and [0.2.0]

## 04-data-protection-built-in

**Title:** Privacy by Default

- Personal data redacted automatically: IBAN, social security numbers, emails, phone numbers, and addresses stripped before reaching AI providers
- Organizations can opt out of redaction for internal use with one flag
- Direct invoice links that bypass login are also redacted to prevent bearer-token leaks
- General Data Protection Regulation compliance from day one for third-party language model providers

**Sources:** .paul/PROJECT.md (Key Decisions, Constraints Compliance Constraints), CHANGELOG.md [0.1.0], CHANGELOG.md [0.4.0]

## 05-seven-tools-in-three-days

**Title:** Rapid Delivery Through Agent-Driven Development

- Built from empty repository to public release in 3 days between October 28 and October 30 2026
- Delivered 7 read tools across customers, invoices, pauses, and retry attempts in the initial milestone
- Added 11 write tools for updating customers, managing pauses, adjusting invoices, and recording payments in milestone two
- Test-driven development with 1895 unit tests, 47 integration tests, and mutation testing above 91 percent on every changed file

**Sources:** .paul/MILESTONES.md (v0.1 Duration, Stats), .paul/PROJECT.md (Success Metrics table), .paul/MILESTONES.md (v0.2 Stats)

## 06-release-automation

**Title:** Production-Ready Distribution

- Tag-driven release pipeline with live validation gate testing against real Inio environments
- npm package published with supply chain provenance through trusted publishing
- Multi-architecture Docker images for AMD64 and ARM64 with Software Bill of Materials attestations
- GitHub Actions automates build, test, mutation gates, and publication to npm registry and GitHub Container Registry

**Sources:** .paul/PROJECT.md (Key Decisions), CHANGELOG.md [0.1.1], .paul/MILESTONES.md (v0.1 Key Accomplishments)

## 07-shared-http-mode

**Title:** Team Collaboration Ready

- Shared HTTP server mode launched in version 0.3.0 for multi-user access
- Bearer token authentication protects all requests with constant-time comparison
- Origin allowlist blocks cross-site attacks, limiting requests to localhost or approved domains
- Graceful shutdown with drain period handles in-flight requests during restarts

**Sources:** CHANGELOG.md [0.3.0], .paul/PROJECT.md (Key Decisions), .paul/MILESTONES.md (v0.1 Key Accomplishments)

## 08-security-hardening

**Title:** Audit-Driven Improvements

- Independent security audit completed with 29 findings across 7 root causes
- Version 0.4.0 addressed authentication bypass where unauthenticated clients could consume 4 megabytes of memory per request; now rejected before body parsing
- Fixed 8 of 11 write tools that incorrectly reported successful writes as failures
- Request body size capped at 256 kilobytes; malformed requests handled before authentication

**Sources:** .paul/handoffs/archive/HANDOFF-2026-10-30.md (AEGIS audit findings), CHANGELOG.md [0.4.0] Security and Changed sections

## 09-safe-write-defaults

**Title:** Money and Customer Contact Protection

- All 11 write tools are opt-in, disabled unless `INIO_ALLOW_WRITES` environment variable is set to true
- Safe defaults prevent accidental customer contact: credit invoices and resets do not distribute to end customers unless explicitly requested
- Curated payment types exclude risky transaction categories until specifically needed
- Write operations attributed to `inio-mcp` in Inio audit logs for full traceability

**Sources:** .paul/PROJECT.md (Key Decisions, Requirements Core Features), CHANGELOG.md [0.2.0], .paul/MILESTONES.md (v0.1 Key Accomplishments)

## 10-token-efficiency

**Title:** Designed for Context Budget

- Invoice list items compressed from 9 kilobytes raw to approximately 72 tokens through curated summary fields
- Detail responses compacted by dropping empty values before redaction
- Large workflow settings are opt-in to conserve context when stage distribution details aren't needed
- Text-only results with JSON logs to stderr maximize token budget for actual data

**Sources:** .paul/PROJECT.md (Key Decisions)

## 11-whats-next

**Title:** Upcoming Enhancements

- Additional personal data redaction: organization numbers, names for consumer customers, addresses, city, and free-text fields
- Write-tool allowlist and payment ceiling controls to limit blast radius further
- Release-path hardening with SHA-pinned actions and image build provenance
- Move to Inio organization npm scope and company GitHub org when established

**Sources:** .paul/PROJECT.md (Requirements Planned), .paul/ROADMAP.md (Next Milestone candidates), .paul/handoffs/archive/HANDOFF-2026-10-30.md (What's Next)

## 12-current-limits

**Title:** Known Constraints and Upstream Gaps

- Payment reversal unavailable: Inio public API does not expose payment allocation identifiers needed for reversal operations
- Invoice creation deferred: new invoices are sent to end customers immediately, too risky for assistant-driven creation
- Some AI assistants including Claude decline to send social security numbers, requiring back-office workarounds for consumer customer creation
- Upstream API issues documented in Jira: single invoice status filters return HTTP 500, retry-attempt pagination ignored

**Sources:** CHANGELOG.md [0.2.0] Known limitations, .paul/PROJECT.md (Out of Scope, Requirements section), .paul/handoffs/archive/HANDOFF-2026-10-29.md (Outside the code)

## 13-risks-and-mitigations

**Title:** Risk Profile and Controls

- Risk: Personal data exposure to third-party language model providers; mitigation: redaction enabled by default with GDPR-aligned field filtering
- Risk: Write operations with no upstream role controls; mitigation: opt-in flag, safe defaults, destructive annotations, and audit attribution
- Risk: Single maintainer with self-approved releases per finding F-00-002; mitigation: bounded to release control structure only, requires re-confirmation before org transfer
- Risk: Test fixtures drift from real API responses; mitigation: live test suite runs against real environments before every release

**Sources:** .paul/PROJECT.md (Constraints Compliance, Key Decisions), .paul/handoffs/archive/HANDOFF-2026-10-30.md (Owner action pending, D-006), .paul/STATE.md (Blockers/Concerns)

## 14-asks

**Title:** Support Needed

- Re-confirm bounded acceptance of single-maintainer release model before transferring to company GitHub organization
- Establish Inio npm organization (`@inio` scope) for package namespace transition from personal scope `@dnmitev/inio-mcp`
- Report upstream API bugs to Inio API team: invoice status filter issue, retry-attempts pagination, payment allocation lookup
- Consider per-user authentication or MCP OAuth if teams request shared instances with individual credentials

**Sources:** .paul/handoffs/archive/HANDOFF-2026-10-30.md (Owner action pending), .paul/PROJECT.md (Constraints Business Constraints, Requirements Planned), .paul/handoffs/archive/HANDOFF-2026-10-29.md (Outside the code)
