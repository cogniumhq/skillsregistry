---
"@skillsregistry/contracts": major
---

Initial release of `@skillsregistry/contracts`.

Extracts `src/schemas/{common,responses}.ts` from the mothership. Adds
a new `./upstream` entry point with the local-node → mothership
contract:

- `TrustScoreRequest` / `TrustScoreResponse`
- `BudgetResponse` (with `low_balance`, `tokens_reset_at`)
- `PublishRequest` / `PublishResponse` (migration door)
- `TrustScoreDelta` / `TrustScoreSyncResponse` (delta pull)
- `UpstreamErrorCode` taxonomy with 9 stable codes (`upstream_not_configured`,
  `budget_exhausted`, `unauthenticated`, `forbidden`, `not_found`,
  `rate_limited`, `bad_request`, `upstream_unavailable`, `upstream_timeout`)

Upstream schemas use plain `zod` so consumers can validate without
pulling `@hono/zod-openapi`. HTTP-response schemas keep OpenAPI meta.
