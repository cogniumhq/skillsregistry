---
"@skillsregistry/schema": minor
---

Migration 0036: replace `UNIQUE(slug)` with `UNIQUE(slug, version)` so the local node can publish multiple versions of the same skill (parity with mothership migration 0041 / specifika V6.1). Under the old bare slug-unique constraint there was no supported path to publish a new version — `POST /v1/skills` returned 400 `unique_violation`. Drops the now-redundant `idx_skills_slug_version` (the new constraint's backing index covers it). `SCHEMA_VERSION` 35 → 36. Fixes #42.
