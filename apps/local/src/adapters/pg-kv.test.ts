import { beforeEach, describe, expect, it } from 'vitest';
import { PgKv, ensureKvStoreTable, PG_KV_TABLE_DDL } from './pg-kv.js';

interface Row {
  key: string;
  value: string;
  expires_at: Date | null;
  updated_at: Date;
}

/**
 * In-memory fake of the pg.Pool surface used by PgKv. Only implements the
 * exact SQL shapes the adapter emits — brittle by design, so if the adapter
 * changes its query text the tests fail loudly.
 */
class FakePool {
  readonly rowsByKey = new Map<string, Row>();
  readonly ddlCalls: string[] = [];

  async query(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ rows: unknown[] }> {
    const text = sql.trim();
    if (text.startsWith('CREATE TABLE')) {
      this.ddlCalls.push(text);
      return { rows: [] };
    }
    if (text.startsWith('SELECT value, expires_at FROM kv_store')) {
      const [key] = params as [string];
      const row = this.rowsByKey.get(key);
      return {
        rows: row
          ? [{ value: row.value, expires_at: row.expires_at }]
          : [],
      };
    }
    if (text.startsWith('INSERT INTO kv_store')) {
      const [key, value, expiresAt] = params as [
        string,
        string,
        Date | null,
      ];
      this.rowsByKey.set(key, {
        key,
        value,
        expires_at: expiresAt,
        updated_at: new Date(),
      });
      return { rows: [] };
    }
    if (text.startsWith('DELETE FROM kv_store')) {
      const [key] = params as [string];
      this.rowsByKey.delete(key);
      return { rows: [] };
    }
    throw new Error(`FakePool: unhandled SQL: ${text}`);
  }
}

describe('PgKv', () => {
  let pool: FakePool;
  let kv: PgKv;

  beforeEach(() => {
    pool = new FakePool();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    kv = new PgKv(pool as any);
  });

  it('put + get roundtrips a value', async () => {
    await kv.put('greet', 'hello');
    expect(await kv.get('greet')).toBe('hello');
  });

  it('get returns null for missing keys', async () => {
    expect(await kv.get('nope')).toBeNull();
  });

  it('put overwrites (ON CONFLICT UPDATE)', async () => {
    await kv.put('k', 'v1');
    await kv.put('k', 'v2');
    expect(await kv.get('k')).toBe('v2');
  });

  it('delete removes the key', async () => {
    await kv.put('k', 'v');
    await kv.delete('k');
    expect(await kv.get('k')).toBeNull();
  });

  it('lazily evicts expired rows on read', async () => {
    // Insert with ttl that will expire immediately.
    await kv.put('short', 'value', 0);
    // Force the row's expires_at into the past — bypassing put()'s clock.
    const row = pool.rowsByKey.get('short')!;
    row.expires_at = new Date(Date.now() - 1000);
    expect(await kv.get('short')).toBeNull();
    // Row is deleted after the read.
    expect(pool.rowsByKey.has('short')).toBe(false);
  });

  it('returns non-expired values when ttl is in the future', async () => {
    await kv.put('live', 'still-here', 60);
    expect(await kv.get('live')).toBe('still-here');
  });

  it('ensureKvStoreTable issues the DDL', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ensureKvStoreTable(pool as any);
    expect(pool.ddlCalls).toHaveLength(1);
    expect(pool.ddlCalls[0]).toContain('kv_store');
  });

  it('exposes DDL as a stable constant', () => {
    expect(PG_KV_TABLE_DDL).toContain('CREATE TABLE IF NOT EXISTS kv_store');
    expect(PG_KV_TABLE_DDL).toContain('expires_at');
  });
});
