---
description: Run the TDD loop (QA red → developer green → reviewer → mutation challenge) for a story
argument-hint: <story and acceptance criteria, or a PAUL plan task>
---

Run the inio-mcp TDD loop for this story:

$ARGUMENTS

Use the project subagents in `.claude/agents/`. Pass each one the story, the acceptance criteria, and the relevant findings from the previous step. Run them one at a time, in this order:

1. **senior-qa-automation (red)**: write failing tests for every acceptance criterion. Confirm they fail for the right reason.
2. **senior-developer (green + refactor)**: make them pass with minimum code; `npm run lint && npm run typecheck && npm test` green.
3. **reviewer**: review the diff. If it returns blocker or major findings, send them to the agent that owns the fix (test findings to senior-qa-automation, code findings to senior-developer), then review again.
4. **mutation-tester**: run Stryker on the changed source files.
   - `CHALLENGE` or `FAIL`: send the challenges to senior-qa-automation to write killing tests, then senior-developer only if a new test fails because behavior is actually missing. Then run mutation-tester again.
   - Stop after 3 mutation rounds; report any remaining survivors.

Agents must stay in their lanes: QA edits only `test/`, the developer only `src/`, the reviewer and mutation-tester edit nothing.

## Finish

Report a short summary:

- Tests added (count, files)
- Final `npm test` result
- Mutation score on changed files, and any accepted equivalent mutants
- Reviewer findings and how each was resolved
- Anything left open
