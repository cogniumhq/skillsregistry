// ══════════════════════════════════════════════════════════════════════════════
// CircuitBreaker — Resilience for Workers AI Calls
// ══════════════════════════════════════════════════════════════════════════════
//
// State machine: closed → open → half-open → closed
//
// - Closed: requests pass through normally
// - Open: requests short-circuit to fallback (after N consecutive failures)
// - Half-open: one test request allowed after cooldown period
//
// One instance per isolate (module-level). Each isolate independently
// detects failures, which is acceptable for Cloudflare Workers.
//
// Only wraps LLM calls, NOT embedding calls (those are critical path).
//
// ══════════════════════════════════════════════════════════════════════════════

export type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private lastFailureTime = 0;

  constructor(
    private threshold: number = 3,
    private cooldownMs: number = 30000
  ) {}

  /**
   * Execute a function with circuit breaker protection and one retry.
   * Returns { result, degraded } where degraded=true means fallback was used.
   */
  async execute<T>(
    fn: () => Promise<T>,
    fallback: T
  ): Promise<{ result: T; degraded: boolean }> {
    // Check if circuit is open
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.cooldownMs) {
        this.state = 'half-open';
      } else {
        return { result: fallback, degraded: true };
      }
    }

    // Try with one retry (catches transient 500s)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await fn();
        this.onSuccess();
        return { result, degraded: false };
      } catch (error) {
        if (attempt === 0) {
          // First failure: retry after brief delay
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        // Second failure: record it
        this.onFailure();
        console.error(
          `[CIRCUIT-BREAKER] Failure #${this.consecutiveFailures} (state: ${this.state}):`,
          (error as Error).message
        );
        return { result: fallback, degraded: true };
      }
    }

    // TypeScript requires a return here (unreachable)
    return { result: fallback, degraded: true };
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();
    if (this.consecutiveFailures >= this.threshold) {
      this.state = 'open';
      console.warn(
        `[CIRCUIT-BREAKER] Circuit OPENED after ${this.consecutiveFailures} consecutive failures. ` +
        `Will retry after ${this.cooldownMs}ms cooldown.`
      );
    }
  }

  get isOpen(): boolean {
    if (this.state !== 'open') return false;
    // Check if cooldown has elapsed
    if (Date.now() - this.lastFailureTime > this.cooldownMs) {
      this.state = 'half-open';
      return false;
    }
    return true;
  }

  get currentState(): CircuitState {
    return this.state;
  }

  /** Reset for testing */
  reset(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.lastFailureTime = 0;
  }
}
