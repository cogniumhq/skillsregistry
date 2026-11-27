import { describe, it, expect, vi } from 'vitest';
import type { AfterResponse } from '../adapters/after-response.js';
import type { KvAdapter } from '../adapters/kv.js';
import {
  LLMProxyRateLimitExceeded,
  LLMProxyRateLimiter,
} from './tenant-rate-limiter.js';

function makeKv(store: Record<string, string> = {}): KvAdapter {
  const data = { ...store };
  return {
    get: vi.fn(async (key: string) => data[key] ?? null),
    put: vi.fn(async (key: string, value: string, _ttl?: number) => {
      data[key] = value;
    }),
  };
}

describe('LLMProxyRateLimiter', () => {
  it('degrades open when no KV adapter is provided', async () => {
    const limiter = new LLMProxyRateLimiter();
    await expect(limiter.enforce('tenant-a')).resolves.toBeUndefined();
  });

  it('defaults rpm to 600 when options omit or pass non-positive rpm', () => {
    expect(new LLMProxyRateLimiter().limit).toBe(600);
    expect(new LLMProxyRateLimiter({ rpm: 0 }).limit).toBe(600);
    expect(new LLMProxyRateLimiter({ rpm: -1 }).limit).toBe(600);
  });

  it('increments the per-minute bucket when under budget', async () => {
    const kv = makeKv();
    const now = 1_700_000_000_000; // fixed clock
    const limiter = new LLMProxyRateLimiter({
      kv,
      rpm: 5,
      now: () => now,
    });
    await limiter.enforce('tenant-a', 'embed');
    expect(kv.put).toHaveBeenCalledWith(
      `llmproxy-rl:embed:tenant-a:${Math.floor(now / 60000)}`,
      '1',
      120,
    );
  });

  it('throws LLMProxyRateLimitExceeded at the cap with retry-after', async () => {
    const minute = 28_333_333;
    const now = minute * 60_000 + 15_000; // 15s into the minute → 45s retry
    const kv = makeKv({
      [`llmproxy-rl:rerank:tenant-b:${minute}`]: '3',
    });
    const limiter = new LLMProxyRateLimiter({
      kv,
      rpm: 3,
      now: () => now,
    });
    await expect(limiter.enforce('tenant-b', 'rerank')).rejects.toMatchObject({
      name: 'LLMProxyRateLimitExceeded',
      tenantId: 'tenant-b',
      stage: 'rerank',
      limit: 3,
      retryAfterSeconds: 45,
    } satisfies Partial<LLMProxyRateLimitExceeded>);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('defers counter writes via afterResponse on the hot path', async () => {
    const kv = makeKv();
    const run = vi.fn((task: () => Promise<void>) => {
      void task();
    });
    const afterResponse: AfterResponse = { run };
    const limiter = new LLMProxyRateLimiter({ kv, rpm: 10, afterResponse });
    await limiter.enforce('tenant-c');
    expect(run).toHaveBeenCalled();
    await new Promise((r) => setImmediate(r));
    expect(kv.put).toHaveBeenCalled();
  });

  it('awaits kv.put inline when afterResponse is omitted', async () => {
    const kv = makeKv();
    const limiter = new LLMProxyRateLimiter({ kv, rpm: 10 });
    await limiter.enforce('tenant-d');
    expect(kv.put).toHaveBeenCalledTimes(1);
  });
});