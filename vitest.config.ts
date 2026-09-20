import { defineConfig } from 'vitest/config';

// Root Vitest config owns *workspace-level* coverage. Project configs
// (vitest.shared.ts merged into packages/*/vitest.config.ts) do not
// control the merged report when using `vitest.workspace.ts`.
//
// Overall floor (measured 2026-09-20: lines/stmts ~69%, funcs ~77%,
// branches ~86%). Keep these modest so a few new files cannot red CI.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      exclude: [
        '**/*.test.ts',
        '**/dist/**',
        '**/node_modules/**',
        '**/*.d.ts',
        '**/web/dist/**',
        'scripts/**',
        'vitest.*.ts',
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
