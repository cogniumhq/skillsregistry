---
'@skillsregistry/domain': minor
---

T-1.4c: Port `src/providers/*` from mothership behind the domain's runtime-agnostic ports.

- Adds `SearchProvider` interface (verbatim port) and `PgVectorProvider` concrete implementation.
- Constructor drops CF `Env` dependency in favor of `PgVectorProviderOptions { pool: SqlPool, ...tuningKnobs }`. All ten tuning knobs (fusion mode, RRF k, tier thresholds, blend weights, trust-boost weights, candidate pool multiplier) exposed as typed optional fields with the mothership's defaults preserved.
- Introduces `SqlPool` / `SqlConnection` / `SqlClient` / `SqlQueryResult` ports in `packages/domain/src/adapters/sql.ts`. Structurally compatible with `pg.Pool` and `@neondatabase/serverless`, so consumers pass their driver's pool through unchanged.
- Adds search-facing domain types (`SkillInput`, `EmbeddingSet`, `SearchFilters`, `SearchOptions`, `SearchResult`, `ScoredSkill`, `ConfidenceSignal`, `SearchMeta`, plus the skill status / type / tier / badge unions) at `src/types.ts`.
- Adds `textNormSha256` + `normalizeText` at `src/ingestion/text-fingerprint.ts` (verbatim port) — used by the embed-cache gate to keep `skill_embeddings.text_norm_sha256` in lockstep with migration 0024.
- Ships new subpath exports: `@skillsregistry/domain/providers` and `@skillsregistry/domain/types`.

No behavioral changes to fusion, scoring, indexing, or transaction shape versus mothership. Consumers inject a `SqlPool` at boot; the domain code owns retrieval strategy end-to-end.
