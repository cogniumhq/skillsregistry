# @skillsregistry/contracts

## 3.0.0

### Major Changes

- 870584d: Move to **zod 4** (`^4.6.7`) and **`@hono/zod-openapi` 1.x** (`^1.6.3`). zod 3 has no fix for GHSA-mrhx-c7xc-m3w5 (memory exhaustion validating oversized constrained collections; patched in zod `>=4.6.6`), so the SDK has to cross the zod major for consumers to clear it.

  Wire shapes are unchanged: no field, enum value or OpenAPI component name changed, and ids are still checked with the zod 3 UUID shape (`z.guid()`, no RFC 9562 version/variant check), so every payload accepted by 2.x / 1.x is still accepted.

  Breaking for TypeScript / runtime consumers:

  - Exported schemas (`@skillsregistry/contracts`, `@skillsregistry/domain/composition` input schemas, `@skillsregistry/dag` `WorkflowDAG` / `WorkflowStep` / `RetryPolicy` / `InputMapping`) are zod 4 instances. Consumers must be on zod 4 themselves to compose them (`.extend`, `.merge`, `z.object({ x: ContractSchema })`), and on `@hono/zod-openapi` 1.x (peer `hono >=4.10`) to use them in `createRoute`.
  - Validation errors are zod 4 `ZodError`s: read `.issues` (`.errors` is gone), `.format()` / `.flatten()` are deprecated in favour of `z.treeifyError()` / `z.flattenError()`, and default messages changed (e.g. `Required` → `Invalid input: expected string, received undefined`). Code or tests that match on message text need updating.
  - `SkillIdParam` is now a `ZodGUID` (was `ZodString` with `.uuid()`); it still emits `format: uuid` in OpenAPI. Composition `authorId` / `skillId` likewise.
  - Single-argument `z.record(valueSchema)` was replaced by `z.record(z.string(), valueSchema)` (`MatchSourcesResponseSchema.matchSources`, `EvalCompareResponseSchema.metrics` / `summary` / `tierDistribution`, composition `inputMapping`); inferred types are unchanged.

### Minor Changes

- 407f3af: Admin skill mutation contracts for the local node (#83 / #84). Additive, no existing field changed: `AdminSkillStatusSchema` (the operator-settable lifecycle subset — `draft` / `published` / `deprecated` / `archived`, deliberately excluding platform-set states like `revoked` and `vulnerable`), `AdminSkillPatchRequestSchema` + `AdminSkillPatchResponseSchema` for the status transition, and `AdminSkillDeleteResponseSchema` for the hard delete (reports `embeddingsRemoved` so the caller can see what the cascade took). Manifest fields stay immutable by construction — `POST /v1/skills` is INSERT-only and `UNIQUE (slug, version)` means a corrected manifest is a new version, not an edit of history.

### Patch Changes

- cb6c3f6: Remove internal infrastructure hostnames and private-repo paths from published
  package contents.

  Internal hostnames appeared in the domain README and in source comments;
  `.specifica/...` paths appeared in several comments and in the
  `0025_mcp_invocations.sql` migration header. All are replaced with
  neutral wording.

  No API, type, runtime default or behaviour changes — every occurrence was a
  comment, a README line, or a test URL, never a functional default. This is a
  patch only because these packages publish `README.md` (and, for schema, the
  `.sql` file) inside the tarball, so the artifact contents genuinely differ.

## 2.0.0

### Major Changes

- `SearchRequestSchema` field names flipped snake_case → camelCase to resolve X6 (mothership CLAUDE.md sibling-spec drift log, 2026-07-15). Field renames — all breaking for any consumer that spelled the snake form:

  - `tenant_id` → `tenantId`
  - `min_trust` → `minTrust`
  - `allow_vulnerable` → `allowVulnerable`
  - `runtime_env` → `runtimeEnv`

  Rationale: every current caller (mothership inline schema at `src/routes/search.ts`, Cortex `SkillsRegistryClient.findSkill()`, local-node route surface) was already sending camelCase. The v1.x snake_case contract was inert — it caught no real consumers and created a silent-drop risk (Zod strip mode would have dropped `tenantId` under the snake schema, making every Cortex search public-scope). Aligning the contract to observed reality closes the drift.

  No other schemas changed: `TrustScoreRequest`, `BudgetResponse`, `PublishRequest`, `SkillRevocationEvent`, etc. remain snake_case (their consumers already speak snake_case and the contract there is load-bearing).

  Enum _values_ on `SkillVisibilitySchema` also stay snake_case — they mirror the Postgres `chk_visibility` CHECK constraint values (`@skillsregistry/schema`) and cannot be flipped without a DB migration. Only the field-name flip is in scope for this bump.

  Consumers: bump the pin, rename the four field spellings at every call site, ship.

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
