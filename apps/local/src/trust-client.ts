// ══════════════════════════════════════════════════════════════════════════════
// TrustClient — budget-aware wrapper around `UpstreamClient.trustScore(...)`.
// ══════════════════════════════════════════════════════════════════════════════
//
// Sits between the public route handler (T-2.11 `POST /v1/trust/score`) and
// the raw upstream call so three concerns land in one place:
//
//   1. Budget precheck   — if T-2.9's meter has cached the tenant budget in
//                          `kv_store`, short-circuit with
//                          `UpstreamError('budget_exhausted')` when
//                          `tokens_remaining <= 0`, avoiding a wasted mothership
//                          round trip. Missing / stale cache → skip the check
//                          (T-2.9 may not be populating yet).
//   2. Upstream call     — `upstream.trustScore(request)`. Any `UpstreamError`
//                          bubbles up unchanged so the route handler surfaces
//                          `upstream_not_configured` (air-gap) → 503,
//                          `budget_exhausted` → 402, etc.
//   3. Persist + budget  — on success:
//                            a. Write `trust_score_v2` / `trust_tier` /
//                               `trust_results` / `trust_analyzed_at` onto the
//                               local `skills` row (best-effort; a 0-row update
//                               is logged as a warning, never fatal — the score
//                               is still returned to the caller so a mothership-
//                               only lookup still works).
//                            b. Update the cached budget by deducting
//                               `tokens_consumed` from `tokens_remaining`, so
//                               callers see the up-to-date remaining balance
//                               without a fresh `GET /v1/tenant/budget` per
//                               call.
//
// The tenant budget is cached under `TRUST_BUDGET_KEY_PREFIX + tenantId`; the
// version segment (`v1`) is baked in so T-2.9's cron and this client stay in
// step even if the cached payload shape changes.
//
// This module owns *only* the wrapper. The mothership call, resilience layer,
// contract validation, error taxonomy — all in `UpstreamClient`. Budget
// polling / admin surfacing — T-2.9. Route wiring — T-2.11.
//
// ══════════════════════════════════════════════════════════════════════════════

import type {
  BudgetResponse,
  TrustScoreRequest,
  TrustScoreResponse,
} from '@skillsregistry/contracts';
import type { KvAdapter } from '@skillsregistry/domain/adapters';
import type { Pool } from 'pg';
import { UpstreamError } from './upstream-client/errors.js';
import type { UpstreamClient } from './upstream-client/index.js';

/**
 * KV key prefix for the cached tenant budget. Full key:
 *   `trust:budget:v1:<tenantId>`
 * T-2.9's meter writes this row; T-2.8 reads + decrements it on each score.
 * Bump `v1` when the cached payload shape changes.
 */
export const TRUST_BUDGET_KEY_PREFIX = 'trust:budget:v1:';

/** Compose the KV key for a tenant's cached budget. */
export function budgetKey(tenantId: string): string {
  return `${TRUST_BUDGET_KEY_PREFIX}${tenantId}`;
}

/**
 * Structured logger — matches `BootLogger` shape used elsewhere so callers
 * can pass the same sink for consistent formatting.
 */
export interface TrustClientLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const consoleLogger: TrustClientLogger = {
  info: (msg, meta) => console.log(`[trust-client] ${msg}`, meta ?? ''),
  warn: (msg, meta) => console.warn(`[trust-client] ${msg}`, meta ?? ''),
  error: (msg, meta) => console.error(`[trust-client] ${msg}`, meta ?? ''),
};

/**
 * Cached snapshot of the tenant's budget — subset of `BudgetResponse` plus
 * the timestamp when the meter last refreshed it.
 */
export interface BudgetSnapshot {
  tenantId: string;
  plan: BudgetResponse['plan'];
  tokensTotal: number;
  tokensRemaining: number;
  tokensResetAt: string;
  lowBalance: boolean;
  /** ISO timestamp of the last refresh (write time by T-2.9's meter). */
  cachedAt: string;
}

/**
 * Result of a trust score call. `budget` reflects the *post-call* state:
 * either the KV-cached snapshot with `tokens_consumed` deducted, or `null`
 * when no cached budget was available (T-2.9 not yet populating).
 */
export interface TrustScoreResult {
  response: TrustScoreResponse;
  budget: BudgetSnapshot | null;
}

export interface TrustClientOptions {
  upstream: UpstreamClient;
  kv: KvAdapter;
  pool: Pool;
  /**
   * The tenant this local node identifies as. Sourced from
   * `config.upstream.tenantId`. In air-gap mode there is no cached budget
   * to key on; the client is still constructable so the route wiring is
   * uniform, but `score()` will just throw whatever the upstream call
   * throws (`upstream_not_configured`).
   */
  tenantId: string | null;
  logger?: TrustClientLogger;
}

export class TrustClient {
  private readonly upstream: UpstreamClient;
  private readonly kv: KvAdapter;
  private readonly pool: Pool;
  private readonly tenantId: string | null;
  private readonly logger: TrustClientLogger;

  constructor(options: TrustClientOptions) {
    this.upstream = options.upstream;
    this.kv = options.kv;
    this.pool = options.pool;
    this.tenantId = options.tenantId;
    this.logger = options.logger ?? consoleLogger;
  }

  /**
   * Read the KV-cached budget snapshot for the configured tenant, or `null`
   * when no cache exists / the payload fails shape validation. Never
   * throws — cache is best-effort.
   */
  async getCachedBudget(): Promise<BudgetSnapshot | null> {
    if (this.tenantId === null) return null;
    let raw: string | null;
    try {
      raw = await this.kv.get(budgetKey(this.tenantId));
    } catch (err) {
      this.logger.warn('kv read failed', {
        tenantId: this.tenantId,
        error: (err as Error).message,
      });
      return null;
    }
    if (raw === null) return null;
    return parseBudgetSnapshot(raw, this.logger);
  }

  /**
   * Score a skill through the mothership. Budget precheck → upstream call
   * → persist + budget decrement. All errors are `UpstreamError`s that
   * propagate to the caller unchanged.
   */
  async score(request: TrustScoreRequest): Promise<TrustScoreResult> {
    // Budget precheck. Missing tenant / missing cache → skip; the mothership
    // is authoritative and will 402 with `budget_exhausted` if we really are
    // out. This is a local optimization, not an enforcement gate.
    const cached = await this.getCachedBudget();
    if (cached !== null && cached.tokensRemaining <= 0) {
      this.logger.warn('budget precheck: exhausted', {
        tenantId: cached.tenantId,
        cachedAt: cached.cachedAt,
        tokensResetAt: cached.tokensResetAt,
      });
      throw new UpstreamError(
        'budget_exhausted',
        'tenant budget exhausted (local cache); wait for reset',
        {
          detail: {
            tokens_remaining: 0,
            tokens_reset_at: cached.tokensResetAt,
            source: 'local_cache',
          },
        },
      );
    }

    // Upstream call. Any UpstreamError propagates.
    const response = await this.upstream.trustScore(request);

    // Persist locally. Best-effort — if the row is missing (e.g. we're
    // scoring a skill the operator hasn't ingested yet, or the mothership
    // knows an id we don't), log and continue. The caller still gets the
    // score.
    await this.persist(response);

    // Decrement the cached budget by tokens_consumed so callers see a
    // fresh-ish remaining balance without hitting `GET /v1/tenant/budget`
    // on every score. `low_balance` flag is refreshed against the deducted
    // value using the same 10% threshold the mothership uses.
    const budget = cached !== null ? this.deduct(cached, response.tokens_consumed) : null;
    if (budget !== null) {
      await this.writeSnapshot(budget);
    }

    return { response, budget };
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async persist(response: TrustScoreResponse): Promise<void> {
    try {
      const result = await this.pool.query(
        `UPDATE skills
            SET trust_score_v2     = $1,
                trust_tier         = $2,
                trust_results      = $3::jsonb,
                trust_analyzed_at  = $4::timestamp
          WHERE id = $5`,
        [
          response.trust_score,
          response.trust_tier,
          JSON.stringify(response.trust_breakdown),
          new Date(response.scored_at),
          response.skill_id,
        ],
      );
      if (result.rowCount === 0) {
        this.logger.warn('persist: no local skills row', {
          skillId: response.skill_id,
          trustTier: response.trust_tier,
        });
      }
    } catch (err) {
      // Persistence failure is not fatal — the score is already computed
      // upstream and returned to the caller. Log with enough context to
      // diagnose.
      this.logger.error('persist failed', {
        skillId: response.skill_id,
        error: (err as Error).message,
      });
    }
  }

  private deduct(snapshot: BudgetSnapshot, consumed: number): BudgetSnapshot {
    const tokensRemaining = Math.max(0, snapshot.tokensRemaining - consumed);
    return {
      ...snapshot,
      tokensRemaining,
      lowBalance:
        snapshot.tokensTotal > 0
          ? tokensRemaining < snapshot.tokensTotal * 0.1
          : true,
    };
  }

  private async writeSnapshot(snapshot: BudgetSnapshot): Promise<void> {
    if (this.tenantId === null) return;
    try {
      // Preserve whatever TTL T-2.9's meter set — we intentionally overwrite
      // without one so the next scheduled refresh replaces the row with its
      // own TTL. If the meter's TTL was still valid, the refresh will
      // extend it; if not, the row lives until the next successful poll.
      await this.kv.put(budgetKey(this.tenantId), JSON.stringify(snapshot));
    } catch (err) {
      this.logger.warn('kv write failed', {
        tenantId: this.tenantId,
        error: (err as Error).message,
      });
    }
  }
}

/**
 * Shared JSON → `BudgetSnapshot` parser. Used by `TrustClient.getCachedBudget`
 * and `BudgetMeter.getCached` so the reader logic can't drift between the
 * writer (meter) and the pre-check consumer (trust client). Logs a warning
 * on JSON parse failure or shape mismatch and returns `null` — never throws.
 */
export function parseBudgetSnapshot(
  raw: string,
  logger?: TrustClientLogger,
): BudgetSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger?.warn('cached budget: JSON parse failed', {
      error: (err as Error).message,
    });
    return null;
  }
  if (!isBudgetSnapshot(parsed)) {
    logger?.warn('cached budget: shape mismatch', { raw });
    return null;
  }
  return parsed;
}

// ── Type guard ────────────────────────────────────────────────────────────

function isBudgetSnapshot(value: unknown): value is BudgetSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.tenantId === 'string' &&
    typeof v.plan === 'string' &&
    typeof v.tokensTotal === 'number' &&
    typeof v.tokensRemaining === 'number' &&
    typeof v.tokensResetAt === 'string' &&
    typeof v.lowBalance === 'boolean' &&
    typeof v.cachedAt === 'string'
  );
}

/**
 * Construct a `BudgetSnapshot` from a fresh `BudgetResponse` (used by T-2.9's
 * meter when it writes into KV). Kept here so the payload shape is defined
 * in one place shared between the writer and the reader.
 */
export function snapshotFromBudget(response: BudgetResponse): BudgetSnapshot {
  return {
    tenantId: response.tenant_id,
    plan: response.plan,
    tokensTotal: response.tokens_total,
    tokensRemaining: response.tokens_remaining,
    tokensResetAt: response.tokens_reset_at,
    lowBalance: response.low_balance,
    cachedAt: new Date().toISOString(),
  };
}
