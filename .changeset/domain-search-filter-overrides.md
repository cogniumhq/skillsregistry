---
'@skillsregistry/domain': minor
---

`FindSkillRequest` + `FindSkillOptions` gain optional `minTrust` (0..1) and `allowVulnerable` (boolean) fields per cortex.md §6.2. When set they override the appetite-derived defaults inside `ConfidenceGate.findSkill()`; when absent, `appetiteToTrustThreshold` / `appetiteToAllowVulnerable` continue to drive.

Also introduces the shared `SkillVisibility` union (`public | private | tenant_private | tenant_internal | unlisted`), replacing the previous 3-value inline union on `FindSkillRequest.visibility`, `FindSkillOptions.visibility`, and `SearchFilters.visibility`. Matches the migrated CHECK constraint in `@skillsregistry/schema@1.1.0` and the enum in `@skillsregistry/contracts@1.2.0`.
