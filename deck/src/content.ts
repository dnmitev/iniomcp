export interface SlideContent {
  id: string;
  slug: string;
  title: string;
  bullets?: string[];
  sources?: string;
}

export const slides: SlideContent[] = [
  {
    id: '01',
    slug: 'the-problem',
    title: 'Inio Data Locked Out of AI Assistants',
    bullets: [
      'Inio clients needed to query customer data, invoices, pauses, and payment details from AI assistants like Claude and Cursor',
      'No integration existed: accessing Inio data from assistants required writing custom code',
      'Finance and operations teams couldn\'t leverage AI tools for their daily Inio workflows',
      'Every query meant leaving the assistant, opening the Inio interface, and manually finding information',
    ],
    sources: '.paul/PROJECT.md (Core Value, Target Users), README.md (opening paragraph)',
  },
  {
    id: '02',
    slug: 'who-benefits',
    title: 'Finance, Operations, and Developer Teams',
    bullets: [
      'Inio clients\' developers gain instant API access through natural language without building integrations',
      'Finance and operations users can ask about invoices, payments, retry attempts, and customer pauses directly in their AI tools',
      'Any team with Inio credentials gets immediate read access, with opt-in write operations for advanced users',
      'Teams work in Claude Desktop, Cursor, Visual Studio Code, or any Model Context Protocol assistant',
    ],
    sources: '.paul/PROJECT.md (Target Users, Core Value), CHANGELOG.md [0.1.0], README.md (opening paragraph)',
  },
  {
    id: '03',
    slug: 'simple-setup',
    title: 'Four Variables, One Command, Done',
    bullets: [
      'Setup requires four environment variables: client ID, client secret, auth URL, and API URL',
      'Installation is one command: npx -y @dnmitev/inio-mcp',
      'Published as npm package @dnmitev/inio-mcp and Docker image ghcr.io/dnmitev/inio-mcp',
      'Works immediately in Claude Desktop, Cursor, and Visual Studio Code with minimal configuration',
    ],
    sources: 'README.md (Install section), .paul/PROJECT.md (Core Value, What This Is)',
  },
  {
    id: '04',
    slug: 'privacy-automatic',
    title: 'Privacy Handled for You',
    bullets: [
      'Personal data redacted automatically: IBAN, social security numbers, emails, phone numbers, and addresses stripped before reaching AI providers',
      'Organizations can opt out of redaction for internal use with one environment flag',
      'Direct invoice links that bypass login are also redacted to prevent bearer-token leaks',
      'General Data Protection Regulation compliance built in from day one',
    ],
    sources: '.paul/PROJECT.md (Key Decisions, Constraints Compliance Constraints), CHANGELOG.md [0.1.0], CHANGELOG.md [0.4.0], README.md (Data protection section)',
  },
  {
    id: '05',
    slug: 'ask-in-plain-language',
    title: 'Ask, Don\'t Search',
    bullets: [
      'Users ask questions in natural language: "Which open invoices does customer C-1001 have?"',
      'Seven read tools answer questions about customers, invoices, pauses, and retry attempts',
      'No manual lookups, no context switching between systems, no learning API syntax',
      'Results come back directly in the conversation, ready to use',
    ],
    sources: 'README.md (Claude Desktop example, Tools section), .paul/PROJECT.md (Core Value)',
  },
  {
    id: '06',
    slug: 'safe-defaults',
    title: 'Can\'t Accidentally Harm',
    bullets: [
      'All 11 write tools are opt-in, disabled unless INIO_ALLOW_WRITES environment variable is set to true',
      'Safe defaults prevent accidental customer contact: credit invoices and resets do not distribute to end customers unless explicitly requested',
      'Curated payment types exclude risky transaction categories until specifically needed',
      'Write operations attributed to inio-mcp in Inio audit logs for full traceability',
    ],
    sources: '.paul/PROJECT.md (Key Decisions, Requirements Core Features), CHANGELOG.md [0.2.0], README.md (Write tools section)',
  },
  {
    id: '07',
    slug: 'built-for-trust',
    title: 'Audited, Verified, and Team-Ready',
    bullets: [
      'Independent security audit with 29 findings completed and fixed: authentication strengthened, write operations report correctly, and malicious requests are rejected early',
      'Every release tested against real Inio environments and published with verification records so you can confirm what you\'re installing',
      'Teams can share one secured server setup instead of each person configuring their own credentials',
    ],
    sources: '.paul/handoffs/archive/HANDOFF-2026-10-30.md (AEGIS audit findings), CHANGELOG.md [0.4.0] Security and Changed sections, .paul/PROJECT.md (Key Decisions), CHANGELOG.md [0.1.1], README.md (Pinning and verification section, Shared HTTP server section), CHANGELOG.md [0.3.0]',
  },
  {
    id: '08',
    slug: 'whats-next',
    title: 'Upcoming Enhancements',
    bullets: [
      'Additional personal data redaction: organization numbers, names for consumer customers, addresses, city, and free-text fields',
      'Write-tool allowlist and payment ceiling controls to limit blast radius further',
      'Release-path hardening with SHA-pinned actions and image build provenance',
      'Move to Inio organization npm scope and company GitHub org when established',
    ],
    sources: '.paul/PROJECT.md (Requirements Planned), .paul/ROADMAP.md (Next Milestone candidates), .paul/handoffs/archive/HANDOFF-2026-10-30.md (What\'s Next)',
  },
  {
    id: '09',
    slug: 'current-limits',
    title: 'Known Constraints and Upstream Gaps',
    bullets: [
      'Payment reversal unavailable: Inio public API does not expose payment allocation identifiers needed for reversal operations',
      'Invoice creation deferred: new invoices are sent to end customers immediately, too risky for assistant-driven creation',
      'Some AI assistants including Claude decline to send social security numbers, requiring back-office workarounds for consumer customer creation',
      'Upstream API issues documented in Jira: single invoice status filters return HTTP 500, retry-attempt pagination ignored',
    ],
    sources: 'CHANGELOG.md [0.2.0] Known limitations, .paul/PROJECT.md (Out of Scope, Requirements section), README.md (Write tools section)',
  },
  {
    id: '10',
    slug: 'risks-and-mitigations',
    title: 'Risk Profile and Controls',
    bullets: [
      'Risk: Personal data exposure to third-party language model providers; mitigation: redaction enabled by default with GDPR-aligned field filtering',
      'Risk: Write operations with no upstream role controls; mitigation: opt-in flag, safe defaults, destructive annotations, and audit attribution',
      'Risk: Single maintainer with self-approved releases per finding F-00-002; mitigation: bounded to release control structure only, requires re-confirmation before org transfer',
      'Risk: Test fixtures drift from real API responses; mitigation: live test suite runs against real environments before every release',
    ],
    sources: '.paul/PROJECT.md (Constraints Compliance, Key Decisions), .paul/handoffs/archive/HANDOFF-2026-10-30.md (Owner action pending, D-006), .paul/STATE.md (Blockers/Concerns)',
  },
  {
    id: '11',
    slug: 'asks',
    title: 'Support Needed',
    bullets: [
      'Re-confirm bounded acceptance of single-maintainer release model before transferring to company GitHub organization',
      'Establish Inio npm organization (@inio scope) for package namespace transition from personal scope @dnmitev/inio-mcp',
      'Report upstream API bugs to Inio API team: invoice status filter issue, retry-attempts pagination, payment allocation lookup',
      'Consider per-user authentication or MCP OAuth if teams request shared instances with individual credentials',
    ],
    sources: '.paul/handoffs/archive/HANDOFF-2026-10-30.md (Owner action pending), .paul/PROJECT.md (Constraints Business Constraints, Requirements Planned), .paul/handoffs/archive/HANDOFF-2026-10-29.md (Outside the code)',
  },
];
