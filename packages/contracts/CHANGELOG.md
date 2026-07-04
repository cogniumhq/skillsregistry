# @skillsregistry/contracts

## 1.0.1

### Patch Changes

- 020250d: Add `AdminSkillsListResponseSchema` for the local node's admin UI skills +
  migration pages (T-3.4 / T-3.6). Minimal projection of the `skills` table:
  `id`, `slug`, `name`, `source`, `version`, `mothershipPublishStatus`,
  `mothershipUrl`, `mothershipPublishedAt`, `createdAt`. Mothership fields are
  populated only on the local node — the mothership itself never emits them.

  The response envelope wraps the list with `total`, `limit`, `offset` so the UI
  can render a paginated "X of N" caption without a second round-trip. This is
  additive; existing schemas are untouched.

  Publish is deferred until Phase 3 fully lands.

## 1.0.0

### Major Changes

- 11f1b3c: Initial release of `@skillsregistry/contracts`.

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

### Patch Changes

- 749f168: Zod round-trip unit tests for every exported schema. 83 tests
  covering:

  - Common params: `SkillIdParam` UUID validation, `SkillSlugParam` /
    `VersionParam`, `HoursQuery` / `LimitQuery` / `OffsetQuery` default
    coercion.
  - HTTP response envelopes: `ErrorResponse`, `SuccessResponse`,
    `HealthResponse`, `SearchResponse` (with all optional trust +
    D2 publisher fields), `SkillDetail` (~62 fields), `SkillPullResponse`,
    `SkillVersionsResponse`, all analytics passthrough shapes,
    `EvalRunResponse`, `CompositionDetail`, lineage envelopes, social,
    publish, and author.
  - Upstream contracts: `TrustScoreRequest` / `TrustScoreResponse`
    with tier + score bounds, `BudgetResponse` plan enum, `PublishRequest`
    URL validation, `TrustScoreDelta` + `TrustScoreSyncResponse` with
    optional cursor, and `UpstreamErrorSchema` covering all 9 codes in
    the taxonomy plus retry-after bounds.

  Package now above the 90% publish gate.
