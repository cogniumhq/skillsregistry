# @skillsregistry/contracts

## 1.1.0

### Minor Changes

- 5e6018b: Ship the revocation-event surface per cortex.md §12. Consumers (Cortex, local nodes, third-party agents) build against these shapes to receive `skill.revoked` / `skill.deprecated` events via webhook or `GET /v1/sync/revocations?since=<ISO>`:

  - `SkillRevocationEventSchema` — `{ event_id, event_type, emitted_at, skill_id, slug, version?, reason, reason_detail?, remediation_message?, remediation_url?, replacement_skill_id?, replacement_slug? }`
  - `SkillRevocationReasonSchema` — enum: `security | compliance | policy | quality | author_request | superseded | unknown`
  - `SkillRevocationEventTypeSchema` — enum: `skill.revoked | skill.deprecated`
  - `SkillRevocationSyncResponseSchema` — cursor-paginated pull response, mirrors `TrustScoreSyncResponseSchema` so consumers can share a delta-pull scaffold

  Wire naming is snake_case for parity with the rest of the upstream API. Local-node webhook wiring is a follow-up; the contracts are the load-bearing prerequisite.

  Closes review finding S7 (contracts side).

- 031265b: Ship `SkillSandboxSchema` + `SkillSandbox` type per skill-convention v1.3 §9. Fields: `image` (required, non-empty), `memory_mb` / `cpu` / `timeout_seconds` (positive ints), `egress: string[]`, optional `profile: 'agent'` + `budget_caps: { max_tokens_usd?, max_internal_tool_calls?, max_wall_seconds? }`. Wired into `PublishRequestSchema.manifest` as an optional field so pre-v1.3 rows still parse. Also adds `sandbox_contract_violated` to `UpstreamErrorCode` (and the `UpstreamErrorSchema` enum) — a distinct code for exit-90 sandbox failures (skill-convention §9.2) that keeps them out of the generic `bad_request` / `upstream_unavailable` buckets so operators see a named, actionable cause.
- 0fa154b: Ship `SearchRequestSchema` per cortex.md §6.2 (the SkillsRegistry mothership `POST /v1/search` contract): `{ query, tenant_id?, appetite?, min_trust?, allow_vulnerable?, limit?, tags?, category?, runtime_env?, visibility?, portable? }`. Wire naming is snake_case for parity with the rest of the upstream API surface.

  Also ships two supporting enums as named schemas: `AppetiteSchema` (`strict | cautious | balanced | adventurous`) and `SkillVisibilitySchema` (the 4-band model — `public | private | tenant_private | tenant_internal | unlisted`). `SkillVisibilitySchema` matches `@skillsregistry/schema@1.1.0`'s expanded `chk_visibility` CHECK constraint; `private` is retained as a legacy alias.

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
