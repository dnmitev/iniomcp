---
phase: 01-foundation
plan: 01
subsystem: infra
tags: [typescript-7, npm, vitest, stryker, oxlint, github-actions, claude-code-agents]

requires: []
provides:
  - Toolchain (npm, TypeScript 7 ESM, Vitest, StrykerJS, oxlint, Prettier) with tsc build to dist/
  - GitHub Actions CI gating lint, typecheck, unit tests, mutation (break 80), build
  - TDD agent team (.claude/agents/*) and /tdd command
  - src/config.ts — validated env config (loadConfig)
affects: [01-02 auth and get_invoice, 01-03 integration tests, phase 3 packaging]

tech-stack:
  added: [typescript@7, vitest@5, "@stryker-mutator/core@10", "@stryker-mutator/vitest-runner@10", oxlint, oxlint-tsgolint, prettier]
  patterns:
    - Node 24 runs src/*.ts directly (type stripping); tsc emits dist/ only for publishing
    - Relative imports use the .ts extension (rewriteRelativeImportExtensions)
    - Inject env/inputs instead of reading globals
    - Errors name variables, never values (no secret leakage)

key-files:
  created: [src/config.ts, test/unit/config.test.ts, stryker.config.mjs, .oxlintrc.json, .github/workflows/ci.yml, tsconfig.json, tsconfig.build.json, .claude/agents/*.md, .claude/commands/tdd.md]
  modified: [README.md, docs/PLANNING.md, .gitignore]

key-decisions:
  - "Vitest instead of Jest (ESM-native)"
  - "TypeScript 7 + npm + plain tsc; no Yarn, no tsup"
  - "oxlint --type-aware instead of ESLint (typescript-eslint has no TS 7 support)"
  - "Stryker without TypeScript checker; tsconfigFile '' skips its TS-API tsconfig rewrite"

patterns-established:
  - "TDD loop: QA (test/ only) → developer (src/ only) → reviewer (read-only) → mutation-tester (read-only, adversarial)"
  - "Mutation target 90 on changed files, CI break 80"

duration: ~3h
started: 2026-10-28T09:45:00Z
completed: 2026-10-28T12:00:00Z
description: "TypeScript 7/npm/Vitest/Stryker/oxlint toolchain with green CI, four-agent TDD team, and env config module at 100% mutation score"
type: Summary
about: "inio-mcp"
---

# Phase 1 Plan 01: Foundation Summary

**TypeScript 7 / npm / Vitest / Stryker / oxlint toolchain with green GitHub Actions CI, a four-agent TDD team with `/tdd`, and `src/config.ts` (80 tests, 100% mutation score) built through two full TDD rounds.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~3h (incl. mid-plan toolchain switch) |
| Started | 2026-10-28T09:45:00Z |
| Completed | 2026-10-28T12:00:00Z |
| Tasks | 3 of 3 completed (+1 decision checkpoint) |
| Files changed | 27 |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Toolchain runs clean | Pass | Fresh `npm ci` + lint, typecheck, test, build all exit 0 (local and in a reviewer's scratch clone). Commands are npm, not Yarn (deviation 2). |
| AC-2: Config validation | Pass | 80 tests: required vars, one aggregated error, https-only except localhost (incl. non-http schemes on localhost), token URL normalisation (incl. `/token/` and `///`), strict flags, transport, secret never in errors. |
| AC-3: Mutation gate | Pass | `npm run mutation`: 100.00% (85/85 killed, 0 survived); break threshold 80 enforced. |
| AC-4: CI gates every PR | Pass | PR #1 `check` job green (24s): lint, typecheck, test, mutation, build. `permissions: contents: read`, no secrets. |
| AC-5: TDD agent team end to end | Pass | Round 1: QA red (68 tests) → developer green → reviewer APPROVE (3 minors) → mutation 91.8 (5 survivors). Round 2: QA killing tests + new spec (red) → developer green → mutation 100 + reviewer blocker fixed. Agents stayed in lanes. |

## Accomplishments

- Mutation testing found a real security gap in round 1: a non-http scheme on a local host (`ws://localhost`) passed URL validation. Now pinned by tests.
- Reviewer found the `/token/` trailing-slash bug and that Stryker crashes under TypeScript 7 before CI ever ran.
- Toolchain is dependency-light: no bundler, no Yarn; Node runs TypeScript directly in development.

## Task Commits

| Task | Commit | Type | Description |
|------|--------|------|-------------|
| Tasks 1–3 (single commit) | `a0cc184` | feat | Toolchain, CI, agent team, config module |

PR: https://github.com/dnmitev/iniomcp/pull/1

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `package.json`, `package-lock.json` | Created | npm scripts (dev, lint, typecheck, test, mutation, build, prepack), deps |
| `tsconfig.json`, `tsconfig.build.json` | Created | TS 7 strict NodeNext, erasable syntax, `.ts` import rewriting; build src→dist |
| `.oxlintrc.json` | Created | Type-aware lint (correctness + suspicious, promise rules) |
| `vitest.config.ts`, `stryker.config.mjs` | Created | Unit tests; mutation thresholds 90/80/80, incremental |
| `.github/workflows/ci.yml` | Created | PR/main gate |
| `.claude/agents/*.md`, `.claude/commands/tdd.md` | Created | TDD agent team and loop |
| `src/config.ts` (71 lines) | Created | `loadConfig(env)` |
| `test/unit/config.test.ts` (314 lines) | Created | 80 tests |
| `src/index.ts` | Created | Entry stub with shebang (server in 01-02) |
| `.env.example`, `.prettierrc.json`, `.prettierignore` | Created | Config |
| `README.md`, `docs/PLANNING.md` | Modified | Prettier formatting; stack updated to TS 7/npm/Vitest/oxlint/tsc |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Vitest (checkpoint) | ESM + TS native; Jest ESM still experimental | Differs from the Inio product monorepo |
| TypeScript 7, npm, tsc, no tsup/Yarn (user request mid-plan) | Simplicity, future-proof | Yarn 4.5 couldn't install TS 7 anyway; publish ships tsc output |
| oxlint instead of ESLint | typescript-eslint supports TS < 6.1 only; oxlint type-aware uses TS 7 natively | Rule set differs from ESLint's |
| Drop Stryker TS checker; `tsconfigFile: ''` | TS 7 has no JS compiler API | Compile-error mutants would count as killed; round 2 had 0 such mutants. Restore when Stryker supports TS 7 (`ponytail:` note in config) |
| Plain code over zod in config | Shorter; zod removed until needed | zod returns in 01-02 for tool schemas |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 3 | Essential |
| Scope changes | 1 | Toolchain switch requested by user |
| Deferred | 2 | Logged below |

**Total impact:** toolchain differs from the plan's file list (no eslint.config.js, stryker.config.mjs instead of .json, tsconfig.build.json added, Yarn files absent); behavior and gates as planned.

### Auto-fixed Issues

1. **Tooling — Yarn 4.5.1 cannot install TypeScript 7** (builtin TS patch expects `lib/_tsc.js`). Superseded by the switch to npm.
2. **Tooling — Stryker crashed under TS 7** (`ts.parseConfigFileTextToJson is not a function`). Fix: `tsconfigFile: ''` in `stryker.config.mjs`. Verified: `npm run mutation` exits 0 at 100%.
3. **Packaging — `npm publish` would ship without dist/.** Fix: `prepack: npm run build`. Verified with `npm pack --dry-run`.

### Process deviation

- The project agents load only at session start, so the round-1 QA and developer steps ran as general-purpose agents instructed to read and follow the role files; all later steps used the real agents.

### Deferred Items

- `npm audit`: moderate `qs` advisory via `@stryker-mutator/core` → `typed-rest-client` (dev-only, not shipped). Revisit on Stryker upgrade.
- Re-enable Stryker TypeScript checker / tsconfig handling once Stryker supports TypeScript 7.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| User's global `~/.yarnrc.yml` pins Yarn 4.5.1 | Irrelevant after switching to npm |
| Prettier reformatted README and docs tables | Accepted (cosmetic; docs boundary allowed decision updates) |

## Next Phase Readiness

**Ready:**
- `loadConfig` for the server entry point
- TDD loop and CI gate proven end to end
- `.ts` import convention and secret-safe error pattern established

**Concerns:**
- oxlint type-aware is newer than typescript-eslint; watch for rule gaps
- Mutation score without a type checker can be slightly optimistic

**Blockers:** None

---
*Phase: 01-foundation, Plan: 01*
*Completed: 2026-10-28*
