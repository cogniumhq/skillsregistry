// ══════════════════════════════════════════════════════════════════════════════
// Sql adapters — pool + connection ports for domain-owned Postgres access
// ══════════════════════════════════════════════════════════════════════════════
//
// The migration runner in @skillsregistry/schema only needs a single-shot
// query() port (its `SqlClient` is intentionally minimal). Domain-layer code
// that runs transactions (index writes, composition ops, scoring updates)
// needs the shape of `pg.Pool` / `PoolClient` — namely `connect()` returning a
// releasable connection.
//
// We match `@neondatabase/serverless` and `pg` structurally so callers can
// pass their driver's pool directly. In-memory doubles for tests only need
// to implement these three interfaces.
//
// ══════════════════════════════════════════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- pg driver semantics
export interface SqlQueryResult<T = any> {
  rows: T[];
  rowCount?: number | null;
}

/**
 * The minimal query shape. Any pg-like driver satisfies this. Structurally
 * compatible with `@skillsregistry/schema`'s narrower `SqlClient`.
 *
 * Row shape defaults to `any` — matches `pg.Pool.query`'s own signature,
 * since row typing across a SQL boundary is inherently unverifiable at
 * TypeScript level. Callers can specify `T` explicitly to get typed rows
 * (`await client.query<{ id: string }>(sql, args)`) when they want.
 */
export interface SqlClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pg driver semantics
  query<T = any>(
    text: string,
    values?: readonly unknown[]
  ): Promise<SqlQueryResult<T>>;
}

/**
 * A single connection checked out of a pool. `release()` returns it to the
 * pool. Transactions run on a SqlConnection so BEGIN/COMMIT/ROLLBACK land on
 * the same physical connection.
 */
export interface SqlConnection extends SqlClient {
  release(): void;
}

/**
 * A pool of connections. `query()` on the pool is a convenience for
 * single-shot statements; `connect()` opens a session for multi-statement
 * work (transactions).
 */
export interface SqlPool extends SqlClient {
  connect(): Promise<SqlConnection>;
}
