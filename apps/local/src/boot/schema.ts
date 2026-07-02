// ══════════════════════════════════════════════════════════════════════════════
// Schema boot — T-2.5 (version guard) + T-2.6 (migration runner).
// ══════════════════════════════════════════════════════════════════════════════
//
// One entry point (`bootSchema`) does both jobs so the ordering — apply
// pending migrations, *then* assert the DB is at least at `SCHEMA_VERSION` —
// is enforced in one place. Callers that manage migrations externally (a
// Kubernetes init container, a DBA-run script) can pass
// `{ applyMigrations: false }` to run the guard alone.
//
// The runner primitives live in `@skillsregistry/schema`; this module is a
// thin orchestrator + structured-logging surface.
//
// ══════════════════════════════════════════════════════════════════════════════

import {
  SCHEMA_VERSION,
  assertSchemaAtLeast,
  loadBundledMigrations,
  runMigrations,
  type Migration,
  type SqlClient,
} from '@skillsregistry/schema';

export interface BootSchemaOptions {
  /**
   * When true (default), any migration bundled in `@skillsregistry/schema`
   * whose version is greater than the highest recorded in `schema_migrations`
   * is applied inside its own transaction.
   *
   * When false, migrations are the operator's responsibility; only the
   * version guard runs.
   */
  applyMigrations?: boolean;

  /**
   * Optional override for the migration set. Handy for tests or for consumers
   * that want to bundle their own migrations on top of the SDK set.
   * Defaults to `loadBundledMigrations()`.
   */
  migrations?: Migration[];

  /**
   * Logging sink. Defaults to `console`.
   */
  logger?: BootLogger;
}

export interface BootLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface BootSchemaResult {
  /** Migrations applied in this boot. */
  appliedCount: number;
  /** Migrations that were already recorded before this boot. */
  skippedCount: number;
  /** Highest version now present in the DB. */
  currentVersion: number;
  /** `SCHEMA_VERSION` from `@skillsregistry/schema`. */
  requiredVersion: number;
}

/**
 * Apply pending migrations then assert the DB is at least at the version this
 * SDK requires. Throws on any migration error or version-mismatch — callers
 * should treat any throw as fatal-at-boot.
 */
export async function bootSchema(
  client: SqlClient,
  options: BootSchemaOptions = {},
): Promise<BootSchemaResult> {
  const applyMigrations = options.applyMigrations !== false;
  const logger = options.logger ?? consoleLogger;

  logger.info('[schema] boot: starting', {
    applyMigrations,
    requiredVersion: SCHEMA_VERSION,
  });

  let appliedCount = 0;
  let skippedCount = 0;

  if (applyMigrations) {
    const migrations = options.migrations ?? (await loadBundledMigrations());
    const result = await runMigrations(client, migrations);
    appliedCount = result.applied.length;
    skippedCount = result.skipped.length;

    for (const m of result.applied) {
      logger.info(`[schema] applied ${m.name}`, { version: m.version });
    }
    if (appliedCount === 0) {
      logger.info('[schema] no pending migrations', {
        skippedCount,
      });
    }
  } else {
    logger.info('[schema] skipping migration apply (managed externally)');
  }

  await assertSchemaAtLeast(client, SCHEMA_VERSION);

  const currentVersion = await readCurrentVersion(client);

  logger.info('[schema] boot: complete', {
    appliedCount,
    skippedCount,
    currentVersion,
    requiredVersion: SCHEMA_VERSION,
  });

  return {
    appliedCount,
    skippedCount,
    currentVersion,
    requiredVersion: SCHEMA_VERSION,
  };
}

async function readCurrentVersion(client: SqlClient): Promise<number> {
  const { rows } = await client.query(
    'SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations',
  );
  const row = (rows[0] as { v: number | string } | undefined) ?? { v: 0 };
  return typeof row.v === 'string' ? Number.parseInt(row.v, 10) : row.v;
}

const consoleLogger: BootLogger = {
  info: (m, meta) =>
    console.log(m, meta ? JSON.stringify(meta) : ''),
  warn: (m, meta) =>
    console.warn(m, meta ? JSON.stringify(meta) : ''),
  error: (m, meta) =>
    console.error(m, meta ? JSON.stringify(meta) : ''),
};
