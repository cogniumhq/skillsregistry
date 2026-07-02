// ══════════════════════════════════════════════════════════════════════════════
// SearchCachePort — response cache used by the confidence gate
// ══════════════════════════════════════════════════════════════════════════════
//
// The confidence gate short-circuits repeated queries with a cache lookup at
// the top of `findSkill`. Concrete implementations are runtime-specific:
//   - Cloudflare KV (mothership)
//   - Node LRU (local dev)
//   - Postgres materialized view (self-hosted at scale)
//
// The port stays intentionally coarse — three fields (query, tenantId,
// appetite) key the entry; the value is the full `FindSkillResponse` blob
// exactly as returned to the caller. Providers own TTL, eviction, and
// serialization.
//
// `tier` on `set()` gives providers a lever if they want cheaper hot paths
// to live longer (T1 hits are fast + cheap; T3 hits are expensive to
// recompute). It's advisory; not part of the cache key.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { FindSkillResponse } from '../types.js';

export interface SearchCachePort {
  /**
   * Return a previously-cached response for this (query, tenantId,
   * appetite) triple, or `null` if there's no hit. Callers treat any
   * error / timeout as a miss — implementations should catch and swallow
   * their own transport failures.
   */
  get(
    query: string,
    tenantId: string,
    appetite: string
  ): Promise<FindSkillResponse | null>;

  /**
   * Persist a fresh response. `tier` is the confidence tier that produced
   * the response — providers may use it to bias TTL or eviction. Callers
   * fire `set()` via `AfterResponse` so slow persistence never blocks the
   * response.
   */
  set(
    query: string,
    tenantId: string,
    appetite: string,
    response: FindSkillResponse,
    tier: number
  ): Promise<void>;
}
