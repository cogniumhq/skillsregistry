// ══════════════════════════════════════════════════════════════════════════════
// Migration runner — applies pending `NNNN_*.sql` files against a Postgres pool.
// ══════════════════════════════════════════════════════════════════════════════
//
// Design intent:
//
//   - Runtime-agnostic. Accepts any `pg`-compatible client (node-postgres
//     Pool, PoolClient, or Neon serverless). The caller decides which driver.
//   - Idempotent. Records each applied file's number in a `schema_migrations`
//     table. Reruns skip anything already recorded.
//   - Fail-loud. A single file failure aborts the run; the transaction for
//     that file is rolled back and the error is rethrown.
//   - No file-system coupling in this module. The caller loads the SQL text
//     from wherever it makes sense (bundled fixtures, `fs.readFile`, etc.)
//     and passes an array of `{ version, name, sql }`. This keeps the runner
//     usable in bundled environments and lets the calling app pick its own
//     file discovery strategy.
//
// See `loadBundledMigrations()` for the convenience helper that reads the
// migrations shipped inside this package.
//
// ══════════════════════════════════════════════════════════════════════════════

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface Migration {
  /** Numeric version, parsed from the leading digits of the filename. */
  version: number;
  /** Filename, e.g. `0001_skill_embeddings.sql`. */
  name: string;
  /** Raw SQL text. */
  sql: string;
}

export interface AppliedMigration {
  version: number;
  name: string;
  appliedAt: Date;
}

/**
 * Minimal client interface — matches both `pg.Pool` and `pg.PoolClient`.
 * The runner never assumes a specific driver.
 */
export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

const MIGRATION_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;

/**
 * Load the SQL migration files bundled inside this package.
 * The array is sorted ascending by version.
 */
export async function loadBundledMigrations(): Promise<Migration[]> {
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, 'migrations');
  const files = (await readdir(dir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const out: Migration[] = [];
  for (const name of files) {
    const version = parseVersion(name);
    if (version === null) {
      throw new Error(
        `[schema] migration filename does not start with a version number: ${name}`,
      );
    }
    const sql = await readFile(join(dir, name), 'utf8');
    out.push({ version, name, sql });
  }
  return out;
}

/**
 * Read the list of already-applied migrations. Creates the `schema_migrations`
 * table if it does not exist.
 */
export async function readAppliedMigrations(
  client: SqlClient,
): Promise<AppliedMigration[]> {
  await client.query(MIGRATION_TABLE_DDL);
  const { rows } = await client.query(
    'SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC',
  );
  return rows.map((r) => {
    const row = r as { version: number; name: string; applied_at: Date };
    return {
      version: row.version,
      name: row.name,
      appliedAt: row.applied_at,
    };
  });
}

export interface RunMigrationsResult {
  applied: Migration[];
  skipped: Migration[];
  finalVersion: number;
}

/**
 * Apply every migration whose version is greater than the highest already-
 * applied version. Each file runs inside its own transaction.
 *
 * The runner is **append-only**: it never re-runs, edits, or rolls back a
 * migration that is already in `schema_migrations`. If you need to change
 * an old migration, add a new one.
 */
export async function runMigrations(
  client: SqlClient,
  migrations: Migration[],
): Promise<RunMigrationsResult> {
  const applied = await readAppliedMigrations(client);
  const appliedVersions = new Set(applied.map((m) => m.version));
  const sorted = [...migrations].sort((a, b) => a.version - b.version);

  const skipped: Migration[] = [];
  const appliedNow: Migration[] = [];

  for (const migration of sorted) {
    if (appliedVersions.has(migration.version)) {
      skipped.push(migration);
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(migration.sql);
      await client.query(
        'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
        [migration.version, migration.name],
      );
      await client.query('COMMIT');
      appliedNow.push(migration);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(
        `[schema] migration ${migration.name} failed: ${(err as Error).message}`,
        { cause: err },
      );
    }
  }

  const finalVersion =
    sorted.length > 0 ? sorted[sorted.length - 1]!.version : 0;

  return { applied: appliedNow, skipped, finalVersion };
}

/**
 * Assert that the database is at least at the version this SDK expects.
 *
 * Consumers call this at boot after `runMigrations()` (or after connecting to
 * a DB whose migrations they manage externally) to fail-fast on an outdated
 * schema.
 */
export async function assertSchemaAtLeast(
  client: SqlClient,
  requiredVersion: number,
): Promise<void> {
  await client.query(MIGRATION_TABLE_DDL);
  const { rows } = await client.query(
    'SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations',
  );
  const row = (rows[0] as { v: number | string } | undefined) ?? { v: 0 };
  const current = typeof row.v === 'string' ? parseInt(row.v, 10) : row.v;
  if (current < requiredVersion) {
    throw new Error(
      `[schema] DB is at schema version ${current}, ` +
        `SDK requires ${requiredVersion}. Run migrations before starting.`,
    );
  }
}

function parseVersion(filename: string): number | null {
  const match = filename.match(/^(\d+)_/);
  if (!match) return null;
  return parseInt(match[1]!, 10);
}
