import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CircuitBreaker } from './circuit-breaker.js';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker(3, 1000); // 3 failures, 1s cooldown
  });

  it('should start in closed state', () => {
    expect(breaker.currentState).toBe('closed');
    expect(breaker.isOpen).toBe(false);
  });

  it('should pass through successful calls', async () => {
    const { result, degraded } = await breaker.execute(
      async () => 'success',
      'fallback'
    );

    expect(result).toBe('success');
    expect(degraded).toBe(false);
    expect(breaker.currentState).toBe('closed');
  });

  it('should retry once on first failure then succeed', async () => {
    let attempts = 0;
    const { result, degraded } = await breaker.execute(
      async () => {
        attempts++;
        if (attempts === 1) throw new Error('transient');
        return 'recovered';
      },
      'fallback'
    );

    expect(result).toBe('recovered');
    expect(degraded).toBe(false);
    expect(attempts).toBe(2);
    expect(breaker.currentState).toBe('closed');
  });

  it('should use fallback after both attempts fail', async () => {
    const { result, degraded } = await breaker.execute(
      async () => {
        throw new Error('persistent');
      },
      'fallback'
    );

    expect(result).toBe('fallback');
    expect(degraded).toBe(true);
    expect(breaker.currentState).toBe('closed'); // 1 failure, threshold is 3
  });

  it('should open circuit after threshold consecutive failures', async () => {
    // Fail 3 times (each has 2 attempts internally = 6 actual calls)
    for (let i = 0; i < 3; i++) {
      await breaker.execute(
        async () => {
          throw new Error('fail');
        },
        'fallback'
      );
    }

    expect(breaker.currentState).toBe('open');
    expect(breaker.isOpen).toBe(true);
  });

  it('should short-circuit to fallback when open', async () => {
    // Open the circuit
    for (let i = 0; i < 3; i++) {
      await breaker.execute(async () => { throw new Error('fail'); }, 'fb');
    }

    const fn = vi.fn(async () => 'should-not-run');
    const { result, degraded } = await breaker.execute(fn, 'fallback');

    expect(result).toBe('fallback');
    expect(degraded).toBe(true);
    expect(fn).not.toHaveBeenCalled();
  });

  it('should reset consecutive failures on success', async () => {
    // 2 failures (below threshold of 3)
    await breaker.execute(async () => { throw new Error('fail'); }, 'fb');
    await breaker.execute(async () => { throw new Error('fail'); }, 'fb');

    // Success resets counter
    await breaker.execute(async () => 'ok', 'fb');

    // 2 more failures should not open circuit
    await breaker.execute(async () => { throw new Error('fail'); }, 'fb');
    await breaker.execute(async () => { throw new Error('fail'); }, 'fb');

    expect(breaker.currentState).toBe('closed');
  });

  it('should transition to half-open after cooldown', async () => {
    // Use a breaker with very short cooldown
    const fastBreaker = new CircuitBreaker(2, 50);

    // Open the circuit
    await fastBreaker.execute(async () => { throw new Error('fail'); }, 'fb');
    await fastBreaker.execute(async () => { throw new Error('fail'); }, 'fb');
    expect(fastBreaker.currentState).toBe('open');

    // Wait for cooldown
    await new Promise((r) => setTimeout(r, 60));

    // isOpen should now return false (transitions to half-open)
    expect(fastBreaker.isOpen).toBe(false);
    expect(fastBreaker.currentState).toBe('half-open');
  });

  it('should close circuit on success after half-open', async () => {
    const fastBreaker = new CircuitBreaker(2, 50);

    // Open the circuit
    await fastBreaker.execute(async () => { throw new Error('fail'); }, 'fb');
    await fastBreaker.execute(async () => { throw new Error('fail'); }, 'fb');

    // Wait for cooldown
    await new Promise((r) => setTimeout(r, 60));

    // Successful call should close the circuit
    const { result, degraded } = await fastBreaker.execute(
      async () => 'recovered',
      'fallback'
    );

    expect(result).toBe('recovered');
    expect(degraded).toBe(false);
    expect(fastBreaker.currentState).toBe('closed');
  });

  it('should re-open circuit on failure in half-open state', async () => {
    const fastBreaker = new CircuitBreaker(1, 50); // threshold=1 for quick test

    // Open the circuit
    await fastBreaker.execute(async () => { throw new Error('fail'); }, 'fb');
    expect(fastBreaker.currentState).toBe('open');

    // Wait for cooldown
    await new Promise((r) => setTimeout(r, 60));

    // Fail again in half-open → should re-open
    await fastBreaker.execute(async () => { throw new Error('fail again'); }, 'fb');
    expect(fastBreaker.currentState).toBe('open');
  });

  it('should reset state via reset()', () => {
    breaker.reset();
    expect(breaker.currentState).toBe('closed');
    expect(breaker.isOpen).toBe(false);
  });
});
