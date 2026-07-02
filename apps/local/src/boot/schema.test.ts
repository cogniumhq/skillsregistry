import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, type Migration, type SqlClient } from '@skillsregistry/schema';
import { bootSchema, type BootLogger } from './schema.js';

// ─── in-memory SqlClient ────────────────────────────────────────────────────
//
// Just enough Postgres to exercise `runMigrations` + `assertSchemaAtLeast`:
//   - Recognizes the `schema_migrations` DDL (CREATE TABLE IF NOT EXISTS)
//   - Recognizes SELECT of applied rows
//   - Recognizes INSERT INTO schema_migrations
//   - Recognizes the MAX(version) query
//   - Accepts BEGIN / COMMIT / ROLLBACK
//   - Records arbitrary migration SQL as an executed side effect (visible via
//     `.executed`) so a test can assert the SDK actually ran the payload.

interface FakeClient extends SqlClient {
  executed: string[];
  applied: { version: number; name: string }[];
  reset(): void;
}

function makeClient(opts?: { failOnSql?: string }): FakeClient {
  const state = {
    executed: [] as string[],
    applied: [] as { version: number; name: string }[],
  };

  const client: FakeClient = {
    executed: state.executed,
    applied: state.applied,
    reset() {
      state.executed.length = 0;
      state.applied.length = 0;
    },
    async query(text: string, values?: unknown[]) {
      state.executed.push(text.trim().split('\n')[0]!);

      if (opts?.failOnSql && text.includes(opts.failOnSql)) {
        throw new Error(`fake db error on: ${opts.failOnSql}`);
      }

      // schema_migrations DDL — no-op
      if (text.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
        return { rows: [] };
      }

      // read applied rows
      if (
        text.startsWith(
          'SELECT version, name, applied_at FROM schema_migrations',
        )
      ) {
        return {
          rows: state.applied.map((a) => ({
            version: a.version,
            name: a.name,
            applied_at: new Date(),
          })),
        };
      }

      // MAX(version) guard query
      if (text.includes('COALESCE(MAX(version)') && text.includes('schema_migrations')) {
        const max = state.applied.reduce(
          (m, a) => (a.version > m ? a.version : m),
          0,
        );
        return { rows: [{ v: max }] };
      }

      // INSERT applied row
      if (text.startsWith('INSERT INTO schema_migrations')) {
        const [version, name] = values as [number, string];
        state.applied.push({ version, name });
        return { rows: [] };
      }

      // txn control
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
        return { rows: [] };
      }

      // migration payload SQL — accepted
      return { rows: [] };
    },
  };
  return client;
}

const silentLogger: BootLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

// Full-set fixture — matches SCHEMA_VERSION so the guard passes.
function fullMigrations(): Migration[] {
  const out: Migration[] = [];
  for (let v = 1; v <= SCHEMA_VERSION; v++) {
    const padded = String(v).padStart(4, '0');
    out.push({
      version: v,
      name: `${padded}_fake.sql`,
      sql: `SELECT ${v}`,
    });
  }
  return out;
}

describe('bootSchema', () => {
  it('applies every migration on a fresh DB', async () => {
    const client = makeClient();
    const result = await bootSchema(client, {
      migrations: fullMigrations(),
      logger: silentLogger,
    });
    expect(result.appliedCount).toBe(SCHEMA_VERSION);
    expect(result.skippedCount).toBe(0);
    expect(result.currentVersion).toBe(SCHEMA_VERSION);
    expect(result.requiredVersion).toBe(SCHEMA_VERSION);
    expect(client.applied.map((a) => a.version)).toEqual(
      Array.from({ length: SCHEMA_VERSION }, (_, i) => i + 1),
    );
  });

  it('is idempotent — second call is a no-op', async () => {
    const client = makeClient();
    const migrations = fullMigrations();
    await bootSchema(client, { migrations, logger: silentLogger });
    const second = await bootSchema(client, { migrations, logger: silentLogger });
    expect(second.appliedCount).toBe(0);
    expect(second.skippedCount).toBe(SCHEMA_VERSION);
    expect(second.currentVersion).toBe(SCHEMA_VERSION);
  });

  it('applyMigrations=false runs guard only — passes when DB is up-to-date', async () => {
    const client = makeClient();
    for (const m of fullMigrations()) {
      client.applied.push({ version: m.version, name: m.name });
    }
    const result = await bootSchema(client, {
      applyMigrations: false,
      logger: silentLogger,
    });
    expect(result.appliedCount).toBe(0);
    expect(result.skippedCount).toBe(0);
    expect(result.currentVersion).toBe(SCHEMA_VERSION);
    // Should not have executed any INSERT or BEGIN — guard-only path.
    expect(client.executed.some((s) => s === 'BEGIN')).toBe(false);
  });

  it('applyMigrations=false surfaces version mismatch as a clear error', async () => {
    const client = makeClient();
    // DB is stuck at v3 but SDK requires SCHEMA_VERSION > 3.
    client.applied.push({ version: 3, name: '0003.sql' });
    await expect(
      bootSchema(client, { applyMigrations: false, logger: silentLogger }),
    ).rejects.toThrow(
      new RegExp(`DB is at schema version 3, SDK requires ${SCHEMA_VERSION}`),
    );
  });

  it('surfaces migration errors as fatal, rolling back the txn', async () => {
    const client = makeClient({ failOnSql: 'SELECT 2' });
    await expect(
      bootSchema(client, {
        migrations: fullMigrations(),
        logger: silentLogger,
      }),
    ).rejects.toThrow(/migration 0002_fake\.sql failed/);
    // ROLLBACK should have run.
    expect(client.executed).toContain('ROLLBACK');
    // v1 committed before failure; v2 must NOT be in applied.
    expect(client.applied.some((a) => a.version === 2)).toBe(false);
  });

  it('assertSchemaAtLeast fires when required version > DB version', async () => {
    const client = makeClient();
    const partial = fullMigrations().slice(0, 2);
    await expect(
      bootSchema(client, { migrations: partial, logger: silentLogger }),
    ).rejects.toThrow(
      new RegExp(`DB is at schema version 2, SDK requires ${SCHEMA_VERSION}`),
    );
  });

  it('emits an info log for each applied migration', async () => {
    const messages: string[] = [];
    const logger: BootLogger = {
      info: (m) => messages.push(m),
      warn: () => {},
      error: () => {},
    };
    const client = makeClient();
    await bootSchema(client, { migrations: fullMigrations(), logger });
    expect(
      messages.filter((m) => m.startsWith('[schema] applied')).length,
    ).toBe(SCHEMA_VERSION);
    expect(messages.some((m) => m.startsWith('[schema] boot: complete'))).toBe(
      true,
    );
  });

  it('emits a no-pending-migrations info when everything is already applied', async () => {
    const messages: string[] = [];
    const logger: BootLogger = {
      info: (m) => messages.push(m),
      warn: () => {},
      error: () => {},
    };
    const client = makeClient();
    const migrations = fullMigrations();
    await bootSchema(client, { migrations, logger: silentLogger });
    await bootSchema(client, { migrations, logger });
    expect(
      messages.some((m) => m === '[schema] no pending migrations'),
    ).toBe(true);
  });
});
