---
'@skillsregistry/domain': patch
---

`PgVectorProvider.vectorSearch` restructured to KNN-first (the X8 fix).

The previous shape (`SELECT DISTINCT ON (s.slug) ... ORDER BY s.slug, version_rank DESC, dist ASC`) forced Postgres to compute the halfvec `<=>` distance for every row in `skill_embeddings` on every uncached query — a parallel seq scan + sort — because HNSW returns rows in *distance* order but `DISTINCT ON (s.slug)` needed *slug* order first. Measured against a ~102K-row prod corpus: **6432ms vs 143ms** for the same top-K done index-first (~45× penalty on the dominant cost of every cold search).

Fix: the query now pulls the top-K nearest candidates in a CTE (HNSW-served), then dedups by slug + applies the `s.*` filters on the small candidate set. `s.tenant_id IN ($1, 'default')` and the embedding NOT-NULL guard are inlined in the CTE where they're cheap. `s.*` filters (status / minTrust / contentSafety / executionLayer / category / tags / visibility / runtimeEnv / portable) remain post-join. Result shape, filter semantics, and best-version-per-slug ordering are byte-identical.

Candidate budget defaults to 200 (LIMIT on the CTE) — pgvector's `hnsw.ef_search` (default 40) is the real bound on how many rows the index returns; the LIMIT is a generous ceiling so that raising `ef_search` globally lets the extra candidates flow through automatically. A per-query `SET LOCAL hnsw.ef_search` was tried and dropped — the ~130ms of extra round-trips over Hyperdrive outweighed the recall gain.

Retires the `patchFastVectorSearch` runtime instance-override that lived in `cogniumhq/sr/src/providers/fast-vector-search.ts` since 2026-07-16 (prod deploy `82e87959`). The sr repo bumps this pin and deletes the override + its two call sites in the same close-out.
