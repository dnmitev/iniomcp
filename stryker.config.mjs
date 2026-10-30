/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { dir: 'test/unit' },
  // MUTATE=src/a.ts,src/b.ts narrows a run; the CLI --mutate is merged with this list instead.
  mutate: process.env.MUTATE
    ? process.env.MUTATE.split(',').map((s) => s.trim())
    : ['src/**/*.ts', '!src/index.ts'],
  thresholds: { high: 90, low: 80, break: 80 },
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  // ponytail: Stryker rewrites tsconfig through the TypeScript JS API, which TypeScript 7
  // no longer ships. An empty tsconfigFile skips that step; restore when Stryker supports TS 7.
  tsconfigFile: '',
};
