// ══════════════════════════════════════════════════════════════════════════════
// DeepSearch — LLM query expansion (tier 2) + full deep search (tier 3)
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import { DeepSearch } from './deep-search.js';
import { CircuitBreaker } from '../resilience/circuit-breaker.js';
import type { LlmAdapter } from '../adapters/llm.js';
import type { SearchProvider } from '../providers/search-provider.js';
import type { ScoredSkill, SearchResult } from '../types.js';

// ──────────────────────────────────────────────────────────────────────────────
// Doubles
// ──────────────────────────────────────────────────────────────────────────────

function stubLlm(body: string): LlmAdapter {
  return { identity: 'stub', complete: vi.fn(async () => body) };
}

function llmThrows(): LlmAdapter {
  return {
    identity: 'stub',
    complete: vi.fn(async () => {
      throw new Error('boom');
    }),
  };
}

function candidate(skillId: string, fusedScore: number, matchSource = 'agent_summary'): ScoredSkill {
  return {
    skillId,
    vectorScore: fusedScore,
    fullTextScore: 0,
    fusedScore,
    matchSource,
  };
}

function fakeResult(results: ScoredSkill[], keywordHits = 0): SearchResult {
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

function stubProvider(perQuery: Record<string, SearchResult>): SearchProvider {
  const provider: Partial<SearchProvider> = {
    search: vi.fn(async (query: string) => {
      return perQuery[query] ?? fakeResult([]);
    }),
  };
  return provider as SearchProvider;
}

const embedZero = async () => new Array(512).fill(0);

// ──────────────────────────────────────────────────────────────────────────────
// Constructor & threshold defaults
// ──────────────────────────────────────────────────────────────────────────────

describe('DeepSearch — constructor defaults', () => {
  it('defaults tier2Threshold to 0.42 in linear mode', () => {
    const ds = new DeepSearch({
      llm: stubLlm('[]'),
      provider: stubProvider({}),
      embedFn: embedZero,
      circuitBreaker: new CircuitBreaker(),
    });
    expect((ds as any).tier2Threshold).toBe(0.42);
  });

  it('defaults tier2Threshold to 0.018 in rrf mode', () => {
    const ds = new DeepSearch({
      llm: stubLlm('[]'),
      provider: stubProvider({}),
      embedFn: embedZero,
      circuitBreaker: new CircuitBreaker(),
      fusionMode: 'rrf',
    });
    expect((ds as any).tier2Threshold).toBe(0.018);
  });

  it('honors explicit tier2Threshold override', () => {
    const ds = new DeepSearch({
      llm: stubLlm('[]'),
      provider: stubProvider({}),
      embedFn: embedZero,
      circuitBreaker: new CircuitBreaker(),
      tier2Threshold: 0.99,
    });
    expect((ds as any).tier2Threshold).toBe(0.99);
  });

  it('defaults maxTokens to 500', () => {
    const ds = new DeepSearch({
      llm: stubLlm('[]'),
      provider: stubProvider({}),
      embedFn: embedZero,
      circuitBreaker: new CircuitBreaker(),
    });
    expect((ds as any).maxTokens).toBe(500);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// generateAlternateQueries
// ──────────────────────────────────────────────────────────────────────────────

describe('DeepSearch.generateAlternateQueries', () => {
  it('parses a JSON array from the LLM and caps at 3', async () => {
    const ds = new DeepSearch({
      llm: stubLlm(JSON.stringify(['q1', 'q2', 'q3', 'q4'])),
      provider: stubProvider({}),
      embedFn: embedZero,
      circuitBreaker: new CircuitBreaker(),
    });
    const out = await ds.generateAlternateQueries('foo');
    expect(out).toEqual(['q1', 'q2', 'q3']);
  });

  it('returns [] when the LLM response is not an array', async () => {
    const ds = new DeepSearch({
      llm: stubLlm(JSON.stringify({ not: 'an array' })),
      provider: stubProvider({}),
      embedFn: embedZero,
      circuitBreaker: new CircuitBreaker(),
    });
    const out = await ds.generateAlternateQueries('foo');
    expect(out).toEqual([]);
  });

  it('returns [] on LLM throw (circuit breaker fallback)', async () => {
    const ds = new DeepSearch({
      llm: llmThrows(),
      provider: stubProvider({}),
      embedFn: embedZero,
      circuitBreaker: new CircuitBreaker(),
    });
    const out = await ds.generateAlternateQueries('foo');
    expect(out).toEqual([]);
  }, 10_000);
});

// ──────────────────────────────────────────────────────────────────────────────
// expandAndReSearch (tier 2)
// ──────────────────────────────────────────────────────────────────────────────

describe('DeepSearch.expandAndReSearch (tier 2)', () => {
  it('merges initial + alternate results, deduping by skillId, keeping best score', async () => {
    const initial = fakeResult([candidate('a', 0.5)]);
    const alt = fakeResult([candidate('a', 0.9), candidate('b', 0.4)]);

    const ds = new DeepSearch({
      llm: stubLlm('[]'), // not used because preGenerated is passed
      provider: stubProvider({ alt_q: alt }),
      embedFn: embedZero,
      circuitBreaker: new CircuitBreaker(),
    });

    const merged = await ds.expandAndReSearch('orig', initial, { tenantId: 't' }, ['alt_q']);

    expect(merged.results.map((r) => r.skillId)).toEqual(['a', 'b']);
    expect(merged.results[0]!.fusedScore).toBe(0.9); // best-of a
    expect(merged.confidence.topScore).toBe(0.9);
    expect(merged.confidence.gapToSecond).toBeCloseTo(0.5);
  });

  it('returns initial unchanged when no alternate queries are available', async () => {
    const initial = fakeResult([candidate('a', 0.5)]);
    const ds = new DeepSearch({
      llm: stubLlm(JSON.stringify([])),
      provider: stubProvider({}),
      embedFn: embedZero,
      circuitBreaker: new CircuitBreaker(),
    });

    const out = await ds.expandAndReSearch('orig', initial, { tenantId: 't' });
    expect(out).toBe(initial);
  });

  it('uses pre-generated queries in preference to LLM call', async () => {
    const llm = stubLlm(JSON.stringify(['should-not-be-used']));
    const initial = fakeResult([candidate('a', 0.5)]);
    const provider = stubProvider({
      pre: fakeResult([candidate('b', 0.6)]),
    });
    const ds = new DeepSearch({
      llm,
      provider,
      embedFn: embedZero,
      circuitBreaker: new CircuitBreaker(),
    });

    const out = await ds.expandAndReSearch('orig', initial, { tenantId: 't' }, ['pre']);
    expect(llm.complete).not.toHaveBeenCalled();
    expect(out.results.map((r) => r.skillId).sort()).toEqual(['a', 'b']);
  });

  it('returns initial on internal error', async () => {
    const initial = fakeResult([candidate('a', 0.5)]);
    const brokenProvider = {
      search: vi.fn(async () => {
        throw new Error('provider down');
      }),
    } as unknown as SearchProvider;

    const ds = new DeepSearch({
      llm: stubLlm(JSON.stringify(['x'])),
      provider: brokenProvider,
      embedFn: embedZero,
      circuitBreaker: new CircuitBreaker(),
    });

    const out = await ds.expandAndReSearch('orig', initial, { tenantId: 't' }, ['x']);
    expect(out).toBe(initial);
  });

  it('computes gapToSecond = 1.0 when the merged set has exactly one result', async () => {
    const initial = fakeResult([]);
    const alt = fakeResult([candidate('only', 0.7)]);
    const ds = new DeepSearch({
      llm: stubLlm('[]'),
      provider: stubProvider({ x: alt }),
      embedFn: embedZero,
      circuitBreaker: new CircuitBreaker(),
    });

    const out = await ds.expandAndReSearch('q', initial, { tenantId: 't' }, ['x']);
    expect(out.results).toHaveLength(1);
    expect(out.confidence.gapToSecond).toBe(1.0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// deepSearch (tier 3)
// ──────────────────────────────────────────────────────────────────────────────

describe('DeepSearch.deepSearch (tier 3)', () => {
  it('merges results + returns trace when LLM succeeds and no composition', async () => {
    const initial = fakeResult([candidate('a', 0.3)]);
    const llmBody = JSON.stringify({
      alternate_queries: ['alt1'],
      terminology_map: { colloquial: 'technical' },
      needs_composition: false,
      composition_parts: [],
      capability_hints: ['read', 'lint'],
      reasoning: 'reasoning text',
    });

    const ds = new DeepSearch({
      llm: stubLlm(llmBody),
      provider: stubProvider({
        alt1: fakeResult([candidate('a', 0.6), candidate('b', 0.5)]),
      }),
      embedFn: embedZero,
      circuitBreaker: new CircuitBreaker(),
    });

    const out = await ds.deepSearch('q', [0], initial, { tenantId: 't' });

    expect(out.trace.alternateQueries).toEqual(['alt1']);
    expect(out.trace.terminologyMap).toEqual({ colloquial: 'technical' });
    expect(out.trace.reasoning).toBe('reasoning text');
    expect(out.composition).toBeUndefined();
    expect(out.noMatch).toBe(false);
    expect(out.result.results.map((r) => r.skillId)).toEqual(['a', 'b']);
  });

  it('emits composition when LLM sets needs_composition=true', async () => {
    const initial = fakeResult([candidate('a', 0.3)]);
    const llmBody = JSON.stringify({
      alternate_queries: [],
      terminology_map: {},
      needs_composition: true,
      composition_parts: ['step1', 'step2'],
      capability_hints: [],
      reasoning: 'multi-step',
    });

    const ds = new DeepSearch({
      llm: stubLlm(llmBody),
      provider: stubProvider({
        step1: fakeResult([candidate('s1', 0.9)]),
        step2: fakeResult([candidate('s2', 0.8)]),
      }),
      embedFn: embedZero,
      circuitBreaker: new CircuitBreaker(),
    });

    const out = await ds.deepSearch('q', [0], initial, { tenantId: 't' });

    expect(out.composition?.detected).toBe(true);
    expect(out.composition?.parts).toHaveLength(2);
    expect(out.composition?.parts[0]!.skill?.skillId).toBe('s1');
    expect(out.composition?.parts[1]!.skill?.skillId).toBe('s2');
    expect(out.composition?.reasoning).toBe('multi-step');
  });

  it('flags noMatch + generationHints when topScore is below tier2 threshold', async () => {
    const initial = fakeResult([candidate('a', 0.1)]);
    const llmBody = JSON.stringify({
      alternate_queries: ['alt'],
      terminology_map: {},
      needs_composition: false,
      composition_parts: [],
      capability_hints: ['cap1'],
      reasoning: 'novel-terminology',
    });

    const ds = new DeepSearch({
      llm: stubLlm(llmBody),
      provider: stubProvider({ alt: fakeResult([candidate('a', 0.15)]) }),
      embedFn: embedZero,
      circuitBreaker: new CircuitBreaker(),
      tier2Threshold: 0.5,
    });

    const out = await ds.deepSearch('q', [0], initial, { tenantId: 't' });
    expect(out.noMatch).toBe(true);
    expect(out.generationHints?.intent).toBe('novel-terminology');
    expect(out.generationHints?.capabilities).toEqual(['cap1']);
    expect(out.generationHints?.complexity).toBe('single');
  });

  it('marks generationHints.complexity=multi-step when composition_parts >= 2', async () => {
    const initial = fakeResult([]);
    const llmBody = JSON.stringify({
      alternate_queries: [],
      terminology_map: {},
      needs_composition: true,
      composition_parts: ['a', 'b', 'c'],
      capability_hints: [],
      reasoning: 'r',
    });

    const ds = new DeepSearch({
      llm: stubLlm(llmBody),
      provider: stubProvider({}),
      embedFn: embedZero,
      circuitBreaker: new CircuitBreaker(),
    });

    const out = await ds.deepSearch('q', [0], initial, { tenantId: 't' });
    expect(out.noMatch).toBe(true);
    expect(out.generationHints?.complexity).toBe('multi-step');
  });

  it('returns initial + LLM-failed trace when LLM throws', async () => {
    const initial = fakeResult([candidate('a', 0.5)]);
    const ds = new DeepSearch({
      llm: llmThrows(),
      provider: stubProvider({}),
      embedFn: embedZero,
      circuitBreaker: new CircuitBreaker(),
    });

    const out = await ds.deepSearch('q', [0], initial, { tenantId: 't' });
    expect(out.result).toBe(initial);
    expect(out.trace.alternateQueries).toEqual([]);
    expect(out.trace.reasoning).toContain('LLM deep search failed');
  }, 10_000);

  it('returns initial + noMatch=true when initial is empty and LLM fails', async () => {
    const initial = fakeResult([]);
    const ds = new DeepSearch({
      llm: llmThrows(),
      provider: stubProvider({}),
      embedFn: embedZero,
      circuitBreaker: new CircuitBreaker(),
    });

    const out = await ds.deepSearch('q', [0], initial, { tenantId: 't' });
    expect(out.noMatch).toBe(true);
  }, 10_000);
});
