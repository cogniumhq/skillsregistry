# @skillsregistry/schema

## 1.2.0

### Minor Changes

- ece1aa7: Migration 0037: add `skills.domain TEXT` (+ `idx_skills_domain`) so the shared schema carries the mothership's derived application-domain facet and `@skillsregistry/domain` can express a `domains` search filter without referencing a one-sided column. `SCHEMA_VERSION` 36 → 37. Drizzle `skills` now models the live constraints: `slug` is no longer `.unique()`; `skills_slug_version_key` is a `uniqueIndex` on `(slug, version)` (migration 0036 / #94) and the redundant `idx_skills_slug_version` entry is gone.
- 2310e0d: Migration 0036: replace `UNIQUE(slug)` with `UNIQUE(slug, version)` so the local node can publish multiple versions of the same skill (parity with mothership migration 0041 / specifika V6.1). Under the old bare slug-unique constraint there was no supported path to publish a new version — `POST /v1/skills` returned 400 `unique_violation`. Drops the now-redundant `idx_skills_slug_version` (the new constraint's backing index covers it). `SCHEMA_VERSION` 35 → 36. Fixes #42.

## 1.1.0

### Minor Changes

- 031265b: Add top-level `sandbox jsonb` column via migration `0034_sandbox_contract.sql` and bump `SCHEMA_VERSION` 33 → 34. Additive, no data migration; pre-v1.3 `agent_profile` column stays in place per append-only. The new column carries the skill-convention v1.3 §9 sandbox contract (`image`, `memory_mb`, `cpu`, `timeout_seconds`, `egress[]`, plus optional `profile` + `budget_caps` for agent skills) — validated at ingest by `SkillSandboxSchema` in `@skillsregistry/contracts`. Applies to every runtime_env with a sandbox surface (vm + agent + api). Unblocks per-skill Lane 0 image pinning.
- 0fa154b: Expand `chk_visibility` CHECK constraint to the four tenant-scope bands per cortex.md §16.6 (migration `0035_visibility_bands.sql`). Old set {`public`, `private`, `unlisted`} becomes {`public`, `private`, `tenant_private`, `tenant_internal`, `unlisted`}. `private` kept as a legacy alias so pre-v6.3 rows keep parsing; new writes should prefer `tenant_private` for tenant-wide and `tenant_internal` for user-scoped-within-tenant. Drop-then-add is atomic under a brief table-level lock; no data migration since the old set is a strict subset of the new. `SCHEMA_VERSION` 34 → 35.

## 1.0.0

### Major Changes

- 6f1f241: Initial release of `@skillsregistry/schema`.

  Extracts the Drizzle schema (`src/db/schema.ts`) and 32 migration SQL
  files (`0001` → `0032`) from the mothership into a runtime-agnostic
  SDK package. Adds `SCHEMA_VERSION`, a `runMigrations()` runner that
  accepts any `pg`-compatible client, and `assertSchemaAtLeast()` for
  boot-time fail-fast on outdated DBs.

  This is the first shared release — mothership and local node will
  consume this package instead of maintaining inlined copies.

### Patch Changes

- 749f168: Unit test coverage for the migration runner + `SCHEMA_VERSION`
  constant. 19 tests covering:

  - `loadBundledMigrations()` — sort order, version-prefix parsing,
    populated `{ version, name, sql }` on every entry.
  - `readAppliedMigrations()` — `schema_migrations` DDL runs then
    read query (`ORDER BY version ASC`); empty-set fallback.
  - `runMigrations()` — apply order on a fresh DB (BEGIN/sql/INSERT/
    COMMIT loop), idempotency against already-recorded versions,
    rollback with `.cause` chain when a migration body throws.
  - `assertSchemaAtLeast()` — pass at `>=`, throw at `<`, Postgres
    string-`v` coalesce quirk, empty rows treated as version 0.
  - `SCHEMA_VERSION` — matches the highest bundled `NNNN_*.sql` file
    number and the last entry from `loadBundledMigrations()`.

  Package now above the 80% publish gate.
