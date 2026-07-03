// ══════════════════════════════════════════════════════════════════════════════
// CompositionDetector — LLM-driven multi-skill query detection
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import { CompositionDetector } from './composition-detector.js';
import { CircuitBreaker } from '../resilience/circuit-breaker.js';
import type { LlmAdapter } from '../adapters/llm.js';
import type { SearchProvider } from '../providers/search-provider.js';
import type { SearchResult } from '../types.js';

// ──────────────────────────────────────────────────────────────────────────────
// Doubles
// ──────────────────────────────────────────────────────────────────────────────

function stubLlm(body: string | (() => string)): LlmAdapter {
  return {
    identity: 'stub',
    complete: vi.fn(async () => (typeof body === 'function' ? body() : body)),
  };
}

function llmThrows(): LlmAdapter {
  return {
    identity: 'stub-fail',
    complete: vi.fn(async () => {
      throw new Error('llm down');
    }),
  };
}

function stubProvider(
  perQuery: Record<string, SearchResult>
): SearchProvider {
  const provider: Partial<SearchProvider> = {
    search: vi.fn(async (query: string) => {
      return (
        perQuery[query] ?? {
          results: [],
          confidence: { topScore: 0, gapToSecond: 0, clusterDensity: 0, keywordHits: 0, tier: 3 },
          meta: { vectorSearchMs: 0, fullTextSearchMs: 0, fusionStrategy: 'linear' as const, totalCandidates: 0 },
        }
      );
    }),
  };
  return provider as SearchProvider;
}

function fakeSearchResult(skillId: string): SearchResult {
  return {
    results: [
      {
        skillId,
        vectorScore: 0.9,
        fullTextScore: 0,
        fusedScore: 0.9,
        matchSource: 'agent_summary',
      },
    ],
    confidence: { topScore: 0.9, gapToSecond: 1.0, clusterDensity: 1, keywordHits: 0, tier: 1 },
    meta: { vectorSearchMs: 5, fullTextSearchMs: 5, fusionStrategy: 'linear', totalCandidates: 1 },
  };
}

const embedZero = async () => new Array(512).fill(0);

// ──────────────────────────────────────────────────────────────────────────────
// Positive detection
// ──────────────────────────────────────────────────────────────────────────────

describe('CompositionDetector — positive detection', () => {
  it('detects a composition query and searches each part', async () => {
    const detector = new CompositionDetector({
      llm: stubLlm(
        JSON.stringify({
          is_composition: true,
          parts: ['lint rust', 'run tests'],
          reasoning: 'two-step workflow',
        })
      ),
      provider: stubProvider({
        'lint rust': fakeSearchResult('clippy'),
        'run tests': fakeSearchResult('cargo-test'),
      }),
      embedFn: embedZero,
      circuitBreaker: new CircuitBreaker(),
    });

    const out = await detector.detect('lint rust and run tests', [], {
      tenantId: 'tenant_a',
    });

    expect(out.detected).toBe(true);
    expect(out.reasoning).toBe('two-step workflow');
    expect(out.parts).toHaveLength(2);
    expect(out.parts[0]!.purpose).toBe('lint rust');
    expect(out.parts[0]!.skill?.skillId).toBe('clippy');
    expect(out.parts[1]!.purpose).toBe('run tests');
    expect(out.parts[1]!.skill?.skillId).toBe('cargo-test');
  });

  it('handles a part with no matching skill (null)', async () => {
    const detector = new CompositionDetector({
      llm: stubLlm(
        JSON.stringify({ is_composition: true, parts: ['exotic'], reasoning: 'r' })
      ),
      provider: stubProvider({}), // no matches
      embedFn: embedZero,
      circuitBreaker: new CircuitBreaker(),
    });

    const out = await detector.detect('exotic', [], { tenantId: 't' });
    expect(out.detected).toBe(true);
    expect(out.parts[0]!.skill).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Negative detection
// ──────────────────────────────────────────────────────────────────────────────

describe('CompositionDetector — negative detection', () => {
  it('returns detected=false when LLM says is_composition=false', async () => {
    const detector = new CompositionDetector({
      llm: stubLlm(
        JSON.stringify({ is_composition: false, parts: [], reasoning: 'single' })
      ),
      provider: stubProvider({}),
      embedFn: embedZero,
      circuitBreaker: new CircuitBreaker(),
    });

    const out = await detector.detect('format', [], { tenantId: 't' });
    expect(out.detected).toBe(false);
    expect(out.parts).toEqual([]);
    expect(out.reasoning).toBe('single');
  });

  it('returns detected=false when parts array is empty', async () => {
    const detector = new CompositionDetector({
      llm: stubLlm(JSON.stringify({ is_composition: true, parts: [] })),
      provider: stubProvider({}),
      embedFn: embedZero,
      circuitBreaker: new CircuitBreaker(),
    });

    const out = await detector.detect('format', [], { tenantId: 't' });
    expect(out.detected).toBe(false);
  });

  it('returns detected=false when parts is not an array', async () => {
    const detector = new CompositionDetector({
      llm: stubLlm(JSON.stringify({ is_composition: true, parts: 'nope' })),
      provider: stubProvider({}),
      embedFn: embedZero,
      circuitBreaker: new CircuitBreaker(),
    });

    const out = await detector.detect('format', [], { tenantId: 't' });
    expect(out.detected).toBe(false);
  });

  it('falls back to default reasoning when LLM omits it', async () => {
    const detector = new CompositionDetector({
      llm: stubLlm(JSON.stringify({ is_composition: false, parts: [] })),
      provider: stubProvider({}),
      embedFn: embedZero,
      circuitBreaker: new CircuitBreaker(),
    });

    const out = await detector.detect('format', [], { tenantId: 't' });
    expect(out.reasoning).toBe('Single-skill query');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Circuit-breaker degraded
// ──────────────────────────────────────────────────────────────────────────────

describe('CompositionDetector — circuit-breaker degraded', () => {
  it('returns not-detected + circuit-breaker reason when circuit is open', async () => {
    const cb = new CircuitBreaker(1, 60_000);
    // Trip it
    await cb.execute(async () => {
      throw new Error('boom');
    }, null);

    const detector = new CompositionDetector({
      llm: stubLlm('irrelevant'),
      provider: stubProvider({}),
      embedFn: embedZero,
      circuitBreaker: cb,
    });

    const out = await detector.detect('anything', [], { tenantId: 't' });
    expect(out.detected).toBe(false);
    expect(out.reasoning).toContain('circuit breaker');
  }, 10_000);
});
