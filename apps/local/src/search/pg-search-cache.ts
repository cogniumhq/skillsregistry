// ══════════════════════════════════════════════════════════════════════════════
// PgSearchCache — `SearchCachePort` backed by the local `kv_store` table.
// ══════════════════════════════════════════════════════════════════════════════
//
// The mothership uses Cloudflare KV natively; the local node caches search
// responses in Postgres via `PgKv`. The port stays coarse — three fields
// (query, tenantId, appetite) key the entry; the value is the full
// `FindSkillResponse` blob serialized as JSON.
//
// Key format:  `search:v1:<tenantId>:<appetite>:<sha256(query)>`
//
// The sha256 of the (trimmed, lowercased) query keeps keys bounded even for
// very long inputs. `v1` prefixes the schema so a future breaking change to
// `FindSkillResponse` can be rolled by bumping to `search:v2:`.
//
// TTL policy (tier-biased, per the port's advisory `tier` arg):
//
//   Tier 1 — HIGH confidence, ~50ms provider-only.       Long TTL — cheap hit path.
//   Tier 2 — MEDIUM confidence, provider + async enrich. Medium TTL.
//   Tier 3 — LOW confidence, full LLM deep-search.       Short TTL — expensive
//                                                        to compute but the
//                                                        deep-search result is
//                                                        the most likely to
//                                                        become stale as the
//                                                        corpus grows.
//
// The three TTLs are `SearchConfig.cacheTtl{Tier1,Tier2,Tier3}` (see
// `config.ts`). Defaults: 3600 / 1800 / 600 seconds.
//
// Errors on `get()` are swallowed → miss. Errors on `set()` are swallowed →
// silent (caller schedules `set` via `AfterResponse` anyway). This matches
// the port contract in `@skillsregistry/domain/adapters/search-cache.ts`.
//
// ══════════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import type { SearchCachePort } from '@skillsregistry/domain/adapters';
import type { FindSkillResponse } from '@skillsregistry/domain/types';
import type { PgKv } from '../adapters/pg-kv.js';

export interface PgSearchCacheOptions {
  kv: PgKv;
  /** Tier-1 TTL in seconds. */
  ttlTier1: number;
  /** Tier-2 TTL in seconds. */
  ttlTier2: number;
  /** Tier-3 TTL in seconds. */
  ttlTier3: number;
}

export class PgSearchCache implements SearchCachePort {
  private readonly kv: PgKv;
  private readonly ttlTier1: number;
  private readonly ttlTier2: number;
  private readonly ttlTier3: number;

  constructor(opts: PgSearchCacheOptions) {
    this.kv = opts.kv;
    this.ttlTier1 = opts.ttlTier1;
    this.ttlTier2 = opts.ttlTier2;
    this.ttlTier3 = opts.ttlTier3;
  }

  async get(
    query: string,
    tenantId: string,
    appetite: string,
  ): Promise<FindSkillResponse | null> {
    try {
      const raw = await this.kv.get(cacheKey(query, tenantId, appetite));
      if (raw === null) return null;
      return JSON.parse(raw) as FindSkillResponse;
    } catch {
      // Any error → miss. Cache staleness is preferable to blocking search.
      return null;
    }
  }

  async set(
    query: string,
    tenantId: string,
    appetite: string,
    response: FindSkillResponse,
    tier: number,
  ): Promise<void> {
    try {
      // Never persist the enrichment promise — it's not JSON-serializable
      // and the tier-2 async enrich pattern re-fires on the next request
      // anyway. Strip everything else through JSON serialization.
      const { enrichmentPromise: _drop, ...serializable } = response;
      const ttl = this.pickTtl(tier);
      await this.kv.put(
        cacheKey(query, tenantId, appetite),
        JSON.stringify(serializable),
        ttl,
      );
    } catch {
      // Never let cache writes bubble — they run via AfterResponse, but
      // even so, the intent is fire-and-forget.
    }
  }

  private pickTtl(tier: number): number {
    if (tier === 1) return this.ttlTier1;
    if (tier === 2) return this.ttlTier2;
    return this.ttlTier3;
  }
}

/**
 * Build the KV key for a (query, tenantId, appetite) triple.
 *
 * Exported for tests + callers that want to invalidate directly (rare, but
 * the future `POST /v1/admin/search-cache/purge` handler will use it).
 */
export function cacheKey(
  query: string,
  tenantId: string,
  appetite: string,
): string {
  const normalized = query.trim().toLowerCase();
  const hash = createHash('sha256').update(normalized, 'utf8').digest('hex');
  return `search:v1:${tenantId}:${appetite}:${hash}`;
}
