---
'@skillsregistry/domain': minor
---

T-1.4d: Port `src/intelligence/*` from mothership behind runtime-agnostic adapters.

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
