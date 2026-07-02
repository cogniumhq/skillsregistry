import { describe, expect, it } from 'vitest';
import { TokenBucket } from './token-bucket.js';

/** Movable clock for deterministic bucket tests. */
class Clock {
  constructor(private t: number) {}
  now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
}

describe('TokenBucket', () => {
  it('rejects invalid config', () => {
    expect(() => new TokenBucket({ capacity: 0, refillPerSecond: 1 })).toThrow();
    expect(
      () => new TokenBucket({ capacity: 1, refillPerSecond: 0 }),
    ).toThrow();
  });

  it('starts full at capacity', () => {
    const bucket = new TokenBucket({ capacity: 3, refillPerSecond: 1 });
    expect(bucket.balance()).toBe(3);
  });

  it('drains one token per tryTake()', () => {
    const clock = new Clock(0);
    const bucket = new TokenBucket({
      capacity: 3,
      refillPerSecond: 1,
      now: clock.now,
    });
    expect(bucket.tryTake().ok).toBe(true);
    expect(bucket.tryTake().ok).toBe(true);
    expect(bucket.tryTake().ok).toBe(true);
    const empty = bucket.tryTake();
    expect(empty.ok).toBe(false);
    if (empty.ok) throw new Error('unreachable');
    expect(empty.retryAfterSeconds).toBe(1);
  });

  it('refills at refillPerSecond over time', () => {
    const clock = new Clock(0);
    const bucket = new TokenBucket({
      capacity: 5,
      refillPerSecond: 2,
      now: clock.now,
    });
    // drain
    for (let i = 0; i < 5; i++) expect(bucket.tryTake().ok).toBe(true);
    expect(bucket.tryTake().ok).toBe(false);
    // 500ms → +1 token
    clock.advance(500);
    expect(bucket.tryTake().ok).toBe(true);
    expect(bucket.tryTake().ok).toBe(false);
  });

  it('caps refill at capacity', () => {
    const clock = new Clock(0);
    const bucket = new TokenBucket({
      capacity: 2,
      refillPerSecond: 10,
      now: clock.now,
    });
    clock.advance(60_000);
    expect(bucket.balance()).toBe(2);
  });

  it('retry-after hint reflects deficit / refill rate', () => {
    const clock = new Clock(0);
    const bucket = new TokenBucket({
      capacity: 1,
      refillPerSecond: 0.5,
      now: clock.now,
    });
    expect(bucket.tryTake().ok).toBe(true);
    const res = bucket.tryTake();
    if (res.ok) throw new Error('expected refusal');
    // 1 token deficit / 0.5 tps = 2s
    expect(res.retryAfterSeconds).toBe(2);
  });

  it('retry-after is at least 1 second', () => {
    const clock = new Clock(0);
    const bucket = new TokenBucket({
      capacity: 1,
      refillPerSecond: 100,
      now: clock.now,
    });
    expect(bucket.tryTake().ok).toBe(true);
    const res = bucket.tryTake();
    if (res.ok) throw new Error('expected refusal');
    expect(res.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});
