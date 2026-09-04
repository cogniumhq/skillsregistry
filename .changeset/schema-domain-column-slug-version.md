---
"@skillsregistry/schema": minor
---

Migration 0037: add `skills.domain TEXT` (+ `idx_skills_domain`) so the shared schema carries the mothership's derived application-domain facet and `@skillsregistry/domain` can express a `domains` search filter without referencing a one-sided column. `SCHEMA_VERSION` 36 → 37. Drizzle `skills` now models the live constraints: `slug` is no longer `.unique()`; `skills_slug_version_key` is a `uniqueIndex` on `(slug, version)` (migration 0036 / #94) and the redundant `idx_skills_slug_version` entry is gone.
