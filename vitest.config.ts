import { defineConfig } from 'vitest/config';

// Names the GitHub job summary after the suite (`--dir test/unit` → "Unit tests") instead of "Vitest Test Report".
// Runs without --dir (Stryker, local) keep Vitest's default reporters. Assumes the npm scripts' form `--dir <path> [filter]`.
const dirIndex = process.argv.indexOf('--dir');
const dir = dirIndex === -1 ? undefined : process.argv[dirIndex + 1];
const suite = dir?.split('/').pop();
const filter = process.argv.slice(dirIndex + 2).find((a) => !a.startsWith('-'));
const title =
  suite && `${suite[0]?.toUpperCase()}${suite.slice(1)} tests${filter ? ` (${filter})` : ''}`;

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '.stryker-tmp/**'],
    ...(process.env.GITHUB_ACTIONS === 'true' &&
      title && { reporters: ['default', ['github-actions', { jobSummary: { title } }]] }),
  },
});
