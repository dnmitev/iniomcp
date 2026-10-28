/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { dir: 'test/unit' },
  mutate: ['src/**/*.ts', '!src/index.ts'],
  thresholds: { high: 90, low: 80, break: 80 },
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  // ponytail: Stryker rewrites tsconfig through the TypeScript JS API, which TypeScript 7
  // no longer ships. An empty tsconfigFile skips that step; restore when Stryker supports TS 7.
  tsconfigFile: '',
};
