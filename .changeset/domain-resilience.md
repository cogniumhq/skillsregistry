---
"@skillsregistry/domain": minor
---

Port `src/resilience/*` from the mothership under the new adapter ports:

- `CircuitBreaker` — unchanged, closed / open / half-open state machine
- `TenantCircuitRegistry` — per-tenant breaker factory. Constructor now
  takes `{ threshold, cooldownMs }` options only; the mothership's `Env`
  dependency is gone (callers pull env vars themselves)
- `LLMProxyRateLimiter` — sliding-window per-tenant per-stage counter.
  Rewritten against `KvAdapter` + `AfterResponse`; no more
  `env.SEARCH_CACHE` / `waitUntil` couplings. Degrades open (no-op) when
  no `KvAdapter` is provided, matching the mothership's KV-missing
  behavior. Key namespace `llmproxy-rl:{stage}:{tenantId}:{minute}`
  preserved so counters remain wire-compatible if the mothership adopts
  this port later.

Exposed via the new `@skillsregistry/domain/resilience` subpath and the
package root barrel. No breaking changes to consumers — this package is
pre-1.0 and gains capabilities on each T-1.4x subtask; 1.0 lands with
T-1.4f.
