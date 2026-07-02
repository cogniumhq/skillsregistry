# SkillsRegistry Local — MVP Tasks

**Open work.** Discrete items, status, notes. Long narrative lives in `design.md`.

Status legend: `☐` open · `▶` in progress · `☑` done · `⊘` cancelled · `⏸` blocked

Ordered roughly by dependency, not by priority. Phase-1 tasks (SDK extraction) must complete before phase-2 (local app skeleton). Phase-3 is release + docs.

---

## Phase 0 — Repo scaffold

- ☑ **T-0.1** Create directory structure, LICENSE (Apache-2.0), NOTICE, .gitignore, README stub, CLAUDE.md
- ☑ **T-0.2** Write `.specifica/principles.md`, `spec.md`, `design.md`, `tasks.md`
- ☑ **T-0.3** Add `package.json` (workspace root), `pnpm-workspace.yaml`, `tsconfig.base.json`
- ☑ **T-0.4** Add `.changeset/config.json` with `access: "public"` for `@skillsregistry/*`
- ☑ **T-0.5** Add CI workflows: `.github/workflows/ci.yml`, `publish-sdk.yml`, `publish-app.yml`
- ☑ **T-0.6** Add `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), `SECURITY.md` (security@cognium.net + 90-day embargo)
- ☐ **T-0.7** Configure branch protection on `main` (require CI green, require review) — repo-admin task, not code
- ☐ **T-0.8** Create npm org / scope registration for `@skillsregistry/*` — publish permissions

## Phase 1 — SDK extraction from mothership

Each extraction lands in this repo, publishes `1.0.0` to npm, then the mothership repo consumes it in a follow-up PR (tracked in mothership's own `tasks.md`, not here). Mothership eval must pass after each step.

- ☑ **T-1.1** Extract `@skillsregistry/schema` — moved `src/db/schema.ts` + all 32 `src/db/migrations/*.sql` from mothership into `packages/schema/`. Added runtime-agnostic migration runner (`runMigrations`, `assertSchemaAtLeast`, `loadBundledMigrations`) plus `SCHEMA_VERSION = 32` constant. Build + typecheck pass. Changeset queued for `1.0.0` npm publish.
- ☑ **T-1.2** Extract `@skillsregistry/contracts` — moved `src/schemas/{common,responses}.ts` from mothership. Added new `./upstream` entry point with `TrustScoreRequest`/`Response`, `BudgetResponse`, `PublishRequest`/`Response`, `TrustScoreDelta`/`SyncResponse`, and a 9-code `UpstreamErrorCode` taxonomy. Build + typecheck pass. Changeset queued for `1.0.0`.
- ☑ **T-1.3** Move `@skillsregistry/dag` from `mothership/packages/dag/` into `packages/dag/` here. License normalized MIT → Apache-2.0 (never published under MIT). All 74 tests pass. Build + typecheck pass. Changeset queued for `1.0.0` publish. Closes mothership pending workstream #4 (SDK publishing decision).
- ☐ **T-1.4** Extract `@skillsregistry/domain` — landed in six sub-PRs. Only publish `1.0.0` after (f) so consumers see one coherent surface.
  - ☑ **T-1.4a** Adapter interfaces skeleton — `packages/domain@0.1.0` scaffolded with all five ports (`KvAdapter`, `QueueAdapter<T>`, `ArtifactAdapter`, `EmbedderAdapter`, `AfterResponse`) at `src/adapters/`. `EmbedderIdentity` surfaces model identity for cross-model write safety. Nothing moved yet. Build + typecheck pass.
  - ☑ **T-1.4b** Ported `src/resilience/*` at `packages/domain/src/resilience/`. `CircuitBreaker` verbatim (no env dep) with its 11-test suite green. `TenantCircuitRegistry` refactored to options-only constructor (dropped `Env`). `LLMProxyRateLimiter` rewritten against `KvAdapter` + `AfterResponse` — degrades open when no KV adapter; key namespace preserved wire-compatible. Exposed via package root and `@skillsregistry/domain/resilience` subpath. Bumped to `0.2.0`.
  - ☑ **T-1.4c** Ported `src/providers/*` at `packages/domain/src/providers/`. `SearchProvider` interface verbatim. `PgVectorProvider` refactored to `PgVectorProviderOptions { pool: SqlPool, ...tuningKnobs }` — dropped `Env`/`createPool`, exposed all 10 tuning knobs as typed options with mothership defaults preserved. Introduced `SqlPool` / `SqlConnection` / `SqlClient` / `SqlQueryResult` ports at `adapters/sql.ts` (structurally pg-compatible). Added search-facing types at `src/types.ts` (`SkillInput`, `EmbeddingSet`, `SearchFilters`, `SearchOptions`, `SearchResult`, `ScoredSkill`, `ConfidenceSignal`, `SearchMeta`, plus status/tier/badge unions). Ported `textNormSha256` at `ingestion/text-fingerprint.ts`. Exposed via package root, `@skillsregistry/domain/providers`, and `@skillsregistry/domain/types`. Bumped to `0.3.0`.
  - ☑ **T-1.4d** Ported `src/intelligence/*` at `packages/domain/src/intelligence/`. `ConfidenceGate` refactored to `ConfidenceGateOptions { provider, embedFn, cache, logger, pool, deepSearch, compositionDetector, reranker, ...tuningKnobs }` — mode-aware t1/t2 thresholds preserved, `AfterResponse.run(...)` replaces `ctx.waitUntil(...)`. `DeepSearch`, `CompositionDetector` moved onto `LlmAdapter.complete`; `Reranker` moved onto `SqlPool` + `RerankerBackend`. `LiteLLMRerankBackend` (Cohere-shape HTTP) shipped in the domain; Workers AI variant + factory stay in mothership (need CF binding). New ports at `adapters/`: `LlmAdapter`, `SearchCachePort`, `SearchLoggerPort`. New types at `types.ts`: `Appetite` + helpers, `FindSkillRequest`, `FindSkillResponse`, `SkillResult`, `CompositionResult`, `SearchLogEntry`. Relaxed `exactOptionalPropertyTypes` in domain tsconfig to match mothership's `strict: true` ergonomics (rationale documented inline). Exposed via `@skillsregistry/domain/intelligence` subpath. Bumped to `0.4.0`.
  - ☑ **T-1.4e** Ported `src/composition/*` at `packages/domain/src/composition/`. `forkSkill`, `copySkill`, `createComposition`, `extendComposition`, `publishComposition`, `getAncestry`, `getForks`, `getDependents`, `getCompositionBySlug` — every write-side function now takes a `CompositionAdapters { pool, embedQueue, scanQueue }` bundle instead of `Env`. Both queues consumed via the existing `QueueAdapter<T>` port with typed payloads (`EmbedQueueMessage`, `CogniumScanQueueMessage`). Zod input validators (`forkInputSchema`, `copyInputSchema`, `compositionInputSchema`, `extendInputSchema`) ported verbatim. Typed errors (`NotFoundError`, `ValidationError`) centralized at `composition/errors.ts`. `getCompositionBySlug` accepts an optional `shareUrlHost` so non-mothership consumers can override the `https://skillsregistry.net` default. New deps: `nanoid ^5.1.6`, `zod ^3.23.0` (direct — was already transitive). Exposed via `@skillsregistry/domain/composition` subpath. Bumped to `0.6.0`.
  - ☑ **T-1.4f** Ported `src/cognium/scoring-policy.ts` at `packages/domain/src/scoring/policy.ts`. Delivered ahead of T-1.4e because composition (fork) needs `BASE_TRUST` for the source-provenance floor. `BASE_TRUST` + `MAX_TRUST` tables verbatim; `computeTrustScore`, `capTrustBySource`, `deriveStatus`, `deriveTier`, `clampTrust`, `buildRemediationMessage` verbatim. D2 signature helpers refactored to take a plain numeric `penalty` instead of `Env` — mothership computes it once at boot via the exported `parsePositiveFloat(env.TRUST_SIGNATURE_REVOKED_PENALTY_POINTS, DEFAULT_SIGNATURE_REVOKED_PENALTY)` and passes the number to `applyRevocationScoring(pool, keyId, penalty)`. New domain types at `types.ts`: `CircleIRAnalysisPhase`, `ScanFinding`, `SkillRow`. Exposed via `@skillsregistry/domain/scoring` subpath. Bumped to `0.5.0`.
- ☐ **T-1.5** Extract `@skillsregistry/mcp` — move `src/mcp/*` handlers + discovery + invocation writer. Ensure handlers delegate to `@skillsregistry/domain` services, not to route implementations. Publish `1.0.0`.
- ☐ **T-1.6** Extract `@skillsregistry/eval` — move `src/eval/fixtures/*`, runner, metrics, CLI. Runner must accept `--endpoint` URL + auth header. Publish `1.0.0` (fixtures dated).
- ☐ **T-1.7** Mothership migration PR: consume all six packages from npm, delete inlined copies, run eval — R@5 ≥ 80% required to merge. (Landed in `cogniumhq/skillsregistry`, tracked here as a coordination dependency.)

## Phase 2 — Local app (`apps/local`)

- ☐ **T-2.1** Scaffold `apps/local/` — `package.json`, `tsconfig.json`, `src/index.ts` stub, `Dockerfile`, `docker-compose.yml`
- ☐ **T-2.2** Implement Node adapters:
  - `pg-kv.ts` — `KvAdapter` over a `kv_store` table (key TEXT PK, value TEXT, expires_at TIMESTAMPTZ)
  - `pg-queue.ts` — `QueueAdapter` (in-memory for MVP; Postgres LISTEN/NOTIFY deferred)
  - `fs-artifact.ts` — `ArtifactAdapter` over `./data/artifacts/`
  - `ollama-embedder.ts` — `EmbedderAdapter` → `OLLAMA_URL`
  - `upstream-embedder.ts` — `EmbedderAdapter` → mothership (budgeted, via `upstream-client`)
  - `node-after-response.ts` — `AfterResponse` via `setImmediate`
- ☐ **T-2.3** Wire Hono + `@hono/node-server` in `src/index.ts`. Register public routes + admin routes + `/mcp`. Instantiate `SearchService`, `CompositionService`, `McpService` with adapters.
- ☐ **T-2.4** Config module (`src/config.ts`) — parse env vars, sensible defaults, boot-time validation. Document every var in code + `README.md`.
- ☐ **T-2.5** Schema-version guard — startup script queries `schema_migrations` table, compares to `@skillsregistry/schema`'s `SCHEMA_VERSION`, exits with clear message on mismatch.
- ☐ **T-2.6** Migration runner — on boot, run pending migrations from `@skillsregistry/schema` against local Postgres. Log applied migrations. Idempotent.
- ☐ **T-2.7** Implement `upstream-client.ts`:
  - Trust score: `POST /v1/trust/score`
  - Leaderboard proxy: `GET /v1/leaderboards/*`
  - Skill fetch: `GET /v1/skills/:id` (fallback path)
  - Migration publish: `POST /v1/publish`
  - Budget query: `GET /v1/tenant/budget`
  - Delta pull: `GET /v1/sync/trust-scores?since=...` (nightly cron)
  - Per-tenant rate limiter (token bucket, env-configurable)
  - Circuit breaker (from `@skillsregistry/domain/resilience`)
  - Typed error mapping — every upstream failure → `UpstreamError` subclass
- ☐ **T-2.8** Implement `trust-client.ts` — budget-aware wrapper around `upstream-client.trustScore`. Persists results, surfaces `tokens_remaining`.
- ☐ **T-2.9** Budget meter (`src/budget/meter.ts`) — nightly cron via `node-cron` polling `GET /v1/tenant/budget`, cache in `kv_store`, expose via `GET /v1/admin/budget`. Structured warning event on <10% threshold.
- ☐ **T-2.10** Migration door (`src/migration/publish-to-mothership.ts`) — `POST /v1/migrate/publish?skill_id=...`. Read local, call upstream, update local row, return mothership ID.
- ☐ **T-2.11** Public routes (`src/routes/public/*`):
  - `GET /v1/search` — local pgvector search + confidence gate + optional upstream fallback (env-gated)
  - `GET /v1/skills/:id` — local first, upstream write-through cache
  - `POST /v1/skills` — publish local skill (single-tenant)
  - `GET /v1/leaderboards/*` — proxy to mothership
  - `POST /v1/trust/score?skill_id=...` — trigger trust scoring via mothership
  - `GET /v1/health` — liveness (checks DB + Ollama connectivity)
- ☐ **T-2.12** Admin routes (`src/routes/admin/*`) — protected by `ADMIN_TOKEN` bearer:
  - `GET /v1/admin/budget` — current cached budget
  - `POST /v1/admin/budget/refresh` — force upstream budget query
  - `GET /v1/admin/health` — deep health (DB, Ollama, mothership reachability, migration state)
  - `POST /v1/migrate/publish` — the migration door
- ☐ **T-2.13** `/mcp` endpoint — mount `@skillsregistry/mcp` handlers over Hono. Ensure `list_leaderboard` proxies upstream. Invocation writer wired through `AfterResponse`.
- ☐ **T-2.14** `/.well-known/mcp.json` discovery — advertises local node's URL + tool list.
- ☐ **T-2.15** Structured logging — pick `pino` (or alternative), wire request IDs, log every route + every upstream call.
- ☐ **T-2.16** Docker Compose (`docker-compose.yml`) — Postgres 16 (pgvector), Ollama, app. Volumes for Postgres data + Ollama models. `.env` file support.
- ☐ **T-2.17** Dockerfile — multi-stage build, non-root user, health check, entrypoint script running migrations before starting the server.
- ☐ **T-2.18** Air-gap smoke test — with `MOTHERSHIP_URL` unset, verify `/v1/search`, `/mcp`, `POST /v1/skills` work; `POST /v1/trust/score` returns 503 with `{ reason: "upstream_not_configured" }`.

## Phase 3 — Admin web UI (`apps/local/web/`)

- ☐ **T-3.1** Scaffold Astro + `@astrojs/node` — `apps/local/web/`
- ☐ **T-3.2** Auth middleware — read `ADMIN_TOKEN` from env, guard all routes
- ☐ **T-3.3** Dashboard page (`/`) — node health, budget gauge, recent activity
- ☐ **T-3.4** Skills page (`/skills`) — list locally-published skills, publish new manifest
- ☐ **T-3.5** Budget page (`/budget`) — full budget details, refresh button, upgrade link
- ☐ **T-3.6** Migration page (`/migration`) — table of local skills with per-row "Publish to mothership" action
- ☐ **T-3.7** MCP wiring page (`/mcp`) — local MCP endpoint URL + curl snippet for agent hookup
- ☐ **T-3.8** Design tokens — match mothership palette (emerald on near-black); see mothership `web/src/styles/global.css`

## Phase 4 — Release + docs

- ☐ **T-4.1** README quickstart — from `git clone` to `docker compose up` to first `/v1/search` response. Include registration flow (get tenant + API key from mothership).
- ☐ **T-4.2** Docker image tag `ghcr.io/cogniumhq/skillsregistry-local:1.0.0` published via CI on version tag
- ☐ **T-4.3** SDK packages published to npm at `1.0.0` (from Phase-1 tasks, verified from consumer side)
- ☐ **T-4.4** Mothership repo has zero inlined copies of extracted modules — audit + confirm
- ☐ **T-4.5** Announcement + public preview — coordinated with marketing (out of scope of this repo but tracked)

## Cross-cutting / continuously open

- ☐ **T-C.1** Eval R@5 stays ≥ 75% on local endpoint (5-point regression budget from mothership baseline)
- ☐ **T-C.2** Every `packages/*` PR carries a changeset — CI enforces
- ☐ **T-C.3** Every route in `apps/local` has a Zod contract in `@skillsregistry/contracts`
- ☐ **T-C.4** Every upstream call site goes through `upstream-client` — no fetches to `api.skillsregistry.net` elsewhere in `apps/local`

## Deferred to post-MVP

Not tracked as tasks — recorded so future planners see the boundary:

- Multi-tenant local install
- Local Circle-IR scan (all scoring goes through mothership)
- Local sync workers (mothership crawls; local doesn't)
- Enterprise SSO / SAML in admin UI
- Publisher signing PKI local key-management UI
- Bulk migration door (`/v1/migrate/publish-all`)
- Cross-region replication of local install
- Backwards-compat with pre-`1.0.0` SDK versions

---

*Update this file as work lands. Move completed items above the phase-4 fold to keep the file scannable.*
