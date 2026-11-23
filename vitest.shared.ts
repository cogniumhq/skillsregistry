import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const packagesDir = fileURLToPath(new URL('./packages', import.meta.url));

export default defineConfig({
  resolve: {
    // Point workspace imports at sources so `pnpm test` works on a fresh
    // clone without `pnpm build` first. Subpath exports map 1:1
    // (`./dist/adapters/index.js` -> `src/adapters`, `./dist/types.js` -> `src/types`).
    alias: [
      {
        find: /^@skillsregistry\/(contracts|dag|domain|eval|mcp|schema)(\/.*)?$/,
        replacement: `${packagesDir}/$1/src$2`,
      },
    ],
  },
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
      ],
    },
  },
});
