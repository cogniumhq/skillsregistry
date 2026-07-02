// ══════════════════════════════════════════════════════════════════════════════
// TokenBucket — in-process token-bucket rate limiter.
// ══════════════════════════════════════════════════════════════════════════════
//
// This is a *defensive* cap on how much traffic the local node may push to the
// mothership. It fires before the mothership's own per-tenant limits so we
// stay well-behaved by construction and always know locally when we've stopped
// making calls. Single-tenant per node — there's exactly one bucket instance
// inside `UpstreamClient`.
//
// The bucket is monotonic (no negative balance), refills continuously at
// `refillPerSecond`, and caps at `capacity`. `tryTake()` never blocks — it's
// the caller's choice how to react to a refusal (throw, sleep, drop).
//
// ══════════════════════════════════════════════════════════════════════════════

export interface TokenBucketOptions {
  /** Max tokens the bucket holds. Also the initial value. */
  capacity: number;
  /** Refill rate, tokens per wall-clock second. */
  refillPerSecond: number;
  /** Time source override for tests. Defaults to `Date.now`. */
  now?: () => number;
}

export type TokenBucketResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly now: () => number;

  constructor(options: TokenBucketOptions) {
    if (options.capacity <= 0) {
      throw new Error('[token-bucket] capacity must be > 0');
    }
    if (options.refillPerSecond <= 0) {
      throw new Error('[token-bucket] refillPerSecond must be > 0');
    }
    this.capacity = options.capacity;
    this.refillPerSecond = options.refillPerSecond;
    this.now = options.now ?? (() => Date.now());
    this.tokens = options.capacity;
    this.lastRefill = this.now();
  }

  /**
   * Attempt to consume one token.
   *
   * @returns `{ ok: true }` on success. On failure, `retryAfterSeconds` is the
   *          integer count of seconds until the next token is available
   *          (always ≥ 1 so callers get a sane retry hint).
   */
  tryTake(): TokenBucketResult {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { ok: true };
    }
    const deficit = 1 - this.tokens;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(deficit / this.refillPerSecond),
    );
    return { ok: false, retryAfterSeconds };
  }

  /** Current token balance (fractional). Testing hook. */
  balance(): number {
    this.refill();
    return this.tokens;
  }

  private refill(): void {
    const now = this.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    if (elapsedSeconds <= 0) return;
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsedSeconds * this.refillPerSecond,
    );
    this.lastRefill = now;
  }
}
