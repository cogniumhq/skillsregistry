// ══════════════════════════════════════════════════════════════════════════════
// PgKv — KvAdapter over a Postgres `kv_store` table.
// ══════════════════════════════════════════════════════════════════════════════
//
// The kv_store table is a local-node concern (the mothership uses Cloudflare
// KV natively), so its DDL lives here rather than in `@skillsregistry/schema`.
// Callers invoke `ensureKvStoreTable(pool)` once at boot; the adapter itself
// is a plain wrapper around the pool.
//
// TTL semantics: `expires_at` is a stored timestamp. Expired rows are
// evicted lazily on read (no background sweep), matching the Cloudflare KV
// behavior the domain layer expects.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { KvAdapter } from '@skillsregistry/domain/adapters';
import type { Pool } from 'pg';

export const PG_KV_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS kv_store (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  expires_at  TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS kv_store_expires_at_idx
  ON kv_store (expires_at)
  WHERE expires_at IS NOT NULL;
`;

/**
 * Provision the `kv_store` table + expiry index if absent. Idempotent.
 * Call once during boot (typically right after `bootSchema`).
 */
export async function ensureKvStoreTable(pool: Pool): Promise<void> {
  await pool.query(PG_KV_TABLE_DDL);
}

export class PgKv implements KvAdapter {
  constructor(private readonly pool: Pool) {}

  async get(key: string): Promise<string | null> {
    const { rows } = await this.pool.query(
      'SELECT value, expires_at FROM kv_store WHERE key = $1',
      [key],
    );
    if (rows.length === 0) return null;
    const row = rows[0] as { value: string; expires_at: Date | null };
    if (row.expires_at !== null && row.expires_at.getTime() < Date.now()) {
      // Lazy eviction — don't return expired values.
      await this.pool.query('DELETE FROM kv_store WHERE key = $1', [key]);
      return null;
    }
    return row.value;
  }

  async put(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const expiresAt =
      ttlSeconds !== undefined
        ? new Date(Date.now() + ttlSeconds * 1000)
        : null;
    await this.pool.query(
      `INSERT INTO kv_store (key, value, expires_at, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value      = EXCLUDED.value,
             expires_at = EXCLUDED.expires_at,
             updated_at = NOW()`,
      [key, value, expiresAt],
    );
  }

  async delete(key: string): Promise<void> {
    await this.pool.query('DELETE FROM kv_store WHERE key = $1', [key]);
  }
}
