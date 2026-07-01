# SkillsRegistry Local — Principles

Cross-cutting rules. Not version-bound. Cite directly; do not paraphrase.

---

## Repository posture

- **This repo is Apache-2.0, top to bottom.** SDK packages, local app, admin UI, Docker assets, docs — all one license. No per-package overrides.
- **The mothership is a separate proprietary repo.** `cogniumhq/skillsregistry` consumes `@skillsregistry/*` from npm. Nothing here assumes access to mothership internals; all interaction is via the public HTTP API defined in `@skillsregistry/contracts`.
- **Two audiences, one repo.** SDK packages serve both this repo's `apps/local` and the mothership. The local app is the reference consumer — if the SDK is awkward here, the SDK is wrong.

## Ports and adapters

- **`@skillsregistry/domain` is runtime-neutral.** No `env.*`, no `c.executionCtx`, no Node-vs-Workers assumptions. Everything runtime-coupled goes through an adapter interface declared in `@skillsregistry/domain`.
- **Adapter interfaces are the contract.** `KvAdapter`, `QueueAdapter`, `ArtifactAdapter`, `EmbedderAdapter`, `AfterResponse`. Each consumer (local app, mothership) supplies its own implementations. Breaking one means major-bumping the domain package.
- **The `SearchProvider` interface is the search abstraction line.** Postgres / pgvector types never leak past `@skillsregistry/domain/providers/pgvector-provider.ts`. Callers above the provider work with the provider interface only.
- **The intelligence layer sits above the provider.** Confidence gating, LLM fallback, and reranking are provider-agnostic.

## Upstream isolation (local app)

- **`apps/local/src/upstream-client.ts` is the only module that talks to `api.skillsregistry.net`.** Trust scoring, global leaderboards, skill fallback fetch, publish-up, delta sync — all funnel through it. Everything else in `apps/local` is offline-clean.
- **Air-gap must always be a supported mode.** With `MOTHERSHIP_URL` unset, search + MCP + composition + local publish keep working. Endpoints that require upstream return `402 Payment Required` (budget) or `503 Service Unavailable` (no upstream configured) with a machine-readable reason — never crash the request path.
- **Every upstream call is budgeted and circuit-broken.** No unbounded fan-out. Per-tenant rate limit and circuit breaker on the client.

## Data model

- **Single-tenant per install.** `TENANT_ID` is an env var baked at deploy time. No tenant-lookup middleware in `apps/local`. The `tenant_id` column stays in the schema for migration-compat, but every row has the same value.
- **`@skillsregistry/schema` is the single physical shape.** Local populates a subset of columns; mothership populates the full set. No schema fork, no local-only tables, no mothership-only tables.
- **Migrations are append-only.** Never edit a landed migration. Both apps must run every migration in order on a fresh DB.
- **Schema-version guard on boot.** Local refuses to boot if its `@skillsregistry/schema` version can't talk to the mothership's expected version. Prevents silent data corruption from year-old local nodes.

## Signal model

- **Human and agent signals stay separate.** Inherited from mothership principles. Different populations, different priors, different noise. Fusing them into one composite is forbidden.
- **Derived artifacts are idempotent.** Embedding, summarization, and trust scoring all support safe re-run. Re-embedding the same content yields the same vector; re-scoring the same evidence yields the same score within tolerance.

## Inference cost

- **Query-time over index-time for LLM-shaped work.** Per-skill LLM expansion at ingest is forbidden unless it provably amortizes. Use cross-encoder rerank at query time instead.
- **Metered inference is rate-capped.** All upstream trust-scoring calls carry per-tenant rate limit and circuit breaker. No unbounded fan-out, ever.
- **Local Ollama is the default embedder.** Users pay their own compute, no upstream call per query. `EMBEDDING_PROVIDER=mothership` is opt-in and budgeted.

## Configuration

- **No magic numbers.** Every threshold — tier boundaries, fusion weights, cache TTLs, rate limits, reranker top-k, budget alerts — is env-var configurable with a default in code.
- **Defaults are documented.** Each env var has its default and meaning in `spec.md` or `design.md`; the value shipped by Docker Compose lives in `apps/local/docker-compose.yml`.

## Observability

- **Logging is non-blocking.** All writes to `search_logs`, `quality_feedback`, and monitoring tables go through `AfterResponse.defer(...)`. Never inline-await observability writes — they must never extend request latency.
- **Eval before and after every change.** The eval suite (`@skillsregistry/eval`) produces numbers; numbers gate the change. No "feels better."

## Naming and identity

- **Retired terms stay retired.** `Runics` never appears in new code, docs, env vars, package names, or Docker tags in this repo.
- **Package namespace is `@skillsregistry/*`.** No `@runics/*`, no `@cognium/skills-*` (that scope belongs to first-party skill packages in `cognium-skills`).
- **Spec is the source of truth.** When code and `spec.md` disagree, the spec wins and the code is a task in `tasks.md`.

## Cross-repo coordination

- **Sacred boundary.** Work stays inside `~/work/cogniumhq/skillsregistry-local/`. No edits to sibling repos from this project's sessions.
- **Mothership consumption is a coordination ask, not a direct edit.** A new SDK version → PR here → npm publish → separate PR in `cogniumhq/skillsregistry` bumping the pin.
- **Public API contract stability.** Breaking `@skillsregistry/contracts` means major-bump AND coordinated PR in mothership. Both must land before either is deployed.

## Release discipline

- **Changesets for every SDK-package change.** No exceptions. CI blocks merges without them.
- **Exact-version pins downstream.** Mothership pins `"@skillsregistry/schema": "1.0.0"` (not `"^1.0.0"`). Otherwise API contracts drift silently.
- **Semver strict.**
  - `@skillsregistry/schema` — major for column rename/drop or breaking migration; minor for additive columns; patch for index/comment.
  - `@skillsregistry/contracts` — major for field rename or required-field addition; minor for new optional fields.
  - `@skillsregistry/domain` — major for adapter interface changes; minor for logic additions.
  - `@skillsregistry/mcp` — major for tool I/O changes; minor for new tools.
  - `@skillsregistry/eval` — no semver; fixtures dated.
- **Local app version is independent.** Docker tags (`ghcr.io/cogniumhq/skillsregistry-local:vX.Y.Z`) move on their own cadence.

---

*Authoritative for cross-cutting rules. Version-specific intent lives in the per-version `spec.md` / `design.md` / `tasks.md`.*
