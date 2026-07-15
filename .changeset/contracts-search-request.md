---
'@skillsregistry/contracts': minor
---

Ship `SearchRequestSchema` per cortex.md §6.2 (the SkillsRegistry mothership `POST /v1/search` contract): `{ query, tenant_id?, appetite?, min_trust?, allow_vulnerable?, limit?, tags?, category?, runtime_env?, visibility?, portable? }`. Wire naming is snake_case for parity with the rest of the upstream API surface.

Also ships two supporting enums as named schemas: `AppetiteSchema` (`strict | cautious | balanced | adventurous`) and `SkillVisibilitySchema` (the 4-band model — `public | private | tenant_private | tenant_internal | unlisted`). `SkillVisibilitySchema` matches `@skillsregistry/schema@1.1.0`'s expanded `chk_visibility` CHECK constraint; `private` is retained as a legacy alias.
