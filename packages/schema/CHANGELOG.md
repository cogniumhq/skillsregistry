# @skillsregistry/schema

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
