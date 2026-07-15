---
'@skillsregistry/schema': minor
---

Expand `chk_visibility` CHECK constraint to the four tenant-scope bands per cortex.md §16.6 (migration `0035_visibility_bands.sql`). Old set {`public`, `private`, `unlisted`} becomes {`public`, `private`, `tenant_private`, `tenant_internal`, `unlisted`}. `private` kept as a legacy alias so pre-v6.3 rows keep parsing; new writes should prefer `tenant_private` for tenant-wide and `tenant_internal` for user-scoped-within-tenant. Drop-then-add is atomic under a brief table-level lock; no data migration since the old set is a strict subset of the new. `SCHEMA_VERSION` 34 → 35.
