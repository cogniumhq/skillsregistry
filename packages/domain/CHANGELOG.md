# @skillsregistry/domain

## 1.2.0

### Minor Changes

- ece1aa7: Search filters: `PgVectorProvider` now owns the `unlisted` rule — search never returns `unlisted` rows (direct-lookup-only per migration 0035), so consumers no longer post-filter; the default visibility clause is the full 4-band owner set (`private`, `tenant_private`, `tenant_internal`) and an explicit non-public band is scoped to the caller's tenant. New additive facet filters `categories?: string[]` (matches `category` or any `categories[]`) and `domains?: string[]` (matches `domain`, schema 0037) on `SearchFilters` / `FindSkillOptions` — OR within a dimension, AND across (sr#30). New `APPETITES` runtime list beside the `Appetite` type for edge validation.

### Patch Changes

- Updated dependencies [ece1aa7]
- Updated dependencies [2310e0d]
  - @skillsregistry/schema@1.2.0

## 1.1.1

### Patch Changes

- 0b2a971: `PgVectorProvider.vectorSearch` restructured to KNN-first (the X8 fix).

  The previous shape (`SELECT DISTINCT ON (s.slug) ... ORDER BY s.slug, version_rank DESC, dist ASC`) forced Postgres to compute the halfvec `<=>` distance for every row in `skill_embeddings` on every uncached query — a parallel seq scan + sort — because HNSW returns rows in _distance_ order but `DISTINCT ON (s.slug)` needed _slug_ order first. Measured against a ~102K-row prod corpus: **6432ms vs 143ms** for the same top-K done index-first (~45× penalty on the dominant cost of every cold search).

  Fix: the query now pulls the top-K nearest candidates in a CTE (HNSW-served), then dedups by slug + applies the `s.*` filters on the small candidate set. `s.tenant_id IN ($1, 'default')` and the embedding NOT-NULL guard are inlined in the CTE where they're cheap. `s.*` filters (status / minTrust / contentSafety / executionLayer / category / tags / visibility / runtimeEnv / portable) remain post-join. Result shape, filter semantics, and best-version-per-slug ordering are byte-identical.

  Candidate budget defaults to 200 (LIMIT on the CTE) — pgvector's `hnsw.ef_search` (default 40) is the real bound on how many rows the index returns; the LIMIT is a generous ceiling so that raising `ef_search` globally lets the extra candidates flow through automatically. A per-query `SET LOCAL hnsw.ef_search` was tried and dropped — the ~130ms of extra round-trips over Hyperdrive outweighed the recall gain.

  Retires the equivalent runtime instance-override the mothership had carried since 2026-07-16. The mothership bumps this pin and drops its override in the same close-out.

## 1.1.0

### Minor Changes

- 0fa154b: `FindSkillRequest` + `FindSkillOptions` gain optional `minTrust` (0..1) and `allowVulnerable` (boolean) fields per cortex.md §6.2. When set they override the appetite-derived defaults inside `ConfidenceGate.findSkill()`; when absent, `appetiteToTrustThreshold` / `appetiteToAllowVulnerable` continue to drive.

  Also introduces the shared `SkillVisibility` union (`public | private | tenant_private | tenant_internal | unlisted`), replacing the previous 3-value inline union on `FindSkillRequest.visibility`, `FindSkillOptions.visibility`, and `SearchFilters.visibility`. Matches the migrated CHECK constraint in `@skillsregistry/schema@1.1.0` and the enum in `@skillsregistry/contracts@1.2.0`.

### Patch Changes

- Updated dependencies [5e6018b]
- Updated dependencies [031265b]
- Updated dependencies [0fa154b]
- Updated dependencies [031265b]
- Updated dependencies [0fa154b]
  - @skillsregistry/contracts@1.1.0
  - @skillsregistry/schema@1.1.0

## 1.0.1

### Patch Changes

- Updated dependencies [020250d]
  - @skillsregistry/contracts@1.0.1

## 1.0.0

### Major Changes

- d6f2301: Scaffold `@skillsregistry/domain` at `0.1.0` with the five adapter
  interfaces that define the ports side of the hexagonal boundary:

  - `KvAdapter` — key-value cache (CF KV / Postgres `kv_store`)
  - `QueueAdapter<T>` — background dispatch (CF Queues / in-memory)
  - `ArtifactAdapter` — blob storage (R2 / filesystem)
  - `EmbedderAdapter` — text embeddings with `EmbedderIdentity` for
    cross-model write safety
  - `AfterResponse` — deferred work (`waitUntil` / `setImmediate`)

  No domain logic yet. Sub-modules land per subtasks T-1.4b → T-1.4f
  in the parent monorepo's `.specifica/mvp/tasks.md`; `1.0.0` publishes
  after all are complete so consumers see one stable surface.

### Minor Changes

- 18bfcc5: T-1.4e: Port `src/composition/*` from mothership behind the composition
  adapter bundle.

  New module at `packages/domain/src/composition/`:

  - `forkSkill(sourceId, authorId, authorType, adapters)` — clone a
    published skill as a `forked` draft with lineage. Trust reset via
    `BASE_TRUST[root_source]`; composition sources copy their step list.
  - `copySkill(sourceId, authorId, authorType, adapters)` — clone with a
    hard trust reset (0.5) and no lineage.
  - `createComposition(input, adapters)` — build an `auto-composite` from
    an ordered step list. v5.0 trust rule preserved: `min(step trusts) ×
0.90`.
  - `extendComposition(compositionId, newSteps, authorId, authorType,
adapters)` — fork a composition and append steps, recomputing trust +
    capabilities.
  - `publishComposition(compositionId, pool)` — draft → published, gated
    on every step still being published.
  - `getAncestry(id, pool)`, `getForks(id, pool)`, `getDependents(id, pool)`
    — lineage projections.
  - `getCompositionBySlug(pool, slug, tenantId, options)` — allowlisted
    composition-detail loader with tenant visibility filter and
    configurable `shareUrlHost`.

  New adapter bundle at `composition/adapters.ts`:

  - `CompositionAdapters { pool, embedQueue, scanQueue }` — every
    write-side function takes this instead of ad-hoc `Env` bindings.
  - `EmbedQueueMessage { skillId, action: 'embed' }` and
    `CogniumScanQueueMessage { skillId, priority, timestamp }` — typed
    queue payloads matching mothership's on-wire shape.
  - Both queues are consumed via the existing `QueueAdapter<T>` port —
    no new adapter interface, just typed instantiations.

  Typed error classes at `composition/errors.ts`:

  - `NotFoundError` (source skill missing / not published).
  - `ValidationError` (bad input, wrong state, unpublished step, etc.).

  Zod input validators at `composition/schema.ts` — verbatim port of
  `forkInputSchema`, `copyInputSchema`, `compositionInputSchema`,
  `extendInputSchema` for consumers to run at the transport boundary.

  New dependencies (both peer-safe, small, no native bindings):

  - `nanoid ^5.1.6` — used for slug suffixes on fork/copy/compose.
  - `zod ^3.23.0` — direct dep for `composition/schema.ts` (was already
    transitive via `@skillsregistry/contracts`).

  Ships new subpath: `@skillsregistry/domain/composition`.

  Env-binding refactor: mothership's `env.EMBED_QUEUE.send(...)` and
  `env.COGNIUM_QUEUE.send(...)` calls are now routed through the two
  `QueueAdapter<T>` slots in `CompositionAdapters`. Mothership binds them
  to CF Queues; the local node binds them to Postgres LISTEN/NOTIFY or
  in-memory. Best-effort semantics preserved (queue failures logged +
  swallowed so the write itself always succeeds).

  No behavioral change to the trust math, lineage traversal, or tenant
  visibility filter versus mothership.

- 2f7d6ae: T-1.4d: Port `src/intelligence/*` from mothership behind runtime-agnostic adapters.

  - `ConfidenceGate` — three-tier orchestrator (T1 immediate, T2 optional LLM expansion, T3 full deep search). Takes an options struct pinning every tunable knob (mode-aware t1/t2 thresholds, gap + cluster density, deep-search on/off, reranker on/off, skip-reranker gap, circuit-breaker knobs, name-boost weight). Runs `log()` + `cache.set()` through `AfterResponse.run(...)` instead of raw `ctx.waitUntil(...)`.
  - `DeepSearch` — talks to the LLM strictly through `LlmAdapter.complete`; mode-aware `tier2Threshold` default mirrors `PgVectorProvider` / `ConfidenceGate` (linear 0.42, RRF 0.018).
  - `CompositionDetector` — same shape; options-only constructor.
  - `Reranker` — takes `SqlPool` + `CircuitBreaker` + `RerankerBackend` + `topN` option.
  - `RerankerBackend` port + `LiteLLMRerankBackend` (Cohere-shape HTTP; runs anywhere `fetch` exists). The `WorkersAIRerankBackend` and `createRerankerBackend(env)` factory stay in mothership — they need a CF-specific runtime binding.

  New adapter ports at `packages/domain/src/adapters/`:

  - `LlmAdapter` (`complete({ system, user, maxTokens })`) — replaces every `env.AI.run(env.LLM_MODEL, {messages, max_tokens})` call.
  - `SearchCachePort` (`get`/`set` keyed by `query + tenantId + appetite`) — replaces the KV-backed `SearchCache`.
  - `SearchLoggerPort` (`buildLogEntry`, `log`, `estimateEmbeddingCost`) — replaces the `SearchLogger` service.

  New domain types at `packages/domain/src/types.ts`:

  - `Appetite`, `appetiteToTrustThreshold`, `appetiteToAllowVulnerable`.
  - `FindSkillRequest`, `FindSkillResponse`, `SkillResult`.
  - `CompositionResult`.
  - `SearchLogEntry`.

  `exactOptionalPropertyTypes` relaxed in `packages/domain/tsconfig.json` to match the mothership's `strict: true` ergonomics — the option-heavy port shape (`foo?: string` populated from optional inputs) breaks under the stricter flag. Rationale documented inline.

  Ships new subpath exports: `@skillsregistry/domain/intelligence`.

  No behavioral change to tier classification, reranker skip logic, deep-search merge, or the name-boost + dedup pipeline versus mothership.

- 7e688ed: T-1.4c: Port `src/providers/*` from mothership behind the domain's runtime-agnostic ports.

  - Adds `SearchProvider` interface (verbatim port) and `PgVectorProvider` concrete implementation.
  - Constructor drops CF `Env` dependency in favor of `PgVectorProviderOptions { pool: SqlPool, ...tuningKnobs }`. All ten tuning knobs (fusion mode, RRF k, tier thresholds, blend weights, trust-boost weights, candidate pool multiplier) exposed as typed optional fields with the mothership's defaults preserved.
  - Introduces `SqlPool` / `SqlConnection` / `SqlClient` / `SqlQueryResult` ports in `packages/domain/src/adapters/sql.ts`. Structurally compatible with `pg.Pool` and `@neondatabase/serverless`, so consumers pass their driver's pool through unchanged.
  - Adds search-facing domain types (`SkillInput`, `EmbeddingSet`, `SearchFilters`, `SearchOptions`, `SearchResult`, `ScoredSkill`, `ConfidenceSignal`, `SearchMeta`, plus the skill status / type / tier / badge unions) at `src/types.ts`.
  - Adds `textNormSha256` + `normalizeText` at `src/ingestion/text-fingerprint.ts` (verbatim port) — used by the embed-cache gate to keep `skill_embeddings.text_norm_sha256` in lockstep with migration 0024.
  - Ships new subpath exports: `@skillsregistry/domain/providers` and `@skillsregistry/domain/types`.

  No behavioral changes to fusion, scoring, indexing, or transaction shape versus mothership. Consumers inject a `SqlPool` at boot; the domain code owns retrieval strategy end-to-end.

- 79cf3e3: Port `src/resilience/*` from the mothership under the new adapter ports:

  - `CircuitBreaker` — unchanged, closed / open / half-open state machine
  - `TenantCircuitRegistry` — per-tenant breaker factory. Constructor now
    takes `{ threshold, cooldownMs }` options only; the mothership's `Env`
    dependency is gone (callers pull env vars themselves)
  - `LLMProxyRateLimiter` — sliding-window per-tenant per-stage counter.
    Rewritten against `KvAdapter` + `AfterResponse`; no more
    `env.SEARCH_CACHE` / `waitUntil` couplings. Degrades open (no-op) when
    no `KvAdapter` is provided, matching the mothership's KV-missing
    behavior. Key namespace `llmproxy-rl:{stage}:{tenantId}:{minute}`
    preserved so counters remain wire-compatible if the mothership adopts
    this port later.

  Exposed via the new `@skillsregistry/domain/resilience` subpath and the
  package root barrel. No breaking changes to consumers — this package is
  pre-1.0 and gains capabilities on each T-1.4x subtask; 1.0 lands with
  T-1.4f.

- ec92340: T-1.4f: Port `src/cognium/scoring-policy.ts` from mothership as
  `@skillsregistry/domain/scoring`.

  - `BASE_TRUST` + `MAX_TRUST` constants (source provenance floor + ceiling)
  - `computeTrustScore(skill, findings)` — Circle-IR-derived trust math with
    phase-specific (`sast` / `instruction_safety` / `capability_mismatch`)
    classification.
  - `capTrustBySource`, `deriveStatus`, `deriveTier`, `clampTrust`.
  - D2 publisher-signature adjustments: `effectiveTrustBadge` (badge gate),
    `applyRevocationScoring(pool, keyId, penalty)` — SQL-side revocation
    cascade takes a plain numeric `penalty` instead of an `Env`.
  - `parsePositiveFloat` exported so consumers can mirror the mothership's
    env-var → number parsing behavior exactly.
  - `DEFAULT_SIGNATURE_BONUS` (0.05) + `DEFAULT_SIGNATURE_REVOKED_PENALTY`
    (0.20) — kept as named constants so consumers can wire env fallbacks
    without hardcoding.
  - `buildRemediationMessage(finding, skill)` remediation-string builder.

  New domain types at `packages/domain/src/types.ts`:

  - `CircleIRAnalysisPhase` — `'sast' | 'instruction_safety' | 'capability_mismatch'`.
  - `ScanFinding` — normalized finding shape consumed by scoring.
  - `SkillRow` — minimal skill projection the scoring policy reads.

  Ships new subpath: `@skillsregistry/domain/scoring`.

  Env-binding refactor: mothership's `trustSignatureBonus(env)` and
  `trustSignatureRevokedPenalty(env)` helpers stay in the mothership (they
  read `env.TRUST_SIGNATURE_*` — CF-runtime-specific). The domain exports
  the raw parser + defaults so the consumer computes the number once at
  boot and passes it in.

  No behavioral change to trust math, tier derivation, or badge-gate logic
  versus mothership.

### Patch Changes

- 749f168: Unit test coverage across all six domain sub-modules. 341 new tests:

  - **scoring/policy** — 98 tests, 100% coverage. All finding types,
    D2 signature bonus/revocation, tier boundaries, cascade impact.
  - **ingestion/text-fingerprint** — 19 tests, 100% coverage. Web
    Crypto SHA-256 across empty/short/long/binary inputs.
  - **providers/pgvector-{fusion,search,index}** — 82 tests, 95.67%
    coverage. Fusion weights, SqlPool query-shape assertions,
    distance-metric round-trips.
  - **intelligence** — 65 tests, 95.72% coverage. Confidence-gate
    tier classification with `SKIP_RERANKER_GAP`, deep-search T3 rescue,
    reranker fan-in, backend fetch with undici MockAgent.
  - **composition** — 77 tests, 91.6% coverage. Fork / copy / compose /
    extend / publish / lineage / get-composition all through the SqlPool
    - QueueAdapter port.

  Package now above the 90% publish gate.

- Updated dependencies [11f1b3c]
- Updated dependencies [6f1f241]
- Updated dependencies [749f168]
- Updated dependencies [749f168]
  - @skillsregistry/contracts@2.0.0
  - @skillsregistry/schema@2.0.0
