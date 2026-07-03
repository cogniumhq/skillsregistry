// ══════════════════════════════════════════════════════════════════════════════
// Reranker — cross-encoder reordering + graceful degradation
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import { Reranker } from './reranker.js';
import type { RerankerBackend } from './reranker-backend.js';
import { CircuitBreaker } from '../resilience/circuit-breaker.js';
import type { SqlPool } from '../adapters/sql.js';
import type { ScoredSkill } from '../types.js';

// ──────────────────────────────────────────────────────────────────────────────
// Test doubles
// ──────────────────────────────────────────────────────────────────────────────

function mockPool(rows: Array<{ id: string; agent_summary: string | null }>): SqlPool {
  return {
    query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }),
    connect: vi.fn(),
  } as unknown as SqlPool;
}

function poolThrows(): SqlPool {
  return {
    query: vi.fn().mockRejectedValue(new Error('db down')),
    connect: vi.fn(),
  } as unknown as SqlPool;
}

function stubBackend(scores: number[] | ((query: string, texts: string[]) => number[])): RerankerBackend {
  return {
    identity: 'stub',
    score: vi.fn(async (query, texts) => {
      if (typeof scores === 'function') return scores(query, texts);
      return scores;
    }),
  };
}

function backendThrows(): RerankerBackend {
  return {
    identity: 'stub-fail',
    score: vi.fn(async () => {
      throw new Error('backend down');
    }),
  };
}

function candidate(skillId: string, fusedScore: number): ScoredSkill {
  return {
    skillId,
    vectorScore: fusedScore,
    fullTextScore: 0,
    fusedScore,
    matchSource: 'agent_summary',
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Fast-path skips
// ──────────────────────────────────────────────────────────────────────────────

describe('Reranker — fast-path skips', () => {
  it('returns unchanged when results is empty', async () => {
    const r = new Reranker({
      pool: mockPool([]),
      circuitBreaker: new CircuitBreaker(),
      backend: stubBackend([]),
    });

    const out = await r.rerank('q', []);
    expect(out.applied).toBe(false);
    expect(out.results).toEqual([]);
  });

  it('returns unchanged when only one result', async () => {
    const r = new Reranker({
      pool: mockPool([]),
      circuitBreaker: new CircuitBreaker(),
      backend: stubBackend([1.0]),
    });

    const only = [candidate('a', 0.9)];
    const out = await r.rerank('q', only);
    expect(out.applied).toBe(false);
    expect(out.results).toEqual(only);
  });

  it('does not call the backend when count <= 1', async () => {
    const backend = stubBackend([]);
    const r = new Reranker({
      pool: mockPool([]),
      circuitBreaker: new CircuitBreaker(),
      backend,
    });
    await r.rerank('q', [candidate('a', 0.9)]);
    expect(backend.score).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Rerank ordering
// ──────────────────────────────────────────────────────────────────────────────

describe('Reranker — cross-encoder reordering', () => {
  it('reorders by cross-encoder score descending', async () => {
    const pool = mockPool([
      { id: 'a', agent_summary: 'sum a' },
      { id: 'b', agent_summary: 'sum b' },
      { id: 'c', agent_summary: 'sum c' },
    ]);
    // Note: score order corresponds to input texts (in candidate order after
    // summary fetch), and the map(id → summary) is used.
    const r = new Reranker({
      pool,
      circuitBreaker: new CircuitBreaker(),
      backend: stubBackend((_q, texts) =>
        // Higher score for later text (i.e. reverse the input order)
        texts.map((_, i) => texts.length - i)
      ),
    });

    const input = [
      candidate('a', 0.9),
      candidate('b', 0.8),
      candidate('c', 0.7),
    ];
    const out = await r.rerank('q', input);

    expect(out.applied).toBe(true);
    expect(out.results.map((r) => r.skillId)).toEqual(['a', 'b', 'c']);
    // fusedScore preserved from original candidates (not overwritten)
    expect(out.results[0]!.fusedScore).toBe(0.9);
    expect(out.results[2]!.fusedScore).toBe(0.7);
  });

  it('preserves the original fusedScore field (rerank only reorders)', async () => {
    const pool = mockPool([
      { id: 'a', agent_summary: 'sa' },
      { id: 'b', agent_summary: 'sb' },
    ]);
    const r = new Reranker({
      pool,
      circuitBreaker: new CircuitBreaker(),
      backend: stubBackend([2.5, 5.0]),
    });

    const input = [candidate('a', 0.9), candidate('b', 0.8)];
    const out = await r.rerank('q', input);

    // b outranks a per backend scores
    expect(out.results[0]!.skillId).toBe('b');
    expect(out.results[0]!.fusedScore).toBe(0.8); // unchanged
    expect(out.results[1]!.fusedScore).toBe(0.9);
  });

  it('slices to topN and appends the tail unchanged', async () => {
    const pool = mockPool([
      { id: 'a', agent_summary: 'sa' },
      { id: 'b', agent_summary: 'sb' },
    ]);
    const r = new Reranker({
      pool,
      circuitBreaker: new CircuitBreaker(),
      backend: stubBackend([1, 5]),
      topN: 2,
    });

    const input = [
      candidate('a', 0.9),
      candidate('b', 0.8),
      candidate('c', 0.7),
      candidate('d', 0.6),
    ];
    const out = await r.rerank('q', input);

    // top-2 reordered, c + d untouched at the tail
    expect(out.results.map((r) => r.skillId)).toEqual(['b', 'a', 'c', 'd']);
    expect(out.applied).toBe(true);
  });

  it('candidates without summaries are pushed to passthrough tail', async () => {
    const pool = mockPool([
      { id: 'a', agent_summary: 'sa' },
      // b has no summary row
      { id: 'c', agent_summary: 'sc' },
    ]);
    const r = new Reranker({
      pool,
      circuitBreaker: new CircuitBreaker(),
      backend: stubBackend([1, 10]),
    });

    const input = [
      candidate('a', 0.9),
      candidate('b', 0.8),
      candidate('c', 0.7),
    ];
    const out = await r.rerank('q', input);

    // a + c reranked (c wins per stub), b in passthrough tail
    expect(out.results.map((r) => r.skillId)).toEqual(['c', 'a', 'b']);
  });

  it('returns unchanged when fewer than 2 candidates have summaries', async () => {
    const pool = mockPool([{ id: 'a', agent_summary: 'sa' }]);
    const r = new Reranker({
      pool,
      circuitBreaker: new CircuitBreaker(),
      backend: stubBackend([1, 2]),
    });

    const input = [candidate('a', 0.9), candidate('b', 0.8)];
    const out = await r.rerank('q', input);
    expect(out.applied).toBe(false);
    expect(out.results).toEqual(input);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Failure paths
// ──────────────────────────────────────────────────────────────────────────────

describe('Reranker — failure & degradation', () => {
  it('returns unchanged when the backend throws (circuit-breaker degraded)', async () => {
    const pool = mockPool([
      { id: 'a', agent_summary: 'sa' },
      { id: 'b', agent_summary: 'sb' },
    ]);
    const r = new Reranker({
      pool,
      circuitBreaker: new CircuitBreaker(),
      backend: backendThrows(),
    });

    const input = [candidate('a', 0.9), candidate('b', 0.8)];
    const out = await r.rerank('q', input);
    expect(out.applied).toBe(false);
    expect(out.results).toEqual(input);
  }, 10_000);

  it('swallows a DB fetch failure and returns unchanged', async () => {
    const r = new Reranker({
      pool: poolThrows(),
      circuitBreaker: new CircuitBreaker(),
      backend: stubBackend([1, 2]),
    });

    const input = [candidate('a', 0.9), candidate('b', 0.8)];
    const out = await r.rerank('q', input);
    // All summaries missing → both pushed to passthrough → 0 valid → applied=false
    expect(out.applied).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Summary fetch SQL
// ──────────────────────────────────────────────────────────────────────────────

describe('Reranker — fetchSummaries SQL', () => {
  it('binds skillIds as a uuid array parameter', async () => {
    const pool = mockPool([
      { id: 'a', agent_summary: 'sa' },
      { id: 'b', agent_summary: 'sb' },
    ]);
    const r = new Reranker({
      pool,
      circuitBreaker: new CircuitBreaker(),
      backend: stubBackend([1, 2]),
    });

    await r.rerank('q', [candidate('a', 0.9), candidate('b', 0.8)]);

    const call = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toContain('agent_summary IS NOT NULL');
    expect(call[0]).toContain('id = ANY($1::uuid[])');
    expect(call[1]).toEqual([['a', 'b']]);
  });
});
