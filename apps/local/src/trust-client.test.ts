import type {
  TrustScoreRequest,
  TrustScoreResponse,
} from '@skillsregistry/contracts';
import type { KvAdapter } from '@skillsregistry/domain/adapters';
import type { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TRUST_BUDGET_KEY_PREFIX,
  TrustClient,
  type BudgetSnapshot,
  type TrustClientLogger,
  budgetKey,
  snapshotFromBudget,
} from './trust-client.js';
import { UpstreamError } from './upstream-client/errors.js';
import type { UpstreamClient } from './upstream-client/index.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const TENANT = 'tenant-abc';

const OK_RESPONSE: TrustScoreResponse = {
  skill_id: 'skill-42',
  trust_score: 0.87,
  trust_tier: 'A',
  trust_breakdown: { safety: 0.9, quality: 0.85 },
  scored_at: '2026-06-28T12:00:00.000Z',
  tokens_consumed: 150,
};

const OK_REQUEST: TrustScoreRequest = { skill_id: 'skill-42' };

// ── Test doubles ────────────────────────────────────────────────────────────

class InMemoryKv implements KvAdapter {
  readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

interface FakePoolCall {
  text: string;
  values: unknown[];
}

function fakePool(rowCount = 1): {
  pool: Pool;
  calls: FakePoolCall[];
} {
  const calls: FakePoolCall[] = [];
  const pool = {
    query: async (text: string, values: unknown[]) => {
      calls.push({ text, values });
      return { rows: [], rowCount };
    },
  } as unknown as Pool;
  return { pool, calls };
}

function fakeUpstream(impl: () => Promise<TrustScoreResponse>): UpstreamClient {
  return { trustScore: impl } as unknown as UpstreamClient;
}

function silentLogger(): TrustClientLogger & {
  warns: Array<{ msg: string; meta?: Record<string, unknown> }>;
  errors: Array<{ msg: string; meta?: Record<string, unknown> }>;
} {
  const warns: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
  const errors: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
  return {
    info: () => {},
    warn: (msg, meta) => warns.push({ msg, ...(meta !== undefined ? { meta } : {}) }),
    error: (msg, meta) => errors.push({ msg, ...(meta !== undefined ? { meta } : {}) }),
    warns,
    errors,
  };
}

function snapshot(overrides: Partial<BudgetSnapshot> = {}): BudgetSnapshot {
  return {
    tenantId: TENANT,
    plan: 'starter',
    tokensTotal: 10_000,
    tokensRemaining: 5_000,
    tokensResetAt: '2026-07-01T00:00:00.000Z',
    lowBalance: false,
    cachedAt: '2026-06-28T10:00:00.000Z',
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('budgetKey / TRUST_BUDGET_KEY_PREFIX', () => {
  it('composes the versioned key', () => {
    expect(budgetKey('tenant-x')).toBe(`${TRUST_BUDGET_KEY_PREFIX}tenant-x`);
    expect(TRUST_BUDGET_KEY_PREFIX).toBe('trust:budget:v1:');
  });
});

describe('snapshotFromBudget', () => {
  it('maps BudgetResponse fields into snapshot shape and stamps cachedAt', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-28T12:34:56.000Z'));
    const snap = snapshotFromBudget({
      tenant_id: 'tenant-x',
      plan: 'growth',
      tokens_total: 100_000,
      tokens_remaining: 5_000,
      tokens_reset_at: '2026-07-01T00:00:00.000Z',
      low_balance: true,
    });
    expect(snap).toEqual({
      tenantId: 'tenant-x',
      plan: 'growth',
      tokensTotal: 100_000,
      tokensRemaining: 5_000,
      tokensResetAt: '2026-07-01T00:00:00.000Z',
      lowBalance: true,
      cachedAt: '2026-06-28T12:34:56.000Z',
    });
    vi.useRealTimers();
  });
});

describe('TrustClient.getCachedBudget', () => {
  it('returns null when tenantId is null (air-gap)', async () => {
    const kv = new InMemoryKv();
    const client = new TrustClient({
      upstream: fakeUpstream(async () => OK_RESPONSE),
      kv,
      pool: fakePool().pool,
      tenantId: null,
    });
    expect(await client.getCachedBudget()).toBeNull();
  });

  it('returns null when the key is absent', async () => {
    const kv = new InMemoryKv();
    const client = new TrustClient({
      upstream: fakeUpstream(async () => OK_RESPONSE),
      kv,
      pool: fakePool().pool,
      tenantId: TENANT,
    });
    expect(await client.getCachedBudget()).toBeNull();
  });

  it('parses a stored snapshot', async () => {
    const kv = new InMemoryKv();
    const snap = snapshot();
    kv.store.set(budgetKey(TENANT), JSON.stringify(snap));
    const client = new TrustClient({
      upstream: fakeUpstream(async () => OK_RESPONSE),
      kv,
      pool: fakePool().pool,
      tenantId: TENANT,
    });
    expect(await client.getCachedBudget()).toEqual(snap);
  });

  it('returns null and warns on malformed JSON', async () => {
    const kv = new InMemoryKv();
    kv.store.set(budgetKey(TENANT), '{not-json');
    const log = silentLogger();
    const client = new TrustClient({
      upstream: fakeUpstream(async () => OK_RESPONSE),
      kv,
      pool: fakePool().pool,
      tenantId: TENANT,
      logger: log,
    });
    expect(await client.getCachedBudget()).toBeNull();
    expect(log.warns.some((w) => w.msg.includes('JSON parse'))).toBe(true);
  });

  it('returns null and warns on shape mismatch', async () => {
    const kv = new InMemoryKv();
    kv.store.set(budgetKey(TENANT), JSON.stringify({ tenantId: TENANT }));
    const log = silentLogger();
    const client = new TrustClient({
      upstream: fakeUpstream(async () => OK_RESPONSE),
      kv,
      pool: fakePool().pool,
      tenantId: TENANT,
      logger: log,
    });
    expect(await client.getCachedBudget()).toBeNull();
    expect(log.warns.some((w) => w.msg.includes('shape mismatch'))).toBe(true);
  });

  it('returns null and warns when KV throws', async () => {
    const kv = {
      get: async () => {
        throw new Error('boom');
      },
      put: async () => {},
      delete: async () => {},
    } as KvAdapter;
    const log = silentLogger();
    const client = new TrustClient({
      upstream: fakeUpstream(async () => OK_RESPONSE),
      kv,
      pool: fakePool().pool,
      tenantId: TENANT,
      logger: log,
    });
    expect(await client.getCachedBudget()).toBeNull();
    expect(log.warns.some((w) => w.msg.includes('kv read failed'))).toBe(true);
  });
});

describe('TrustClient.score — happy path', () => {
  it('calls upstream, persists to skills, decrements cached budget', async () => {
    const kv = new InMemoryKv();
    kv.store.set(budgetKey(TENANT), JSON.stringify(snapshot()));
    const { pool, calls } = fakePool(1);
    const upstreamSpy = vi.fn(async () => OK_RESPONSE);
    const client = new TrustClient({
      upstream: fakeUpstream(upstreamSpy),
      kv,
      pool,
      tenantId: TENANT,
    });

    const result = await client.score(OK_REQUEST);

    expect(upstreamSpy).toHaveBeenCalledOnce();
    expect(upstreamSpy).toHaveBeenCalledWith(OK_REQUEST);
    expect(result.response).toEqual(OK_RESPONSE);

    // Persistence — one UPDATE with the exact positional args.
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.text).toMatch(/UPDATE skills[\s\S]+trust_score_v2[\s\S]+WHERE id = \$5/);
    expect(call.values[0]).toBe(OK_RESPONSE.trust_score);
    expect(call.values[1]).toBe(OK_RESPONSE.trust_tier);
    expect(JSON.parse(call.values[2] as string)).toEqual(OK_RESPONSE.trust_breakdown);
    expect(call.values[3]).toBeInstanceOf(Date);
    expect(call.values[4]).toBe(OK_RESPONSE.skill_id);

    // Budget decrement — 5000 - 150 = 4850, still above the 10% low-balance
    // line (< 1000), so lowBalance stays false.
    expect(result.budget).not.toBeNull();
    expect(result.budget!.tokensRemaining).toBe(4_850);
    expect(result.budget!.lowBalance).toBe(false);

    // KV re-write
    const written = JSON.parse(kv.store.get(budgetKey(TENANT))!) as BudgetSnapshot;
    expect(written.tokensRemaining).toBe(4_850);
  });

  it('flips lowBalance when the decrement crosses the 10% line', async () => {
    const kv = new InMemoryKv();
    kv.store.set(
      budgetKey(TENANT),
      JSON.stringify(snapshot({ tokensTotal: 10_000, tokensRemaining: 1_100 })),
    );
    const { pool } = fakePool(1);
    const client = new TrustClient({
      upstream: fakeUpstream(async () => ({ ...OK_RESPONSE, tokens_consumed: 200 })),
      kv,
      pool,
      tenantId: TENANT,
    });
    const result = await client.score(OK_REQUEST);
    expect(result.budget!.tokensRemaining).toBe(900);
    expect(result.budget!.lowBalance).toBe(true);
  });

  it('clamps tokensRemaining at 0 when consumed exceeds the cache', async () => {
    const kv = new InMemoryKv();
    kv.store.set(
      budgetKey(TENANT),
      JSON.stringify(snapshot({ tokensRemaining: 100 })),
    );
    const { pool } = fakePool(1);
    const client = new TrustClient({
      upstream: fakeUpstream(async () => ({ ...OK_RESPONSE, tokens_consumed: 500 })),
      kv,
      pool,
      tenantId: TENANT,
    });
    const result = await client.score(OK_REQUEST);
    expect(result.budget!.tokensRemaining).toBe(0);
    expect(result.budget!.lowBalance).toBe(true);
  });

  it('returns budget=null when no cached snapshot exists', async () => {
    const kv = new InMemoryKv();
    const { pool } = fakePool(1);
    const client = new TrustClient({
      upstream: fakeUpstream(async () => OK_RESPONSE),
      kv,
      pool,
      tenantId: TENANT,
    });
    const result = await client.score(OK_REQUEST);
    expect(result.budget).toBeNull();
    // KV is untouched — no snapshot to decrement.
    expect(kv.store.size).toBe(0);
  });

  it('returns budget=null in air-gap mode (tenantId null) but still calls upstream', async () => {
    const kv = new InMemoryKv();
    const { pool } = fakePool(1);
    const upstreamSpy = vi.fn(async () => OK_RESPONSE);
    const client = new TrustClient({
      upstream: fakeUpstream(upstreamSpy),
      kv,
      pool,
      tenantId: null,
    });
    const result = await client.score(OK_REQUEST);
    expect(upstreamSpy).toHaveBeenCalledOnce();
    expect(result.budget).toBeNull();
  });
});

describe('TrustClient.score — budget precheck', () => {
  it('short-circuits when cached tokensRemaining <= 0 without calling upstream', async () => {
    const kv = new InMemoryKv();
    kv.store.set(
      budgetKey(TENANT),
      JSON.stringify(snapshot({ tokensRemaining: 0, lowBalance: true })),
    );
    const { pool, calls } = fakePool(1);
    const upstreamSpy = vi.fn(async () => OK_RESPONSE);
    const log = silentLogger();
    const client = new TrustClient({
      upstream: fakeUpstream(upstreamSpy),
      kv,
      pool,
      tenantId: TENANT,
      logger: log,
    });

    await expect(client.score(OK_REQUEST)).rejects.toMatchObject({
      name: 'UpstreamError',
      code: 'budget_exhausted',
      detail: expect.objectContaining({
        tokens_remaining: 0,
        source: 'local_cache',
      }),
    });

    expect(upstreamSpy).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    expect(log.warns.some((w) => w.msg.includes('budget precheck'))).toBe(true);
  });
});

describe('TrustClient.score — persistence resilience', () => {
  it('logs a warning when UPDATE matches no rows, still returns the score', async () => {
    const kv = new InMemoryKv();
    const { pool } = fakePool(0); // 0 rows updated
    const log = silentLogger();
    const client = new TrustClient({
      upstream: fakeUpstream(async () => OK_RESPONSE),
      kv,
      pool,
      tenantId: TENANT,
      logger: log,
    });
    const result = await client.score(OK_REQUEST);
    expect(result.response).toEqual(OK_RESPONSE);
    expect(
      log.warns.some((w) => w.msg.includes('persist: no local skills row')),
    ).toBe(true);
  });

  it('logs an error and continues when the UPDATE throws', async () => {
    const kv = new InMemoryKv();
    const pool = {
      query: async () => {
        throw new Error('db down');
      },
    } as unknown as Pool;
    const log = silentLogger();
    const client = new TrustClient({
      upstream: fakeUpstream(async () => OK_RESPONSE),
      kv,
      pool,
      tenantId: TENANT,
      logger: log,
    });
    const result = await client.score(OK_REQUEST);
    expect(result.response).toEqual(OK_RESPONSE);
    expect(log.errors.some((e) => e.msg.includes('persist failed'))).toBe(true);
  });
});

describe('TrustClient.score — upstream error passthrough', () => {
  it('propagates UpstreamError from upstream.trustScore unchanged', async () => {
    const kv = new InMemoryKv();
    const { pool, calls } = fakePool(1);
    const err = new UpstreamError('upstream_not_configured', 'air-gap');
    const client = new TrustClient({
      upstream: fakeUpstream(async () => {
        throw err;
      }),
      kv,
      pool,
      tenantId: null,
    });
    await expect(client.score(OK_REQUEST)).rejects.toBe(err);
    // No persistence should have run.
    expect(calls).toHaveLength(0);
  });

  it('propagates upstream budget_exhausted without touching KV', async () => {
    const kv = new InMemoryKv();
    kv.store.set(budgetKey(TENANT), JSON.stringify(snapshot()));
    const { pool } = fakePool(1);
    const err = new UpstreamError('budget_exhausted', 'out of tokens', {
      retryAfter: 3600,
    });
    const client = new TrustClient({
      upstream: fakeUpstream(async () => {
        throw err;
      }),
      kv,
      pool,
      tenantId: TENANT,
    });
    await expect(client.score(OK_REQUEST)).rejects.toBe(err);
    // Cached budget untouched — it was fine at precheck; the mothership
    // disagreed. T-2.9's meter will reconcile on next poll.
    const written = JSON.parse(kv.store.get(budgetKey(TENANT))!) as BudgetSnapshot;
    expect(written.tokensRemaining).toBe(5_000);
  });
});
