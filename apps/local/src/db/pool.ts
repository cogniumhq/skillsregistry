// ══════════════════════════════════════════════════════════════════════════════
// Postgres pool factory.
// ══════════════════════════════════════════════════════════════════════════════
//
// Thin wrapper around `pg.Pool` that applies the tuning knobs surfaced by the
// config module. The rest of `apps/local` only sees the pool — never the
// driver — so swapping drivers (Neon, pglite) is a single-file change.
//
// ══════════════════════════════════════════════════════════════════════════════

import { Pool } from 'pg';
import type { PostgresConfig } from '../config.js';

export function createPool(config: PostgresConfig): Pool {
  return new Pool({
    connectionString: config.connectionString,
    max: config.poolMax,
    statement_timeout: config.statementTimeoutMs,
  });
}
