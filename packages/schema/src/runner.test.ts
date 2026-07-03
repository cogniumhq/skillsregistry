// ══════════════════════════════════════════════════════════════════════════════
// runMigrations / readAppliedMigrations / assertSchemaAtLeast / loadBundledMigrations
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import {
  loadBundledMigrations,
  readAppliedMigrations,
  runMigrations,
  assertSchemaAtLeast,
  type Migration,
  type SqlClient,
} from './runner.js';

// ──────────────────────────────────────────────────────────────────────────────
// Doubles
// ──────────────────────────────────────────────────────────────────────────────

interface Call {
  sql: string;
  values?: unknown[];
}

interface ScriptStep {
  rows?: unknown[];
  throwOn?: boolean;
  error?: unknown;
}

/**
 * A scripted SqlClient. Each `client.query()` consumes one step from the
 * script; anything unscripted returns { rows: [] }.
 */
function scriptedClient(script: ScriptStep[] = []) {
  const calls: Call[] = [];
  let idx = 0;
  const client: SqlClient = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      const step = script[idx++];
      if (step?.throwOn) {
        throw step.error ?? new Error('scripted-error');
      }
      return { rows: step?.rows ?? [] };
    }),
  };
  return { client, calls };
}

// ──────────────────────────────────────────────────────────────────────────────
// loadBundledMigrations
// ──────────────────────────────────────────────────────────────────────────────

describe('loadBundledMigrations', () => {
  it('returns migrations sorted ascending by version', async () => {
    const migrations = await loadBundledMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    for (let i = 1; i < migrations.length; i++) {
      expect(migrations[i]!.version).toBeGreaterThan(migrations[i - 1]!.version);
    }
  });

  it('populates version + name + sql on every entry', async () => {
    const migrations = await loadBundledMigrations();
    for (const m of migrations) {
      expect(Number.isInteger(m.version)).toBe(true);
      expect(m.name).toMatch(/^\d+_.*\.sql$/);
      expect(typeof m.sql).toBe('string');
      expect(m.sql.length).toBeGreaterThan(0);
    }
  });

  it('parses the version prefix from each filename', async () => {
    const migrations = await loadBundledMigrations();
    for (const m of migrations) {
      const match = m.name.match(/^(\d+)_/);
      expect(match).not.toBeNull();
      expect(parseInt(match![1]!, 10)).toBe(m.version);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// readAppliedMigrations
// ──────────────────────────────────────────────────────────────────────────────

describe('readAppliedMigrations', () => {
  it('creates schema_migrations table then reads rows', async () => {
    const { client, calls } = scriptedClient([
      { rows: [] }, // CREATE TABLE IF NOT EXISTS
      {
        rows: [
          { version: 1, name: '0001_a.sql', applied_at: new Date('2026-01-01T00:00:00Z') },
          { version: 2, name: '0002_b.sql', applied_at: new Date('2026-01-02T00:00:00Z') },
        ],
      },
    ]);
    const rows = await readAppliedMigrations(client);
    expect(calls[0]!.sql).toContain('CREATE TABLE IF NOT EXISTS schema_migrations');
    expect(calls[1]!.sql).toContain(
      'SELECT version, name, applied_at FROM schema_migrations',
    );
    expect(calls[1]!.sql).toContain('ORDER BY version ASC');
    expect(rows).toEqual([
      { version: 1, name: '0001_a.sql', appliedAt: new Date('2026-01-01T00:00:00Z') },
      { version: 2, name: '0002_b.sql', appliedAt: new Date('2026-01-02T00:00:00Z') },
    ]);
  });

  it('returns empty array when nothing has been applied', async () => {
    const { client } = scriptedClient([{ rows: [] }, { rows: [] }]);
    const rows = await readAppliedMigrations(client);
    expect(rows).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// runMigrations
// ──────────────────────────────────────────────────────────────────────────────

const M1: Migration = { version: 1, name: '0001_a.sql', sql: 'CREATE TABLE a (id int);' };
const M2: Migration = { version: 2, name: '0002_b.sql', sql: 'CREATE TABLE b (id int);' };
const M3: Migration = { version: 3, name: '0003_c.sql', sql: 'CREATE TABLE c (id int);' };

describe('runMigrations — apply order', () => {
  it('applies all migrations to a fresh DB in ascending order', async () => {
    // 2 initial reads (DDL + SELECT applied) then 4 calls per migration:
    // BEGIN, migration.sql, INSERT tracking row, COMMIT
    const { client, calls } = scriptedClient([
      { rows: [] }, // MIGRATION_TABLE_DDL
      { rows: [] }, // SELECT applied
      // M1: BEGIN, sql, INSERT, COMMIT
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      // M2
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      // M3
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    const result = await runMigrations(client, [M3, M1, M2]);
    expect(result.applied).toEqual([M1, M2, M3]);
    expect(result.skipped).toEqual([]);
    expect(result.finalVersion).toBe(3);

    // Order of the migration-body SQL calls
    const bodySql = calls
      .filter((c) => c.sql.startsWith('CREATE TABLE'))
      .map((c) => c.sql);
    expect(bodySql).toEqual([M1.sql, M2.sql, M3.sql]);

    // INSERT tracking rows carry (version, name)
    const inserts = calls.filter((c) => c.sql.includes('INSERT INTO schema_migrations'));
    expect(inserts).toHaveLength(3);
    expect(inserts[0]!.values).toEqual([1, '0001_a.sql']);
    expect(inserts[1]!.values).toEqual([2, '0002_b.sql']);
    expect(inserts[2]!.values).toEqual([3, '0003_c.sql']);
  });
});

describe('runMigrations — idempotency', () => {
  it('skips migrations already recorded in schema_migrations', async () => {
    const { client, calls } = scriptedClient([
      { rows: [] }, // DDL
      {
        rows: [
          { version: 1, name: '0001_a.sql', applied_at: new Date('2026-01-01T00:00:00Z') },
          { version: 2, name: '0002_b.sql', applied_at: new Date('2026-01-02T00:00:00Z') },
        ],
      },
      // Only M3 will be applied — 4 more calls
      { rows: [] }, // BEGIN
      { rows: [] }, // sql
      { rows: [] }, // INSERT
      { rows: [] }, // COMMIT
    ]);
    const result = await runMigrations(client, [M1, M2, M3]);
    expect(result.applied).toEqual([M3]);
    expect(result.skipped).toEqual([M1, M2]);
    expect(result.finalVersion).toBe(3);
    // Only one BEGIN / COMMIT pair since the other two were skipped
    const begins = calls.filter((c) => c.sql === 'BEGIN');
    const commits = calls.filter((c) => c.sql === 'COMMIT');
    expect(begins).toHaveLength(1);
    expect(commits).toHaveLength(1);
  });

  it('is a no-op when every migration is already applied', async () => {
    const { client, calls } = scriptedClient([
      { rows: [] },
      {
        rows: [
          { version: 1, name: '0001_a.sql', applied_at: new Date() },
          { version: 2, name: '0002_b.sql', applied_at: new Date() },
        ],
      },
    ]);
    const result = await runMigrations(client, [M1, M2]);
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([M1, M2]);
    expect(result.finalVersion).toBe(2);
    // No BEGIN issued
    expect(calls.some((c) => c.sql === 'BEGIN')).toBe(false);
  });

  it('returns finalVersion=0 when the migrations array is empty', async () => {
    const { client } = scriptedClient([{ rows: [] }, { rows: [] }]);
    const result = await runMigrations(client, []);
    expect(result).toEqual({ applied: [], skipped: [], finalVersion: 0 });
  });
});

describe('runMigrations — rollback on failure', () => {
  it('rolls back the failing migration and re-throws with cause', async () => {
    const boom = new Error('duplicate column');
    const { client, calls } = scriptedClient([
      { rows: [] }, // DDL
      { rows: [] }, // SELECT applied
      // M1: BEGIN, sql — sql throws
      { rows: [] }, // BEGIN
      { throwOn: true, error: boom }, // sql
      { rows: [] }, // ROLLBACK
    ]);
    let caught: unknown;
    try {
      await runMigrations(client, [M1]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('0001_a.sql failed');
    expect((caught as Error).message).toContain('duplicate column');
    expect((caught as Error).cause).toBe(boom);
    // Ensure ROLLBACK was issued, and no COMMIT
    expect(calls.some((c) => c.sql === 'ROLLBACK')).toBe(true);
    expect(calls.some((c) => c.sql === 'COMMIT')).toBe(false);
  });

  it('does not apply subsequent migrations when an earlier one fails', async () => {
    const { client, calls } = scriptedClient([
      { rows: [] },
      { rows: [] },
      { rows: [] }, // BEGIN
      { throwOn: true, error: new Error('x') }, // sql
      { rows: [] }, // ROLLBACK
    ]);
    await expect(runMigrations(client, [M1, M2])).rejects.toThrow();
    // Only one migration body attempted
    const bodies = calls.filter((c) => c.sql.startsWith('CREATE TABLE'));
    expect(bodies).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// assertSchemaAtLeast
// ──────────────────────────────────────────────────────────────────────────────

describe('assertSchemaAtLeast', () => {
  it('passes when DB version >= requiredVersion', async () => {
    const { client } = scriptedClient([{ rows: [] }, { rows: [{ v: 5 }] }]);
    await expect(assertSchemaAtLeast(client, 5)).resolves.toBeUndefined();
  });

  it('passes when DB version > requiredVersion', async () => {
    const { client } = scriptedClient([{ rows: [] }, { rows: [{ v: 42 }] }]);
    await expect(assertSchemaAtLeast(client, 10)).resolves.toBeUndefined();
  });

  it('throws when DB version < requiredVersion', async () => {
    const { client } = scriptedClient([{ rows: [] }, { rows: [{ v: 3 }] }]);
    await expect(assertSchemaAtLeast(client, 10)).rejects.toThrow(
      /DB is at schema version 3, SDK requires 10/,
    );
  });

  it('treats a string `v` value as a number (Postgres COALESCE quirk)', async () => {
    const { client } = scriptedClient([{ rows: [] }, { rows: [{ v: '7' }] }]);
    await expect(assertSchemaAtLeast(client, 7)).resolves.toBeUndefined();
    await expect(assertSchemaAtLeast(client, 8)).rejects.toThrow();
  });

  it('treats empty rows as version 0 (fresh DB)', async () => {
    const { client } = scriptedClient([{ rows: [] }, { rows: [] }]);
    await expect(assertSchemaAtLeast(client, 1)).rejects.toThrow(
      /DB is at schema version 0/,
    );
  });
});
