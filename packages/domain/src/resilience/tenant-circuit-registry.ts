// ══════════════════════════════════════════════════════════════════════════════
// TenantCircuitRegistry — per-tenant CircuitBreaker for llm.c0g.io
// ══════════════════════════════════════════════════════════════════════════════
//
// Each tenant gets its own CircuitBreaker so a single noisy tenant cannot
// trip the circuit for everyone else. State is per-isolate (same constraint
// as circuit-breaker.ts) which is acceptable: cooldowns are 30s by default
// and isolates live longer than that under load.
//
// The registry is created once per Worker isolate (or Node process) and
// injected into the LLM-proxy client.
//
// Memory bound: tenants are not unbounded — the multi-tenant model in
// skillsregistry.md §5 registers them explicitly. We don't evict; a noisy
// long-tail of transient tenants would still bound at O(N tenants × ~64B
// per breaker). If that becomes an issue, switch to a Map with LRU
// eviction.
//
// Runtime coupling was removed during the T-1.4b extraction: the mothership
// constructor previously accepted `Env` to read `LLMPROXY_BREAKER_*` env
// vars. The runtime-agnostic version accepts explicit options and lets the
// caller pull from wherever it likes.
//
// ══════════════════════════════════════════════════════════════════════════════

import { CircuitBreaker } from './circuit-breaker.js';

/**
 * Raised when the per-tenant breaker is open. Carries the tenantId so
 * callers can decide policy (surface 429, fall back to a cheaper provider,
 * or return a degraded result).
 */
export class LLMProxyCircuitOpen extends Error {
  readonly tenantId: string;
  constructor(tenantId: string) {
    super(`llmproxy circuit open for tenant "${tenantId}"`);
    this.name = 'LLMProxyCircuitOpen';
    this.tenantId = tenantId;
  }
}

export interface TenantCircuitRegistryOptions {
  /** Failures before the breaker opens. Default 3. */
  threshold?: number;
  /** Cooldown before half-open probe. Default 30_000 ms. */
  cooldownMs?: number;
}

export class TenantCircuitRegistry {
  private breakers = new Map<string, CircuitBreaker>();
  private threshold: number;
  private cooldownMs: number;

  constructor(opts: TenantCircuitRegistryOptions = {}) {
    this.threshold = opts.threshold ?? 3;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
  }

  /**
   * Get (or lazily create) the breaker for this tenant. Tenants are not
   * pre-registered; first call materializes the breaker.
   */
  get(tenantId: string): CircuitBreaker {
    let b = this.breakers.get(tenantId);
    if (!b) {
      b = new CircuitBreaker(this.threshold, this.cooldownMs);
      this.breakers.set(tenantId, b);
    }
    return b;
  }

  /** Returns the set of tenants we currently track breakers for. Test-only. */
  knownTenants(): string[] {
    return [...this.breakers.keys()];
  }

  /** Reset all breakers. Test-only. */
  resetAll(): void {
    for (const b of this.breakers.values()) b.reset();
  }
}
