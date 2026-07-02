# @skillsregistry/eval

Search-quality eval suite for SkillsRegistry — fixtures, Recall@1 /
Recall@5 / MRR metrics, and a CLI runner that measures any `/v1/search`
endpoint against a curated 90+ query fixture set.

Part of the [SkillsRegistry SDK][sdk]. Consumed by both the
[SkillsRegistry mothership][mothership] (Cloudflare Workers) and the
[self-hostable local node][local] (Node.js), and installable standalone
as a QA / CI gate.

## What ships

- `evalFixtures` — 90+ query / expected-skill pairs across 5 phrasing
  patterns (`direct`, `problem`, `business`, `alternate`, `composition`),
  plus `validateFixtures()` / `getFixtureStats()` helpers.
- `computeMetrics(results)` / `buildEvalResult(fixture, response, ms)` /
  `formatMetrics(metrics)` — Recall@1, Recall@5, MRR, per-tier accuracy,
  per-tier latency, per-pattern breakdown, match-source distribution,
  LLM-fallback lift.
- `runEvalSuite(endpoint, tenantId, options)` — the programmatic entry
  point. Options include `limit`, `verbose`, and `headers` (arbitrary
  request headers — used to attach auth to protected endpoints).
- `skillsregistry-eval` CLI (`./dist/cli.js`) — runs the suite from the
  terminal, prints the summary + failed-query report, exits non-zero
  when success rate < 50%.

## Install

```
npm install --save-dev @skillsregistry/eval
```

## CLI

```
# Against a public endpoint
npx skillsregistry-eval --endpoint https://api.skillsregistry.net

# Against a protected staging endpoint
npx skillsregistry-eval \
  --endpoint https://staging.example.com \
  --auth "Bearer $STAGING_TOKEN" \
  --header "X-Tenant-Id: default" \
  --verbose --show-failed
```

Flags:

| Flag | Purpose |
|---|---|
| `-e, --endpoint <url>` | Base host or full `/v1/search` URL |
| `-t, --tenant <id>` | Tenant ID in the request body (default `eval-tenant`) |
| `-l, --limit <n>` | Max results per query (default 10) |
| `-a, --auth <value>` | Set `Authorization: <value>` |
| `-H, --header "Name: Value"` | Arbitrary header. Repeatable. |
| `-v, --verbose` | Per-fixture progress |
| `-f, --show-failed` | Failed-query detail report |

Exit codes: `0` = success rate ≥ 0.5 (warnings for < 0.8), `1` = < 0.5
or fatal error.

## Programmatic

```ts
import { runEvalSuite, formatSummary } from '@skillsregistry/eval';

const result = await runEvalSuite(
  'https://api.skillsregistry.net',
  'my-tenant',
  {
    headers: { Authorization: `Bearer ${process.env.API_TOKEN}` },
    verbose: true,
  },
);

console.log(formatSummary(result));

if (result.metrics.recall5 < 0.8) {
  process.exit(1);
}
```

## Sub-paths

- `.` — main barrel
- `./fixtures` — fixture data + validators
- `./metrics` — metric compute + formatters
- `./runner` — programmatic runner
- `./cli` — CLI entry (bin: `skillsregistry-eval`)

## Phase / gate targets

| Metric | Baseline |
|---|---|
| Recall@1 | ≥ 70% (Phase 1) |
| Recall@5 | ≥ 85% (Phase 1), ≥ 90% (Phase 3) |
| MRR | ≥ 0.75 (Phase 1) |

`.specifica/mvp/tasks.md` gates the mothership migration PR (T-1.7) on
`Recall@5 ≥ 80%` against the port before merge.

## License

Apache-2.0.

[sdk]: https://github.com/cogniumhq/skillsregistry-local
[mothership]: https://api.skillsregistry.net
[local]: https://github.com/cogniumhq/skillsregistry-local/tree/main/apps/local
