---
---

Dependency bumps, no published package changes. vitest and @vitest/coverage-v8 2.1 → 4.1.12 as devDependencies in every workspace package (Dependabot vitest / @vitest/mocker / tinypool / vite 5 / esbuild 0.21 alerts). vitest 4 has no `vitest.workspace.ts` or `--workspace`; the project list moved to the root `vitest.config.ts` as `test.projects`.

App-level, not published: `apps/local/web` declares `@emnapi/runtime` 1.11.1 so `@astrojs/check`'s peer stays on it; a plain re-resolve picks 2.0.0-beta.2, which breaks `astro check` ("this.bridge.setLastError is not a function").
