// Writes the Stryker mutation score per file to the GitHub job summary (or stdout).
// Score = detected / (detected + undetected), as Stryker computes it; errors and ignored mutants are left out.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const path = 'reports/mutation/mutation.json';
if (!existsSync(path)) {
  console.log(`${path} not found; no mutation summary`);
  process.exit(0);
}
const report = JSON.parse(readFileSync(path, 'utf8'));
// The incremental cache can keep results for files the config now excludes (e.g. '!src/index.ts').
const { default: config } = await import('../stryker.config.mjs');
const excluded = new Set(
  (process.env.MUTATE ? [] : config.mutate).filter((p) => p.startsWith('!')).map((p) => p.slice(1)),
);
const DETECTED = new Set(['Killed', 'Timeout']);
const UNDETECTED = new Set(['Survived', 'NoCoverage']);

const rows = Object.entries(report.files)
  .map(([file, { mutants }]) => {
    const detected = mutants.filter((m) => DETECTED.has(m.status)).length;
    const undetected = mutants.filter((m) => UNDETECTED.has(m.status)).length;
    return { file, detected, undetected };
  })
  .filter((r) => r.detected + r.undetected > 0 && !excluded.has(r.file));

const score = (d, u) => ((100 * d) / (d + u)).toFixed(2);
const total = rows.reduce((t, r) => ({ d: t.d + r.detected, u: t.u + r.undetected }), {
  d: 0,
  u: 0,
});
const { high, break: breakAt } = config.thresholds;
const mark = (s) => (s >= high ? '✅' : s >= breakAt ? '⚠️' : '❌');

const lines = [
  '## Mutation tests',
  '',
  `**Score: ${mark(score(total.d, total.u))} ${score(total.d, total.u)}%** (${total.d} detected, ${total.u} undetected; break at ${breakAt}, target ${high})`,
  '',
  '| File | Score | Undetected |',
  '| --- | ---: | ---: |',
  ...rows
    .sort((a, b) => score(a.detected, a.undetected) - score(b.detected, b.undetected))
    .map((r) => {
      const s = score(r.detected, r.undetected);
      return `| ${r.file} | ${mark(s)} ${s}% | ${r.undetected} |`;
    }),
  '',
];

const out = process.env.GITHUB_STEP_SUMMARY;
if (out) appendFileSync(out, lines.join('\n'));
else console.log(lines.join('\n'));
