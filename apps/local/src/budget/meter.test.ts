import type { BudgetResponse } from '@skillsregistry/contracts';
import type { KvAdapter } from '@skillsregistry/domain/adapters';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BudgetConfig } from '../config.js';
import { budgetKey, type TrustClientLogger } from '../trust-client.js';
import type { UpstreamClient } from '../upstream-client/index.js';
import { UpstreamError } from '../upstream-client/index.js';
import {
  BudgetMeter,
  type ScheduledJob,
  type Scheduler,
} from './meter.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const TENANT = 'tenant-abc';

const CONFIG: BudgetConfig = {
  refreshCron: '0 3 * * *',
  ttlSeconds: 93_600,
};

function budgetResponse(overrides: Partial<BudgetResponse> = {}): BudgetResponse {
  return {
    tenant_id: TENANT,
    plan: 'starter',
    tokens_total: 10_000,
    tokens_remaining: 5_000,
    tokens_reset_at: '2026-07-01T00:00:00.000Z',
    low_balance: false,
    ...overrides,
  };
}

// ── Test doubles ────────────────────────────────────────────────────────────

class InMemoryKv implements KvAdapter {
  readonly store = new Map<string, { value: string; ttl?: number }>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key)?.value ?? null;
  }
  async put(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.store.set(key, { value, ...(ttlSeconds !== undefined ? { ttl: ttlSeconds } : {}) });
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

function fakeUpstream(getBudget: () => Promise<BudgetResponse>): UpstreamClient {
  return { getBudget } as unknown as UpstreamClient;
}

function silentLogger(): TrustClientLogger & {
  infos: Array<{ msg: string; meta?: Record<string, unknown> }>;
  warns: Array<{ msg: string; meta?: Record<string, unknown> }>;
  errors: Array<{ msg: string; meta?: Record<string, unknown> }>;
} {
  const infos: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
  const warns: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
  const errors: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
  return {
    info: (msg, meta) => infos.push({ msg, ...(meta !== undefined ? { meta } : {}) }),
    warn: (msg, meta) => warns.push({ msg, ...(meta !== undefined ? { meta } : {}) }),
    error: (msg, meta) => errors.push({ msg, ...(meta !== undefined ? { meta } : {}) }),
    infos,
    warns,
    errors,
  };
}

/** Scheduler stub that captures the callback so tests can trigger it. */
class StubScheduler implements Scheduler {
  captured: Array<{ cron: string; callback: () => void | Promise<void> }> = [];
  stops = 0;
  schedule(cronExpr: string, callback: () => void | Promise<void>): ScheduledJob {
    this.captured.push({ cron: cronExpr, callback });
    const self = this;
    return {
      stop: () => {
        self.stops += 1;
      },
    };
  }
  /** Fire the most recently scheduled callback (i.e., simulate a cron tick). */
  async trigger(): Promise<void> {
    const last = this.captured[this.captured.length - 1];
    if (last === undefined) throw new Error('no scheduled job');
    await last.callback();
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('BudgetMeter.refresh', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('fetches upstream, writes snapshot to KV with configured TTL, returns snapshot', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-28T12:00:00.000Z'));
    const kv = new InMemoryKv();
    const upstream = fakeUpstream(async () => budgetResponse({ tokens_remaining: 4_200 }));
    const meter = new BudgetMeter({
      upstream,
      kv,
      config: CONFIG,
      tenantId: TENANT,
      scheduler: new StubScheduler(),
      logger: silentLogger(),
    });

    const snapshot = await meter.refresh();

    expect(snapshot).toEqual({
      tenantId: TENANT,
      plan: 'starter',
      tokensTotal: 10_000,
      tokensRemaining: 4_200,
      tokensResetAt: '2026-07-01T00:00:00.000Z',
      lowBalance: false,
      cachedAt: '2026-06-28T12:00:00.000Z',
    });
    const stored = kv.store.get(budgetKey(TENANT));
    expect(stored).toBeDefined();
    expect(stored?.ttl).toBe(93_600);
    expect(JSON.parse(stored!.value)).toEqual(snapshot);
  });

  it('returns null and skips upstream call in air-gap mode', async () => {
    const kv = new InMemoryKv();
    const called = vi.fn(async () => budgetResponse());
    const upstream = fakeUpstream(called);
    const meter = new BudgetMeter({
      upstream,
      kv,
      config: CONFIG,
      tenantId: null,
      scheduler: new StubScheduler(),
      logger: silentLogger(),
    });

    const snapshot = await meter.refresh();

    expect(snapshot).toBeNull();
    expect(called).not.toHaveBeenCalled();
    expect(kv.store.size).toBe(0);
  });

  it('propagates UpstreamError to caller (admin route path)', async () => {
    const kv = new InMemoryKv();
    const upstream = fakeUpstream(async () => {
      throw new UpstreamError('upstream_not_configured', 'no mothership');
    });
    const meter = new BudgetMeter({
      upstream,
      kv,
      config: CONFIG,
      tenantId: TENANT,
      scheduler: new StubScheduler(),
      logger: silentLogger(),
    });

    await expect(meter.refresh()).rejects.toBeInstanceOf(UpstreamError);
    expect(kv.store.size).toBe(0);
  });
});

describe('BudgetMeter.getCached', () => {
  it('returns null on air-gap', async () => {
    const kv = new InMemoryKv();
    const meter = new BudgetMeter({
      upstream: fakeUpstream(async () => budgetResponse()),
      kv,
      config: CONFIG,
      tenantId: null,
      scheduler: new StubScheduler(),
      logger: silentLogger(),
    });
    expect(await meter.getCached()).toBeNull();
  });

  it('returns null on missing key', async () => {
    const kv = new InMemoryKv();
    const meter = new BudgetMeter({
      upstream: fakeUpstream(async () => budgetResponse()),
      kv,
      config: CONFIG,
      tenantId: TENANT,
      scheduler: new StubScheduler(),
      logger: silentLogger(),
    });
    expect(await meter.getCached()).toBeNull();
  });

  it('round-trips a snapshot through refresh → getCached', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-28T12:00:00.000Z'));
    const kv = new InMemoryKv();
    const meter = new BudgetMeter({
      upstream: fakeUpstream(async () => budgetResponse({ tokens_remaining: 3_333 })),
      kv,
      config: CONFIG,
      tenantId: TENANT,
      scheduler: new StubScheduler(),
      logger: silentLogger(),
    });

    await meter.refresh();
    const cached = await meter.getCached();

    expect(cached).toEqual({
      tenantId: TENANT,
      plan: 'starter',
      tokensTotal: 10_000,
      tokensRemaining: 3_333,
      tokensResetAt: '2026-07-01T00:00:00.000Z',
      lowBalance: false,
      cachedAt: '2026-06-28T12:00:00.000Z',
    });
    vi.useRealTimers();
  });

  it('returns null and warns on malformed cached JSON', async () => {
    const kv = new InMemoryKv();
    await kv.put(budgetKey(TENANT), '{not json');
    const logger = silentLogger();
    const meter = new BudgetMeter({
      upstream: fakeUpstream(async () => budgetResponse()),
      kv,
      config: CONFIG,
      tenantId: TENANT,
      scheduler: new StubScheduler(),
      logger,
    });
    expect(await meter.getCached()).toBeNull();
    expect(logger.warns.some((w) => w.msg.includes('JSON parse failed'))).toBe(true);
  });

  it('returns null and warns on shape mismatch', async () => {
    const kv = new InMemoryKv();
    await kv.put(budgetKey(TENANT), JSON.stringify({ tenantId: TENANT, plan: 'starter' }));
    const logger = silentLogger();
    const meter = new BudgetMeter({
      upstream: fakeUpstream(async () => budgetResponse()),
      kv,
      config: CONFIG,
      tenantId: TENANT,
      scheduler: new StubScheduler(),
      logger,
    });
    expect(await meter.getCached()).toBeNull();
    expect(logger.warns.some((w) => w.msg.includes('shape mismatch'))).toBe(true);
  });

  it('returns null and warns when kv.get throws', async () => {
    const kv: KvAdapter = {
      get: async () => {
        throw new Error('boom');
      },
      put: async () => {},
      delete: async () => {},
    };
    const logger = silentLogger();
    const meter = new BudgetMeter({
      upstream: fakeUpstream(async () => budgetResponse()),
      kv,
      config: CONFIG,
      tenantId: TENANT,
      scheduler: new StubScheduler(),
      logger,
    });
    expect(await meter.getCached()).toBeNull();
    expect(logger.warns.some((w) => w.msg.includes('kv read failed'))).toBe(true);
  });
});

describe('BudgetMeter.start / stop', () => {
  it('no-op in air-gap mode: scheduler never called, no upstream refresh', async () => {
    const kv = new InMemoryKv();
    const scheduler = new StubScheduler();
    const called = vi.fn(async () => budgetResponse());
    const upstream = fakeUpstream(called);
    const meter = new BudgetMeter({
      upstream,
      kv,
      config: CONFIG,
      tenantId: null,
      scheduler,
      logger: silentLogger(),
    });

    meter.start();

    expect(scheduler.captured).toHaveLength(0);
    // Give any accidentally-scheduled boot refresh a chance to run.
    await Promise.resolve();
    expect(called).not.toHaveBeenCalled();
  });

  it('runs a boot refresh then schedules the cron with the configured expr', async () => {
    const kv = new InMemoryKv();
    const scheduler = new StubScheduler();
    const upstream = fakeUpstream(async () => budgetResponse());
    const meter = new BudgetMeter({
      upstream,
      kv,
      config: CONFIG,
      tenantId: TENANT,
      scheduler,
      logger: silentLogger(),
    });

    meter.start();

    expect(scheduler.captured).toHaveLength(1);
    expect(scheduler.captured[0]?.cron).toBe(CONFIG.refreshCron);
    // Boot refresh is scheduled via `void this.safeRefresh(...)`; wait a tick.
    await new Promise((resolve) => setImmediate(resolve));
    expect(kv.store.has(budgetKey(TENANT))).toBe(true);
  });

  it('start() is idempotent: second call does not re-schedule', () => {
    const scheduler = new StubScheduler();
    const meter = new BudgetMeter({
      upstream: fakeUpstream(async () => budgetResponse()),
      kv: new InMemoryKv(),
      config: CONFIG,
      tenantId: TENANT,
      scheduler,
      logger: silentLogger(),
    });
    meter.start();
    meter.start();
    expect(scheduler.captured).toHaveLength(1);
  });

  it('boot-refresh failure is swallowed (error logged, cron still scheduled)', async () => {
    const kv = new InMemoryKv();
    const scheduler = new StubScheduler();
    const upstream = fakeUpstream(async () => {
      throw new UpstreamError('rate_limited', 'busy');
    });
    const logger = silentLogger();
    const meter = new BudgetMeter({
      upstream,
      kv,
      config: CONFIG,
      tenantId: TENANT,
      scheduler,
      logger,
    });

    meter.start();
    await new Promise((resolve) => setImmediate(resolve));

    expect(scheduler.captured).toHaveLength(1);
    expect(logger.errors.some((e) => e.msg === 'refresh failed')).toBe(true);
  });

  it('cron tick refresh failure is swallowed', async () => {
    const kv = new InMemoryKv();
    const scheduler = new StubScheduler();
    let calls = 0;
    const upstream = fakeUpstream(async () => {
      calls += 1;
      if (calls === 1) return budgetResponse();
      throw new UpstreamError('circuit_open', 'breaker open');
    });
    const logger = silentLogger();
    const meter = new BudgetMeter({
      upstream,
      kv,
      config: CONFIG,
      tenantId: TENANT,
      scheduler,
      logger,
    });

    meter.start();
    await new Promise((resolve) => setImmediate(resolve));
    await scheduler.trigger();

    expect(calls).toBe(2);
    expect(
      logger.errors.some((e) => e.msg === 'refresh failed' && e.meta?.trigger === 'cron'),
    ).toBe(true);
  });

  it('stop() tears down the scheduled job; safe to call before start', () => {
    const scheduler = new StubScheduler();
    const meter = new BudgetMeter({
      upstream: fakeUpstream(async () => budgetResponse()),
      kv: new InMemoryKv(),
      config: CONFIG,
      tenantId: TENANT,
      scheduler,
      logger: silentLogger(),
    });

    meter.stop(); // pre-start
    expect(scheduler.stops).toBe(0);

    meter.start();
    meter.stop();
    meter.stop(); // idempotent
    expect(scheduler.stops).toBe(1);
  });
});

describe('BudgetMeter low-balance transitions', () => {
  it('emits warn on first refresh with lowBalance=true', async () => {
    const kv = new InMemoryKv();
    const logger = silentLogger();
    const meter = new BudgetMeter({
      upstream: fakeUpstream(async () =>
        budgetResponse({ tokens_remaining: 500, low_balance: true }),
      ),
      kv,
      config: CONFIG,
      tenantId: TENANT,
      scheduler: new StubScheduler(),
      logger,
    });

    await meter.refresh();

    const lowWarns = logger.warns.filter((w) => w.msg === 'low balance');
    expect(lowWarns).toHaveLength(1);
    expect(lowWarns[0]?.meta).toMatchObject({
      tenantId: TENANT,
      tokensRemaining: 500,
      tokensTotal: 10_000,
    });
  });

  it('does not emit warn when lowBalance stays false', async () => {
    const kv = new InMemoryKv();
    const logger = silentLogger();
    const meter = new BudgetMeter({
      upstream: fakeUpstream(async () => budgetResponse({ low_balance: false })),
      kv,
      config: CONFIG,
      tenantId: TENANT,
      scheduler: new StubScheduler(),
      logger,
    });

    await meter.refresh();
    await meter.refresh();

    expect(logger.warns.filter((w) => w.msg === 'low balance')).toHaveLength(0);
  });

  it('emits warn only on false→true transition (not on repeat true ticks)', async () => {
    const kv = new InMemoryKv();
    const logger = silentLogger();
    let iteration = 0;
    const upstream = fakeUpstream(async () => {
      iteration += 1;
      // 1: healthy, 2: low, 3: still low, 4: healthy, 5: low again
      if (iteration === 1) return budgetResponse({ low_balance: false });
      if (iteration === 2) return budgetResponse({ tokens_remaining: 500, low_balance: true });
      if (iteration === 3) return budgetResponse({ tokens_remaining: 400, low_balance: true });
      if (iteration === 4) return budgetResponse({ low_balance: false });
      return budgetResponse({ tokens_remaining: 200, low_balance: true });
    });
    const meter = new BudgetMeter({
      upstream,
      kv,
      config: CONFIG,
      tenantId: TENANT,
      scheduler: new StubScheduler(),
      logger,
    });

    for (let i = 0; i < 5; i += 1) await meter.refresh();

    // Expect exactly two warnings: at iteration 2 and iteration 5.
    expect(logger.warns.filter((w) => w.msg === 'low balance')).toHaveLength(2);
  });
});
