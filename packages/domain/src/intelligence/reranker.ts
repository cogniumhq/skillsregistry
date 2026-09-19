// ══════════════════════════════════════════════════════════════════════════════
// Reranker — cross-encoder reranking of top-N bi-encoder candidates
// ══════════════════════════════════════════════════════════════════════════════
//
// Reorders the top-N candidates from the bi-encoder retrieval using a
// cross-encoder, which sees query + document together and can capture
// matching nuances that the bi-encoder misses (at higher latency cost).
//
// The cross-encoder call itself is injected as a `RerankerBackend` so the
// math is identical whether the caller wires Workers AI bge-reranker-base
// or a hosted qwen3-reranker-0.6b endpoint. See `reranker-backend.ts`.
//
// Integration: runs AFTER provider search and confidence assessment;
// reorders only — never changes the original `fusedScore`. Wrapped in a
// circuit breaker — on failure, returns original ordering unchanged.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { SqlPool } from '../adapters/sql.js';
import type { CircuitBreaker } from '../resilience/circuit-breaker.js';
import type { ScoredSkill } from '../types.js';
import type { RerankerBackend } from './reranker-backend.js';

export interface RerankerOptions {
  pool: SqlPool;
  circuitBreaker: CircuitBreaker;
  backend: RerankerBackend;
  /** Number of top candidates to rerank. Defaults to 20 (mothership `RERANKER_TOP_N`). */
  topN?: number;
}

export class Reranker {
  private pool: SqlPool;
  private circuitBreaker: CircuitBreaker;
  private backend: RerankerBackend;
  private topN: number;

  constructor(opts: RerankerOptions) {
    this.pool = opts.pool;
    this.circuitBreaker = opts.circuitBreaker;
    this.backend = opts.backend;
    this.topN = opts.topN ?? 20;
  }

  /**
   * Rerank search results using the cross-encoder backend.
   * Returns reordered results (original scores preserved, only ordering
   * changes). On failure, returns original ordering unchanged.
   */
  async rerank(
    query: string,
    results: ScoredSkill[]
  ): Promise<{ results: ScoredSkill[]; applied: boolean }> {
    if (results.length <= 1) {
      return { results, applied: false };
    }

    // Take top N candidates for reranking
    const candidates = results.slice(0, this.topN);
    const passthrough = results.slice(this.topN);

    // Fetch agent_summary text for each candidate
    const summaryMap = await this.fetchSummaries(
      candidates.map((c) => c.skillId)
    );

    // Build text pairs for cross-encoder
    const texts: string[] = [];
    const validCandidates: ScoredSkill[] = [];

    for (const candidate of candidates) {
      const summary = summaryMap.get(candidate.skillId);
      if (summary) {
        texts.push(summary);
        validCandidates.push(candidate);
      } else {
        // No summary available — push to end of passthrough
        passthrough.push(candidate);
      }
    }

    if (validCandidates.length <= 1) {
      return { results, applied: false };
    }

    // Call cross-encoder via circuit breaker. Backend normalizes the
    // provider-specific response shape to `number[]` aligned with `texts`.
    const { result: scores, degraded } = await this.circuitBreaker.execute(
      async () => this.backend.score(query, texts),
      null
    );

    if (degraded || !scores) {
      return { results, applied: false };
    }

    // Sort candidates by cross-encoder score, but preserve original fusedScore.
    const reranked = validCandidates
      .map((candidate, i) => ({
        candidate,
        crossEncoderScore: scores[i] ?? 0,
      }))
      .sort((a, b) => b.crossEncoderScore - a.crossEncoderScore)
      .map(({ candidate }) => candidate);

    return {
      results: [...reranked, ...passthrough],
      applied: true,
    };
  }

  private async fetchSummaries(
    skillIds: string[]
  ): Promise<Map<string, string>> {
    if (skillIds.length === 0) return new Map();

    const sql = `
      SELECT id, agent_summary
      FROM skills
      WHERE id = ANY($1::uuid[])
        AND agent_summary IS NOT NULL
    `;

    try {
      const result = await this.pool.query(sql, [skillIds]);
      return new Map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pg row
        result.rows.map((row: any) => [row.id, row.agent_summary])
      );
    } catch (error) {
      console.error('Failed to fetch summaries for reranking:', error);
      return new Map();
    }
  }
}
