---
"@skillsregistry/contracts": patch
---

Zod round-trip unit tests for every exported schema. 83 tests
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
- Upstream contracts: `TrustScoreRequest` /  `TrustScoreResponse`
  with tier + score bounds, `BudgetResponse` plan enum, `PublishRequest`
  URL validation, `TrustScoreDelta` + `TrustScoreSyncResponse` with
  optional cursor, and `UpstreamErrorSchema` covering all 9 codes in
  the taxonomy plus retry-after bounds.

Package now above the 90% publish gate.
