# Business Story: inio-mcp

## 01-the-problem

**Title:** Inio Data Locked Out of AI Assistants

- Inio clients needed to query customer data, invoices, pauses, and payment details from AI assistants like Claude and Cursor
- No integration existed: accessing Inio data from assistants required writing custom code
- Finance and operations teams couldn't leverage AI tools for their daily Inio workflows
- Every query meant leaving the assistant, opening the Inio interface, and manually finding information

**Sources:** .paul/PROJECT.md (Core Value, Target Users), README.md (opening paragraph)

## 02-who-benefits

**Title:** Finance, Operations, and Developer Teams

- Inio clients' developers gain instant API access through natural language without building integrations
- Finance and operations users can ask about invoices, payments, retry attempts, and customer pauses directly in their AI tools
- Any team with Inio credentials gets immediate read access, with opt-in write operations for advanced users
- Teams work in Claude Desktop, Cursor, Visual Studio Code, or any Model Context Protocol assistant

**Sources:** .paul/PROJECT.md (Target Users, Core Value), CHANGELOG.md [0.1.0], README.md (opening paragraph)

## 03-simple-setup

**Title:** Four Variables, One Command, Done

- Setup requires four environment variables: client ID, client secret, auth URL, and API URL
- Installation is one command: `npx -y @dnmitev/inio-mcp`
- Published as npm package `@dnmitev/inio-mcp` and Docker image `ghcr.io/dnmitev/inio-mcp`
- Works immediately in Claude Desktop, Cursor, and Visual Studio Code with minimal configuration

**Sources:** README.md (Install section), .paul/PROJECT.md (Core Value, What This Is)

## 04-privacy-automatic

**Title:** Privacy Handled for You

- Personal data redacted automatically: IBAN, social security numbers, emails, phone numbers, and addresses stripped before reaching AI providers
- Organizations can opt out of redaction for internal use with one environment flag
- Direct invoice links that bypass login are also redacted to prevent bearer-token leaks
- General Data Protection Regulation compliance built in from day one

**Sources:** .paul/PROJECT.md (Key Decisions, Constraints Compliance Constraints), CHANGELOG.md [0.1.0], CHANGELOG.md [0.4.0], README.md (Data protection section)

## 05-ask-in-plain-language

**Title:** Ask, Don't Search

- Users ask questions in natural language: "Which open invoices does customer C-1001 have?"
- Seven read tools answer questions about customers, invoices, pauses, and retry attempts
- No manual lookups, no context switching between systems, no learning API syntax
- Results come back directly in the conversation, ready to use

**Sources:** README.md (Claude Desktop example, Tools section), .paul/PROJECT.md (Core Value)

## 06-safe-defaults

**Title:** Can't Accidentally Harm

- All 11 write tools are opt-in, disabled unless `INIO_ALLOW_WRITES` environment variable is set to true
- Safe defaults prevent accidental customer contact: credit invoices and resets do not distribute to end customers unless explicitly requested
- Curated payment types exclude risky transaction categories until specifically needed
- Write operations attributed to `inio-mcp` in Inio audit logs for full traceability

**Sources:** .paul/PROJECT.md (Key Decisions, Requirements Core Features), CHANGELOG.md [0.2.0], README.md (Write tools section)

## 07-security-hardening

**Title:** Audit-Driven Improvements

- Independent security audit completed with 29 findings across 7 root causes
- Version 0.4.0 addressed authentication bypass where unauthenticated clients could consume 4 megabytes of memory per request; now rejected before body parsing
- Fixed 8 of 11 write tools that incorrectly reported successful writes as failures
- Request body size capped at 256 kilobytes; malformed requests handled before authentication

**Sources:** .paul/handoffs/archive/HANDOFF-2026-10-30.md (AEGIS audit findings), CHANGELOG.md [0.4.0] Security and Changed sections

## 08-production-ready

**Title:** Distribution Built for Trust

- Tag-driven release pipeline with live validation gate testing against real Inio environments
- npm package published with supply chain provenance through trusted publishing
- Multi-architecture Docker images for AMD64 and ARM64 with Software Bill of Materials attestations
- GitHub Actions automates build and publication to npm registry and GitHub Container Registry

**Sources:** .paul/PROJECT.md (Key Decisions), CHANGELOG.md [0.1.1], README.md (Pinning and verification section)

## 09-team-collaboration

**Title:** Share One Server with Your Team

- Shared HTTP server mode launched in version 0.3.0 for multi-user access
- Bearer token authentication protects all requests with constant-time comparison
- Origin allowlist blocks cross-site attacks, limiting requests to localhost or approved domains
- Graceful shutdown with drain period handles in-flight requests during restarts

**Sources:** CHANGELOG.md [0.3.0], .paul/PROJECT.md (Key Decisions), README.md (Shared HTTP server section)

## 10-whats-next

**Title:** Upcoming Enhancements

- Additional personal data redaction: organization numbers, names for consumer customers, addresses, city, and free-text fields
- Write-tool allowlist and payment ceiling controls to limit blast radius further
- Release-path hardening with SHA-pinned actions and image build provenance
- Move to Inio organization npm scope and company GitHub org when established

**Sources:** .paul/PROJECT.md (Requirements Planned), .paul/ROADMAP.md (Next Milestone candidates), .paul/handoffs/archive/HANDOFF-2026-10-30.md (What's Next)

## 11-current-limits

**Title:** Known Constraints and Upstream Gaps

- Payment reversal unavailable: Inio public API does not expose payment allocation identifiers needed for reversal operations
- Invoice creation deferred: new invoices are sent to end customers immediately, too risky for assistant-driven creation
- Some AI assistants including Claude decline to send social security numbers, requiring back-office workarounds for consumer customer creation
- Upstream API issues documented in Jira: single invoice status filters return HTTP 500, retry-attempt pagination ignored

**Sources:** CHANGELOG.md [0.2.0] Known limitations, .paul/PROJECT.md (Out of Scope, Requirements section), README.md (Write tools section)

## 12-risks-and-mitigations

**Title:** Risk Profile and Controls

- Risk: Personal data exposure to third-party language model providers; mitigation: redaction enabled by default with GDPR-aligned field filtering
- Risk: Write operations with no upstream role controls; mitigation: opt-in flag, safe defaults, destructive annotations, and audit attribution
- Risk: Single maintainer with self-approved releases per finding F-00-002; mitigation: bounded to release control structure only, requires re-confirmation before org transfer
- Risk: Test fixtures drift from real API responses; mitigation: live test suite runs against real environments before every release

**Sources:** .paul/PROJECT.md (Constraints Compliance, Key Decisions), .paul/handoffs/archive/HANDOFF-2026-10-30.md (Owner action pending, D-006), .paul/STATE.md (Blockers/Concerns)

## 13-asks

**Title:** Support Needed

- Re-confirm bounded acceptance of single-maintainer release model before transferring to company GitHub organization
- Establish Inio npm organization (`@inio` scope) for package namespace transition from personal scope `@dnmitev/inio-mcp`
- Report upstream API bugs to Inio API team: invoice status filter issue, retry-attempts pagination, payment allocation lookup
- Consider per-user authentication or MCP OAuth if teams request shared instances with individual credentials

**Sources:** .paul/handoffs/archive/HANDOFF-2026-10-30.md (Owner action pending), .paul/PROJECT.md (Constraints Business Constraints, Requirements Planned), .paul/handoffs/archive/HANDOFF-2026-10-29.md (Outside the code)
