// ══════════════════════════════════════════════════════════════════════════════
// @skillsregistry/schema — Drizzle schema + migration runner
// ══════════════════════════════════════════════════════════════════════════════
//
// Public surface:
//
//   - `schema` re-exports Drizzle table definitions (skills, embeddings,
//     compositions, invocations, publisher keys, MCP invocations, …). Import
//     the tables you need for type-safe queries.
//   - `SCHEMA_VERSION` — the highest migration number bundled in this SDK
//     version. Consumers assert the DB is at least at this version.
//   - `runMigrations()` / `loadBundledMigrations()` / `assertSchemaAtLeast()`
//     — the migration runner primitives.
//
// The runner is runtime-agnostic: any client implementing `query(sql, values)`
// works (node-postgres Pool, PoolClient, Neon serverless).
//
// ══════════════════════════════════════════════════════════════════════════════

export * as schema from './schema.js';
export { SCHEMA_VERSION } from './version.js';
export type {
  Migration,
  AppliedMigration,
  RunMigrationsResult,
  SqlClient,
} from './runner.js';
export {
  loadBundledMigrations,
  readAppliedMigrations,
  runMigrations,
  assertSchemaAtLeast,
} from './runner.js';
