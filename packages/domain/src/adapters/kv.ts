// ══════════════════════════════════════════════════════════════════════════════
// KvAdapter — key-value store abstraction
// ══════════════════════════════════════════════════════════════════════════════
//
// The domain layer caches (search results, query embeddings, budget snapshots,
// rate-limit counters) never touch a concrete KV implementation directly.
// The mothership binds this to Cloudflare KV; the local node binds it to a
// `kv_store` table in Postgres or a filesystem cache.
//
// Design constraints:
//
//   - Values are strings. Callers JSON-serialize as needed.
//   - TTL is expressed in seconds. Backends that cannot honor per-key TTL
//     natively (e.g., Postgres table with `expires_at`) implement expiry via
//     lazy eviction during reads.
//   - No batch API on this interface — implementers may add one behind their
//     concrete type, but the domain layer only ever needs single-key ops.
//   - Errors are exceptions. Implementers must not silently swallow failures.
//
// ══════════════════════════════════════════════════════════════════════════════

export interface KvAdapter {
  /**
   * Read a value. Returns `null` if the key does not exist or has expired.
   */
  get(key: string): Promise<string | null>;

  /**
   * Write a value. `ttlSeconds` is optional; when omitted, the value is
   * persistent (or bounded by the backend's own eviction policy).
   */
  put(key: string, value: string, ttlSeconds?: number): Promise<void>;

  /**
   * Delete a key. Idempotent — deleting a missing key is not an error.
   */
  delete(key: string): Promise<void>;
}
