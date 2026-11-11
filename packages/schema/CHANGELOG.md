# @skillsregistry/schema

## 1.2.2

### Patch Changes

- 392ba31: Dependency bumps, no public API change. `@types/node` 22.20.3 → 22.20.5 across all six packages; `@skillsregistry/schema` also takes `drizzle-orm` 0.45.2 → 0.45.3 (patch within the 0.45 line already adopted in #151, schema definitions unchanged).

  App-level in the same change, not published so not listed above: `hono` 4.13.8 → 4.13.12, `pg` 8.23.0 → 8.23.1, `tsx` 4.23.13 → 4.23.15, `astro` 7.3.3 → 7.3.5, `jsdom` 30.1.0 → 30.1.1.

  The `astro` bump is the one that matters beyond housekeeping: it pulls `http-cache-semantics` 4.2.0 → 4.3.0, which clears **GHSA-ch52-4w7c-c8xp** (high — `max-stale` handling can disclose cross-user cached responses). That advisory is what fails `pnpm audit:prod` on `main`, and therefore on every PR that does not itself carry this lockfile.

- fa39b67: Dependency bumps, no public API change. `@skillsregistry/domain` takes nanoid 6.0.1 → 6.0.2. `@skillsregistry/schema` takes drizzle-orm 0.45.3 → 0.45.4.

  App-level in the same change, not published: hono 4.13.12 → 4.13.13, astro 7.3.5 → 7.3.8, jsdom 30.1.1 → 30.1.2. The cognium-dev action pin moves from v4.9.26 to v4.13.2.

  Root `pnpm.overrides` pins `source-map-js` to 1.2.2 so the production audit clears GHSA-68fv-2mgg-jv7q (1.2.1, pulled in by Tailwind and Vite).

## 1.2.1

### Patch Changes

- 07be7d7: Bump drizzle-orm 0.36 → 0.45. Schema definitions are unchanged; 0.45.2 includes the `sql.identifier()` / `sql.as()` identifier-escaping fix (CWE-89).
- cb6c3f6: Remove internal infrastructure hostnames and private-repo paths from published
  package contents.

  Internal hostnames appeared in the domain README and in source comments;
  `.specifica/...` paths appeared in several comments and in the
  `0025_mcp_invocations.sql` migration header. All are replaced with
  neutral wording.

  No API, type, runtime default or behaviour changes — every occurrence was a
  comment, a README line, or a test URL, never a functional default. This is a
  patch only because these packages publish `README.md` (and, for schema, the
  `.sql` file) inside the tarball, so the artifact contents genuinely differ.

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
