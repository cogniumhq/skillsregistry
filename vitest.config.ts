import { defineConfig } from 'vitest/config';

// Root Vitest config owns the project list and *workspace-level* coverage.
// Project configs (vitest.shared.ts merged into packages/*/vitest.config.ts)
// do not control the merged report. (vitest 4 removed `vitest.workspace.ts`
// and `--workspace`; the list moved here as `test.projects`.)
//
// Overall floor (measured 2026-09-20: lines/stmts ~69%, funcs ~77%,
// branches ~86%). Keep these modest so a few new files cannot red CI.
export default defineConfig({
  test: {
    projects: [
      'packages/contracts',
      'packages/schema',
      'packages/dag',
      'packages/domain',
      'packages/mcp',
      'packages/eval',
      'apps/local',
      'apps/local/web',
      'tools',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      exclude: [
        '**/*.test.ts',
        '**/*.test.mjs',
        '**/dist/**',
        '**/node_modules/**',
        '**/*.d.ts',
        '**/web/dist/**',
        'scripts/**',
        'vitest.*.ts',
        '**/vitest.config.mjs',
      ],
      thresholds: {
        lines: 50,
        statements: 50,
        functions: 45,
        branches: 40,
      },
    },
  },
});
