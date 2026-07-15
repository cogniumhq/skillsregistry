// ══════════════════════════════════════════════════════════════════════════════
// ConfidenceGate — three-tier routing orchestrator
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import { ConfidenceGate } from './confidence-gate.js';
import { CompositionDetector } from './composition-detector.js';
import { DeepSearch } from './deep-search.js';
import { Reranker } from './reranker.js';
import { CircuitBreaker } from '../resilience/circuit-breaker.js';
import type { AfterResponse } from '../adapters/after-response.js';
import type { SearchCachePort } from '../adapters/search-cache.js';
import type { SearchLoggerPort } from '../adapters/search-logger.js';
import type { SqlPool } from '../adapters/sql.js';
import type { SearchProvider } from '../providers/search-provider.js';
import type { RerankerBackend } from './reranker-backend.js';
import type {
  FindSkillResponse,
  ScoredSkill,
  SearchFilters,
  SearchResult,
  SearchLogEntry,
} from '../types.js';

// ──────────────────────────────────────────────────────────────────────────────
// Test doubles
// ──────────────────────────────────────────────────────────────────────────────

function candidate(skillId: string, fusedScore: number): ScoredSkill {
  return {
    skillId,
    vectorScore: fusedScore,
    fullTextScore: 0,
    fusedScore,
    matchSource: 'agent_summary',
  };
}

function fakeResult(
  results: ScoredSkill[],
  keywordHits = 0
): SearchResult {
  const top = results[0]?.fusedScore ?? 0;
  const gap = results.length > 1 ? top - results[1]!.fusedScore : results.length ? 1.0 : 0;
  return {
    results,
    confidence: {
      topScore: top,
      gapToSecond: gap,
      clusterDensity: results.length,
      keywordHits,
      tier: 3,
    },
    meta: {
      vectorSearchMs: 5,
      fullTextSearchMs: 5,
      fusionStrategy: 'linear',
      totalCandidates: results.length,
    },
  };
}

function makeProvider(result: SearchResult): SearchProvider {
  return {
    search: vi.fn(async () => result),
    index: vi.fn(),
    delete: vi.fn(),
    healthCheck: vi.fn(async () => ({ ok: true, latencyMs: 0 })),
  } as unknown as SearchProvider;
}

function makeCache(hit: FindSkillResponse | null = null): SearchCachePort {
  return {
    get: vi.fn(async () => hit),
    set: vi.fn(async () => undefined),
  };
}

function makeLogger(): SearchLoggerPort {
  const entries: SearchLogEntry[] = [];
  return {
    buildLogEntry: vi.fn((input) => input as SearchLogEntry),
    log: vi.fn(async (e) => {
      entries.push(e);
    }),
    estimateEmbeddingCost: vi.fn(() => 0.00001),
  } as SearchLoggerPort & { entries?: SearchLogEntry[] };
}

function makePool(rows: any[] = []): SqlPool {
  return {
    query: vi.fn(async () => ({ rows, rowCount: rows.length })),
    connect: vi.fn(),
  } as unknown as SqlPool;
}

function makeAfterResponse(): AfterResponse & { tasks: (() => Promise<void>)[] } {
  const tasks: (() => Promise<void>)[] = [];
  return {
    run: (task) => {
      tasks.push(task);
    },
    tasks,
  } as AfterResponse & { tasks: (() => Promise<void>)[] };
}

// Composition + DeepSearch + Reranker doubles — use real classes with stub deps.
function makeComposition() {
  return new CompositionDetector({
    llm: { identity: 'stub', complete: vi.fn(async () => JSON.stringify({ is_composition: false, parts: [], reasoning: 'x' })) },
    provider: makeProvider(fakeResult([])),
    embedFn: async () => [0],
    circuitBreaker: new CircuitBreaker(),
  });
}

function makeDeepSearch(altResult?: SearchResult) {
  return new DeepSearch({
    llm: {
      identity: 'stub',
      complete: vi.fn(async () =>
        JSON.stringify({
          alternate_queries: ['alt'],
          terminology_map: {},
          needs_composition: false,
          composition_parts: [],
          capability_hints: [],
          reasoning: 'r',
        })
      ),
    },
    provider: makeProvider(altResult ?? fakeResult([])),
    embedFn: async () => [0],
    circuitBreaker: new CircuitBreaker(),
  });
}

function makeReranker() {
  const backend: RerankerBackend = {
    identity: 'stub',
    score: vi.fn(async (_q, texts) => texts.map(() => 0.5)),
  };
  return new Reranker({
    pool: makePool(),
    circuitBreaker: new CircuitBreaker(),
    backend,
  });
}

// Builds a fully-wired gate with baseline doubles + result payload.
function makeGate(
  result: SearchResult,
  overrides: Partial<Parameters<typeof ConfidenceGate.prototype.constructor>[0]> = {},
  skillRows: any[] = []
) {
  const provider = makeProvider(result);
  const cache = makeCache();
  const logger = makeLogger();
  const pool = makePool(skillRows);
  const gate = new ConfidenceGate({
    provider,
    embedFn: async () => new Array(512).fill(0.01),
    cache,
    logger,
    pool,
    deepSearch: makeDeepSearch(result),
    compositionDetector: makeComposition(),
    reranker: makeReranker(),
    ...overrides,
  });
  return { gate, provider, cache, logger, pool };
}

const SKILL_ROW = {
  id: 'sk_a',
  name: 'skill a',
  slug: 'a/a',
  version: '1.0.0',
  agent_summary: 'summary',
  trust_score: '0.7',
  execution_layer: 'sandbox',
  mcp_url: null,
  capabilities_required: [],
  skill_type: 'atomic',
  status: 'published',
  verification_tier: 'unverified',
  trust_badge: null,
  forked_from: null,
  run_count: '3',
  last_run_at: null,
  revoked_reason: null,
  remediation_message: null,
  remediation_url: null,
  replacement_skill_id: null,
  replacement_slug: null,
  tags: ['t'],
  avg_execution_time_ms: null,
  error_rate: null,
  human_star_count: '1',
  human_fork_count: '0',
  agent_invocation_count: '10',
  composition_inclusion_count: '0',
  runtime_env: 'api',
  visibility: 'public',
  publisher_key_id: null,
  signature_verified_at: null,
  signature_failure_reason: null,
  author_handle: 'me',
  author_type: 'human',
};

// ──────────────────────────────────────────────────────────────────────────────
// Constructor defaults
// ──────────────────────────────────────────────────────────────────────────────

describe('ConfidenceGate — constructor defaults', () => {
  it('defaults to linear thresholds (0.62 / 0.58) when fusionMode is not set', () => {
    const { gate } = makeGate(fakeResult([]));
    expect((gate as any).tier1Threshold).toBe(0.62);
    expect((gate as any).tier2Threshold).toBe(0.58);
  });

  it('defaults to rrf thresholds (0.03 / 0.018) when fusionMode=rrf', () => {
    const { gate } = makeGate(fakeResult([]), { fusionMode: 'rrf' });
    expect((gate as any).tier1Threshold).toBe(0.03);
    expect((gate as any).tier2Threshold).toBe(0.018);
  });

  it('respects explicit threshold overrides', () => {
    const { gate } = makeGate(fakeResult([]), {
      tier1Threshold: 0.9,
      tier2Threshold: 0.5,
    });
    expect((gate as any).tier1Threshold).toBe(0.9);
    expect((gate as any).tier2Threshold).toBe(0.5);
  });

  it('defaults gapThreshold=0.05, skipRerankerGap=0.1, nameBoostWeight=0.15', () => {
    const { gate } = makeGate(fakeResult([]));
    expect((gate as any).gapThreshold).toBe(0.05);
    expect((gate as any).skipRerankerGap).toBe(0.1);
    expect((gate as any).nameBoostWeight).toBe(0.15);
  });

  it('defaults defaultAppetite=balanced', () => {
    const { gate } = makeGate(fakeResult([]));
    expect((gate as any).defaultAppetite).toBe('balanced');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// assessConfidence (private, tested via findSkill outcome)
// ──────────────────────────────────────────────────────────────────────────────

describe('ConfidenceGate — tier assessment via findSkill', () => {
  it('routes empty results to tier 3', async () => {
    const { gate } = makeGate(fakeResult([]));
    const out = await gate.findSkill('q', 't', {}, makeAfterResponse());
    expect(out.meta.tier).toBe(3);
  });

  it('routes topScore >= tier1 AND gap >= gapThreshold to tier 1', async () => {
    // Two results: top=0.7, second=0.6 (gap 0.1 > 0.05)
    const result = fakeResult([candidate('a', 0.7), candidate('b', 0.6)]);
    const { gate } = makeGate(result, {}, [{ ...SKILL_ROW, id: 'a' }]);
    const out = await gate.findSkill('q', 't', {}, makeAfterResponse());
    expect(out.meta.tier).toBe(1);
    expect(out.confidence).toBe('high');
  });

  it('routes topScore >= tier1 with keywordHits>0 (small gap) to tier 1', async () => {
    const result = fakeResult([candidate('a', 0.7), candidate('b', 0.68)], 1);
    const { gate } = makeGate(result, {}, [{ ...SKILL_ROW, id: 'a' }]);
    const out = await gate.findSkill('q', 't', {}, makeAfterResponse());
    expect(out.meta.tier).toBe(1);
  });

  it('routes topScore in [tier2, tier1) to tier 2', async () => {
    const result = fakeResult([candidate('a', 0.59), candidate('b', 0.55)]);
    const { gate } = makeGate(result, {}, [{ ...SKILL_ROW, id: 'a' }]);
    const out = await gate.findSkill('q', 't', {}, makeAfterResponse());
    expect(out.meta.tier).toBe(2);
    expect(out.confidence).toBe('medium');
  });

  it('routes topScore below tier2 to tier 3', async () => {
    const result = fakeResult([candidate('a', 0.2)]);
    const { gate } = makeGate(result, {}, [{ ...SKILL_ROW, id: 'a' }]);
    const out = await gate.findSkill('q', 't', {}, makeAfterResponse());
    expect(out.meta.tier).toBe(3);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Explicit-filter overrides — Cortex-shape minTrust + allowVulnerable
// (cortex.md §6.2). When the caller sets them, they override the
// appetite-derived defaults; when absent, appetite drives.
// ──────────────────────────────────────────────────────────────────────────────

describe('ConfidenceGate — minTrust + allowVulnerable overrides', () => {
  it('threads explicit minTrust into SearchFilters, overriding appetite', async () => {
    const { gate, provider } = makeGate(fakeResult([]));
    await gate.findSkill(
      'q',
      't',
      { appetite: 'strict', minTrust: 0.42 },
      makeAfterResponse(),
    );
    const call = (provider.search as any).mock.calls[0]!;
    const filters = call[2] as SearchFilters;
    // Explicit override — should NOT be strict's 0.85.
    expect(filters.minTrustScore).toBe(0.42);
  });

  it('falls back to appetiteToTrustThreshold when minTrust is absent', async () => {
    const { gate, provider } = makeGate(fakeResult([]));
    await gate.findSkill('q', 't', { appetite: 'strict' }, makeAfterResponse());
    const filters = (provider.search as any).mock.calls[0]![2] as SearchFilters;
    expect(filters.minTrustScore).toBe(0.85);
  });

  it('threads explicit allowVulnerable into SearchFilters', async () => {
    const { gate, provider } = makeGate(fakeResult([]));
    await gate.findSkill(
      'q',
      't',
      { appetite: 'strict', allowVulnerable: true },
      makeAfterResponse(),
    );
    const filters = (provider.search as any).mock.calls[0]![2] as SearchFilters;
    // Explicit override — strict would default to false via
    // appetiteToAllowVulnerable, but we passed true.
    expect(filters.allowVulnerable).toBe(true);
  });

  it('falls back to appetiteToAllowVulnerable when absent (balanced → true)', async () => {
    const { gate, provider } = makeGate(fakeResult([]));
    await gate.findSkill(
      'q',
      't',
      { appetite: 'balanced' },
      makeAfterResponse(),
    );
    const filters = (provider.search as any).mock.calls[0]![2] as SearchFilters;
    expect(filters.allowVulnerable).toBe(true);
  });

  it('threads a 4-band visibility (tenant_private) into SearchFilters', async () => {
    const { gate, provider } = makeGate(fakeResult([]));
    await gate.findSkill(
      'q',
      't',
      { visibility: 'tenant_private' },
      makeAfterResponse(),
    );
    const filters = (provider.search as any).mock.calls[0]![2] as SearchFilters;
    expect(filters.visibility).toBe('tenant_private');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Cache path
// ──────────────────────────────────────────────────────────────────────────────

describe('ConfidenceGate — cache short-circuit', () => {
  it('returns the cached response immediately and updates latencyMs', async () => {
    const cached: FindSkillResponse = {
      results: [],
      confidence: 'high',
      enriched: false,
      meta: {
        matchSources: [],
        latencyMs: 999,
        tier: 1,
        cacheHit: true,
        llmInvoked: false,
      },
    };
    const provider = makeProvider(fakeResult([]));
    const cache = makeCache(cached);
    const logger = makeLogger();
    const pool = makePool();
    const gate = new ConfidenceGate({
      provider,
      embedFn: async () => new Array(512).fill(0),
      cache,
      logger,
      pool,
      deepSearch: makeDeepSearch(),
      compositionDetector: makeComposition(),
      reranker: makeReranker(),
    });

    const out = await gate.findSkill('q', 't', {}, makeAfterResponse());
    expect(out).toBe(cached);
    // latencyMs is refreshed (not the stale 999)
    expect(out.meta.latencyMs).toBeLessThan(999);
    // Provider was not called
    expect(provider.search).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Circuit breaker degraded mode
// ──────────────────────────────────────────────────────────────────────────────

describe('ConfidenceGate — degraded mode forces tier 1', () => {
  it('trips circuit breaker + forces tier 1 for a tier-2 assessed result', async () => {
    const result = fakeResult([candidate('a', 0.59), candidate('b', 0.55)]);
    const { gate } = makeGate(result, {}, [{ ...SKILL_ROW, id: 'a' }]);
    // Trip the internal circuit breaker
    const cb = (gate as any).circuitBreaker as CircuitBreaker;
    (cb as any).state = 'open';
    (cb as any).lastFailureTime = Date.now();

    const out = await gate.findSkill('q', 't', {}, makeAfterResponse());
    expect(out.meta.tier).toBe(1);
    expect((out.meta as any).degraded).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Tier 3 without deep search
// ──────────────────────────────────────────────────────────────────────────────

describe('ConfidenceGate — tier 3 with deep search disabled', () => {
  it('returns unenriched results when deepSearchEnabled=false', async () => {
    const result = fakeResult([candidate('a', 0.1)]);
    const { gate } = makeGate(
      result,
      { deepSearchEnabled: false },
      [{ ...SKILL_ROW, id: 'a' }]
    );

    const out = await gate.findSkill('q', 't', {}, makeAfterResponse());
    expect(out.meta.tier).toBe(3);
    expect(out.enriched).toBe(false);
    expect(out.meta.llmInvoked).toBe(false);
    expect(out.confidence).toBe('low_enriched');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Reranker gating at T1 (skipRerankerGap)
// ──────────────────────────────────────────────────────────────────────────────

describe('ConfidenceGate — reranker gap gate (T1)', () => {
  it('skips reranker when T1 gap is >= skipRerankerGap', async () => {
    const result = fakeResult([candidate('a', 0.9), candidate('b', 0.7)]); // gap 0.2 >= 0.1
    const provider = makeProvider(result);
    const cache = makeCache();
    const logger = makeLogger();
    const pool = makePool([
      { ...SKILL_ROW, id: 'a' },
      { ...SKILL_ROW, id: 'b' },
    ]);
    const reranker = makeReranker();
    const spy = vi.spyOn(reranker, 'rerank');

    const gate = new ConfidenceGate({
      provider,
      embedFn: async () => [0],
      cache,
      logger,
      pool,
      deepSearch: makeDeepSearch(),
      compositionDetector: makeComposition(),
      reranker,
      rerankerEnabled: true,
    });

    const out = await gate.findSkill('q', 't', {}, makeAfterResponse());
    expect(out.meta.tier).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it('runs reranker when T1 gap is < skipRerankerGap', async () => {
    // gap 0.02 < 0.1
    const result = fakeResult([candidate('a', 0.7), candidate('b', 0.68)]);
    const provider = makeProvider(result);
    const pool = makePool([
      { ...SKILL_ROW, id: 'a' },
      { ...SKILL_ROW, id: 'b' },
    ]);
    const reranker = makeReranker();
    const spy = vi
      .spyOn(reranker, 'rerank')
      .mockResolvedValue({ results: result.results, applied: true });

    const gate = new ConfidenceGate({
      provider,
      embedFn: async () => [0],
      cache: makeCache(),
      logger: makeLogger(),
      pool,
      deepSearch: makeDeepSearch(),
      compositionDetector: makeComposition(),
      reranker,
      rerankerEnabled: true,
    });

    const out = await gate.findSkill('q', 't', {}, makeAfterResponse());
    expect(spy).toHaveBeenCalledOnce();
    expect((out.meta as any).reranked).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// findSkill: deferred work
// ──────────────────────────────────────────────────────────────────────────────

describe('ConfidenceGate — deferred logging + caching', () => {
  it('fires both log() and cache.set() through afterResponse (never inline)', async () => {
    const result = fakeResult([candidate('a', 0.7), candidate('b', 0.5)]);
    const provider = makeProvider(result);
    const cache = makeCache();
    const logger = makeLogger();
    const pool = makePool([{ ...SKILL_ROW, id: 'a' }]);
    const after = makeAfterResponse();

    const gate = new ConfidenceGate({
      provider,
      embedFn: async () => [0],
      cache,
      logger,
      pool,
      deepSearch: makeDeepSearch(),
      compositionDetector: makeComposition(),
      reranker: makeReranker(),
    });

    await gate.findSkill('q', 'tenant_a', { appetite: 'aggressive' }, after);

    // The response returns before log/cache.set are awaited
    expect(logger.log).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
    // But two tasks are queued
    expect(after.tasks).toHaveLength(2);

    // Drain them
    for (const t of after.tasks) await t();
    expect(logger.log).toHaveBeenCalledOnce();
    expect(cache.set).toHaveBeenCalledOnce();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Name-boost re-ranking
// ──────────────────────────────────────────────────────────────────────────────

describe('ConfidenceGate — name-boost', () => {
  it('boosts results whose name contains query tokens', async () => {
    const result = fakeResult([candidate('sk_a', 0.5), candidate('sk_b', 0.55)]);
    const provider = makeProvider(result);
    const pool = makePool([
      { ...SKILL_ROW, id: 'sk_a', name: 'lint-rust', slug: 'a' },
      { ...SKILL_ROW, id: 'sk_b', name: 'other-tool', slug: 'b' },
    ]);
    const gate = new ConfidenceGate({
      provider,
      embedFn: async () => [0],
      cache: makeCache(),
      logger: makeLogger(),
      pool,
      deepSearch: makeDeepSearch(),
      compositionDetector: makeComposition(),
      reranker: makeReranker(),
    });

    const out = await gate.findSkill('lint rust', 't', {}, makeAfterResponse());
    // sk_a boosted above sk_b even though sk_b had higher raw score.
    // Query tokens ['lint', 'rust'] both match 'lint-rust' → overlap 1.0.
    // sk_a score: 0.5 * (1 + 0.15 * 1.0) = 0.575 > 0.55 (sk_b unchanged).
    expect(out.results[0]!.id).toBe('sk_a');
    expect(out.results[0]!.score).toBeCloseTo(0.575, 3);
  });

  it('does not reorder when nameBoostWeight=0', async () => {
    const result = fakeResult([candidate('sk_a', 0.5), candidate('sk_b', 0.55)]);
    const provider = makeProvider(result);
    const pool = makePool([
      { ...SKILL_ROW, id: 'sk_a', name: 'lint-rust', slug: 'a' },
      { ...SKILL_ROW, id: 'sk_b', name: 'other-tool', slug: 'b' },
    ]);
    const gate = new ConfidenceGate({
      provider,
      embedFn: async () => [0],
      cache: makeCache(),
      logger: makeLogger(),
      pool,
      deepSearch: makeDeepSearch(),
      compositionDetector: makeComposition(),
      reranker: makeReranker(),
      nameBoostWeight: 0,
    });

    const out = await gate.findSkill('lint rust', 't', {}, makeAfterResponse());
    expect(out.results[0]!.id).toBe('sk_b'); // no reorder
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Deduplication by name
// ──────────────────────────────────────────────────────────────────────────────

describe('ConfidenceGate — cross-source dedup by name', () => {
  it('collapses duplicate names, keeping the higher score', async () => {
    const result = fakeResult([
      candidate('sk_a', 0.5),
      candidate('sk_b', 0.9),
      candidate('sk_c', 0.3),
    ]);
    const provider = makeProvider(result);
    const pool = makePool([
      { ...SKILL_ROW, id: 'sk_a', name: 'DuplicateName', slug: 'x/a' },
      { ...SKILL_ROW, id: 'sk_b', name: 'duplicatename', slug: 'x/b' },
      { ...SKILL_ROW, id: 'sk_c', name: 'unique', slug: 'y/c' },
    ]);
    const gate = new ConfidenceGate({
      provider,
      embedFn: async () => [0],
      cache: makeCache(),
      logger: makeLogger(),
      pool,
      deepSearch: makeDeepSearch(),
      compositionDetector: makeComposition(),
      reranker: makeReranker(),
      nameBoostWeight: 0,
    });

    const out = await gate.findSkill('q', 't', {}, makeAfterResponse());
    expect(out.results).toHaveLength(2);
    // Higher-score version wins
    expect(out.results.find((r) => r.id === 'sk_b')).toBeDefined();
    expect(out.results.find((r) => r.id === 'sk_a')).toBeUndefined();
  });
});
