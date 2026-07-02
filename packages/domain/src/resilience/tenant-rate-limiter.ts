// ══════════════════════════════════════════════════════════════════════════════
// LLMProxy Tenant Rate Limiter — KV-backed sliding window per tenant
// ══════════════════════════════════════════════════════════════════════════════
//
// Caps embedding/rerank traffic to the upstream LLM proxy per tenant-minute.
// Runtime-agnostic port version: the mothership passes a CF-KV-backed
// KvAdapter and a waitUntil-backed AfterResponse; the local node passes a
// Postgres- or in-memory-backed adapter and a setImmediate-backed AfterResponse.
//
// Key namespace stays stable across runtimes (compatible with existing
// mothership KV entries):
//
//   llmproxy-rl:{stage}:{tenantId}:{minute}
//
// where `stage` is currently 'embed' or 'rerank'. The two stages share the
// breaker registry but not the rate-limit counters; reranker calls are smaller
// and burstier than ingestion-time embed calls.
//
// This is a *defensive* cap. The proxy itself enforces hard quotas. This trips
// earlier and per-tenant so one noisy tenant cannot drain the global budget
// before the proxy 429s.
//
// Degrade-open contract: if no KvAdapter is provided the limiter is a no-op.
// Callers can still hit the breaker; only the local counter goes away. Matches
// the mothership behavior when the SEARCH_CACHE binding is missing.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { AfterResponse } from '../adapters/after-response.js';
import type { KvAdapter } from '../adapters/kv.js';

export type LLMProxyStage = 'embed' | 'rerank';

export class LLMProxyRateLimitExceeded extends Error {
  readonly tenantId: string;
  readonly stage: LLMProxyStage;
  readonly limit: number;
  readonly retryAfterSeconds: number;
  constructor(
    tenantId: string,
    stage: LLMProxyStage,
    limit: number,
    retryAfterSeconds: number
  ) {
    super(
      `llmproxy ${stage} rate limit exceeded for tenant "${tenantId}": ${limit} rpm`
    );
    this.name = 'LLMProxyRateLimitExceeded';
    this.tenantId = tenantId;
    this.stage = stage;
    this.limit = limit;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface LLMProxyRateLimiterOptions {
  /** Requests-per-minute cap per (tenant, stage). Defaults to 600. */
  rpm?: number;
  /** KV port used for the per-minute counter. Null → degrade open (no-op). */
  kv?: KvAdapter | null;
  /** After-response port used to defer the counter write off the hot path. */
  afterResponse?: AfterResponse | null;
  /** Inject a deterministic clock for tests. */
  now?: () => number;
}

/**
 * Tenant-scoped sliding-window limiter for llmproxy calls.
 *
 * - increment: optimistic; uses kv.get + kv.put, no CAS. KV is typically
 *   eventually consistent so very tight bursts may slip past the cap. That's
 *   intentional — exact accounting is the proxy's job.
 * - afterResponse: if provided, the counter write is deferred (non-blocking
 *   hot path). Otherwise we await the put inline.
 */
export class LLMProxyRateLimiter {
  private rpm: number;
  private kv: KvAdapter | null;
  private afterResponse: AfterResponse | null;
  private now: () => number;

  constructor(opts: LLMProxyRateLimiterOptions = {}) {
    const fromOpt = opts.rpm;
    const fallback = 600;
    this.rpm =
      typeof fromOpt === 'number' && fromOpt > 0 ? fromOpt : fallback;
    this.kv = opts.kv ?? null;
    this.afterResponse = opts.afterResponse ?? null;
    this.now = opts.now ?? (() => Date.now());
  }

  get limit(): number {
    return this.rpm;
  }

  private key(stage: LLMProxyStage, tenantId: string, minute: number): string {
    return `llmproxy-rl:${stage}:${tenantId}:${minute}`;
  }

  private retryAfterSeconds(): number {
    return 60 - (Math.floor(this.now() / 1000) % 60);
  }

  /**
   * Throws LLMProxyRateLimitExceeded if the tenant is over budget for this
   * minute, otherwise increments the counter for the current bucket.
   */
  async enforce(
    tenantId: string,
    stage: LLMProxyStage = 'embed'
  ): Promise<void> {
    const kv = this.kv;
    if (!kv) {
      // Without a KV adapter we degrade open. Callers can still hit the
      // breaker; the limiter just becomes a no-op.
      return;
    }
    const minute = Math.floor(this.now() / 60000);
    const key = this.key(stage, tenantId, minute);
    const raw = await kv.get(key);
    const current = raw ? parseInt(raw, 10) : 0;

    if (current >= this.rpm) {
      throw new LLMProxyRateLimitExceeded(
        tenantId,
        stage,
        this.rpm,
        this.retryAfterSeconds()
      );
    }

    // TTL is 2× the window so stale buckets self-clean.
    const put = kv.put(key, String(current + 1), 120);
    if (this.afterResponse) {
      this.afterResponse.run(async () => {
        await put;
      });
    } else {
      await put;
    }
  }
}
