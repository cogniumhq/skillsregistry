---
"@skillsregistry/schema": major
---

Initial release of `@skillsregistry/schema`.

Extracts the Drizzle schema (`src/db/schema.ts`) and 32 migration SQL
files (`0001` → `0032`) from the mothership into a runtime-agnostic
SDK package. Adds `SCHEMA_VERSION`, a `runMigrations()` runner that
accepts any `pg`-compatible client, and `assertSchemaAtLeast()` for
boot-time fail-fast on outdated DBs.

This is the first shared release — mothership and local node will
consume this package instead of maintaining inlined copies.
