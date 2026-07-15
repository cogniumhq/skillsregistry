# @skillsregistry/eval

## 1.0.2

### Patch Changes

- Updated dependencies [0fa154b]
  - @skillsregistry/domain@1.1.0

## 1.0.1

### Patch Changes

- @skillsregistry/domain@1.0.1

## 1.0.0

### Major Changes

- c554880: T-1.6: Extract `@skillsregistry/eval` from mothership.

  Search-quality eval suite for SkillsRegistry — 90+ query / expected-skill
  fixtures, Recall@1 / Recall@5 / MRR metrics, and a `skillsregistry-eval`
  CLI that measures any `/v1/search` endpoint. Ports mothership
  `src/eval/fixtures.ts`, `src/eval/metrics.ts`, `src/eval/runner.ts`, and
  `scripts/run-eval.ts` behind a stable public surface so the same suite
  runs against the Cloudflare Workers mothership and the local Node app
  from the same npm install.

  Public entry points:

  - `evalFixtures` — 90+ query / expected-skill pairs across 5 phrasing
    patterns (`direct`, `problem`, `business`, `alternate`,
    `composition`). Ships with `validateFixtures()` (pattern coverage +
    duplicate-ID + UUID-shape checks) and `getFixtureStats()`
    (per-pattern / per-skill counts).
  - `computeMetrics(results)` — Recall@1, Recall@5, MRR, average top
    score, tier distribution, per-tier accuracy, per-tier latency
    (p50/p95/p99), LLM-fallback lift, per-pattern breakdown, and
    match-source distribution.
  - `buildEvalResult(fixture, response, latencyMs)` — reduces a single
    fixture + `FindSkillResponse` into an `EvalResult` with rank and
    unknown-competitor detection.
  - `formatMetrics(metrics)` / `formatSummary(result)` /
    `formatFailedQueries(result)` — human-readable CLI output.
  - `runEvalSuite(endpoint, tenantId, options)` — programmatic entry.
    `RunEvalOptions` accepts `limit`, `verbose`, and `headers` (arbitrary
    request headers — supports `--auth`-style tokens for protected
    endpoints without leaking secrets into the URL).
  - `skillsregistry-eval` CLI binary (`bin` in `package.json`) — argument
    parser + orchestrator around `runEvalSuite`. Flags: `--endpoint`,
    `--tenant`, `--limit`, `--auth`, `--header` (repeatable),
    `--verbose`, `--show-failed`, `--help`. Exit codes: `0` for success
    rate ≥ 0.5 (with warnings for < 0.8), `1` for < 0.5 or fatal error.

  Peer stance: depends on `@skillsregistry/domain` (workspace:\*) for
  `FindSkillRequest` + `FindSkillResponse` — the only mothership types
  touched by the port. `EvalFixture` + `EvalMetrics` + `EvalResult` are
  co-located inside this package (moved out of mothership `src/types.ts`)
  so consumers only need `@skillsregistry/eval`.

  Sub-paths shipped:

  - `.` — main barrel
  - `./fixtures` — fixture data + validators
  - `./metrics` — metric compute + formatters
  - `./runner` — programmatic runner + `RunEvalOptions`
  - `./cli` — CLI entry (bin: `skillsregistry-eval`)

  Auth header support is the T-1.6 gate criterion — the mothership CLI
  never supported protected endpoints (implicit assumption that
  `api.skillsregistry.net` is anonymous read). The port adds
  `--auth "Bearer …"` and `-H "Name: Value"` (repeatable) so
  `@skillsregistry/eval` doubles as a QA gate for pre-prod tiers,
  private tenants, and the local node's tenant-locked mode without
  committing tokens to `--endpoint`.

  Verification: `pnpm --filter @skillsregistry/eval typecheck` clean,
  `pnpm --filter @skillsregistry/eval build` clean,
  `pnpm --filter @skillsregistry/eval test` 24/24 green (fixture
  validation + metric compute + formatter smoke).

  First npm publish: `1.0.0`. Fixtures dated at extraction (May 2026
  mothership fixtures.ts, unchanged).

### Patch Changes

- Updated dependencies [d6f2301]
- Updated dependencies [18bfcc5]
- Updated dependencies [2f7d6ae]
- Updated dependencies [7e688ed]
- Updated dependencies [79cf3e3]
- Updated dependencies [ec92340]
- Updated dependencies [749f168]
  - @skillsregistry/domain@1.0.0
