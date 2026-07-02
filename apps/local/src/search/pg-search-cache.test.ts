// ══════════════════════════════════════════════════════════════════════════════
// PgSearchCache — key format, TTL, serialization, error-swallow.
// ══════════════════════════════════════════════════════════════════════════════

import { describe, expect, it, vi } from 'vitest';
import type { PgKv } from '../adapters/pg-kv.js';
import type { FindSkillResponse } from '@skillsregistry/domain/types';
import { PgSearchCache, cacheKey } from './pg-search-cache.js';

function makeKv(): {
  kv: PgKv;
  puts: Array<{ key: string; value: string; ttl?: number }>;
  getMock: ReturnType<typeof vi.fn>;
} {
  const puts: Array<{ key: string; value: string; ttl?: number }> = [];
  const getMock = vi.fn(async (_key: string) => null as string | null);
  const kv = {
    get: getMock,
    put: async (key: string, value: string, ttlSeconds?: number) => {
      puts.push({ key, value, ttl: ttlSeconds });
    },
    delete: async () => {},
  } as unknown as PgKv;
  return { kv, puts, getMock };
}

function makeResponse(): FindSkillResponse {
  return {
    results: [],
    confidence: 'high',
    enriched: false,
    meta: {
      matchSources: [],
      latencyMs: 0,
      tier: 1,
      cacheHit: false,
      llmInvoked: false,
    },
  };
}

describe('cacheKey', () => {
  it('produces the same key for equivalent queries after trim + lowercase', () => {
    const a = cacheKey('  Hello WORLD  ', 't1', 'balanced');
    const b = cacheKey('hello world', 't1', 'balanced');
    expect(a).toBe(b);
  });

  it('differs across tenants and appetites', () => {
    const a = cacheKey('hello', 't1', 'balanced');
    const b = cacheKey('hello', 't2', 'balanced');
    const c = cacheKey('hello', 't1', 'strict');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('uses the v1 prefix', () => {
    expect(cacheKey('hi', 'a', 'b').startsWith('search:v1:a:b:')).toBe(true);
  });
});

describe('PgSearchCache', () => {
  const cfg = { ttlTier1: 3600, ttlTier2: 1800, ttlTier3: 600 };

  it('applies the tier-1 TTL on set', async () => {
    const { kv, puts } = makeKv();
    const cache = new PgSearchCache({ kv, ...cfg });
    await cache.set('q', 't', 'balanced', makeResponse(), 1);
    expect(puts).toHaveLength(1);
    expect(puts[0]!.ttl).toBe(3600);
  });

  it('applies the tier-2 TTL on set', async () => {
    const { kv, puts } = makeKv();
    const cache = new PgSearchCache({ kv, ...cfg });
    await cache.set('q', 't', 'balanced', makeResponse(), 2);
    expect(puts[0]!.ttl).toBe(1800);
  });

  it('applies the tier-3 TTL on set (also for unknown tiers)', async () => {
    const { kv, puts } = makeKv();
    const cache = new PgSearchCache({ kv, ...cfg });
    await cache.set('q', 't', 'balanced', makeResponse(), 3);
    expect(puts[0]!.ttl).toBe(600);
  });

  it('never persists the enrichmentPromise field', async () => {
    const { kv, puts } = makeKv();
    const cache = new PgSearchCache({ kv, ...cfg });
    const withPromise = makeResponse();
    // deliberately attach an unserializable promise
    (withPromise as FindSkillResponse & { enrichmentPromise: Promise<unknown> }).enrichmentPromise =
      Promise.resolve({});
    await cache.set('q', 't', 'balanced', withPromise, 1);
    const persisted = JSON.parse(puts[0]!.value) as Record<string, unknown>;
    expect(persisted.enrichmentPromise).toBeUndefined();
  });

  it('parses persisted JSON on get', async () => {
    const { kv, getMock } = makeKv();
    getMock.mockImplementationOnce(async () =>
      JSON.stringify(makeResponse()),
    );
    const cache = new PgSearchCache({ kv, ...cfg });
    const hit = await cache.get('q', 't', 'balanced');
    expect(hit).not.toBeNull();
    expect(hit!.confidence).toBe('high');
  });

  it('returns null on kv.get error (miss)', async () => {
    const { kv, getMock } = makeKv();
    getMock.mockImplementationOnce(async () => {
      throw new Error('kv down');
    });
    const cache = new PgSearchCache({ kv, ...cfg });
    const hit = await cache.get('q', 't', 'balanced');
    expect(hit).toBeNull();
  });

  it('returns null on invalid JSON (miss)', async () => {
    const { kv, getMock } = makeKv();
    getMock.mockImplementationOnce(async () => 'not-json');
    const cache = new PgSearchCache({ kv, ...cfg });
    const hit = await cache.get('q', 't', 'balanced');
    expect(hit).toBeNull();
  });

  it('swallows kv.put errors on set', async () => {
    const kv = {
      get: async () => null,
      put: async () => {
        throw new Error('kv down');
      },
      delete: async () => {},
    } as unknown as PgKv;
    const cache = new PgSearchCache({ kv, ...cfg });
    await expect(
      cache.set('q', 't', 'balanced', makeResponse(), 1),
    ).resolves.toBeUndefined();
  });
});
