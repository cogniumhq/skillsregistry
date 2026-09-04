---
"@skillsregistry/domain": minor
---

Search filters: `PgVectorProvider` now owns the `unlisted` rule — search never returns `unlisted` rows (direct-lookup-only per migration 0035), so consumers no longer post-filter; the default visibility clause is the full 4-band owner set (`private`, `tenant_private`, `tenant_internal`) and an explicit non-public band is scoped to the caller's tenant. New additive facet filters `categories?: string[]` (matches `category` or any `categories[]`) and `domains?: string[]` (matches `domain`, schema 0037) on `SearchFilters` / `FindSkillOptions` — OR within a dimension, AND across (sr#30). New `APPETITES` runtime list beside the `Appetite` type for edge validation.
