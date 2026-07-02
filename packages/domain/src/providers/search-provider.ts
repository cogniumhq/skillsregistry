// ══════════════════════════════════════════════════════════════════════════════
// SearchProvider — The Sacred Abstraction Boundary
// ══════════════════════════════════════════════════════════════════════════════
//
// This interface separates commodity infrastructure from intelligence.
// The provider owns retrieval strategy entirely. The intelligence layer
// only sees scored results.
//
// CRITICAL: Never import Postgres types outside `pgvector-provider.ts`.
// The intelligence layer talks ONLY through this interface.
//
// ══════════════════════════════════════════════════════════════════════════════

import type {
  SearchFilters,
  SearchOptions,
  SearchResult,
  SkillInput,
  EmbeddingSet,
} from '../types.js';

export interface SearchProvider {
  /**
   * Search for skills matching the query.
   *
   * @param query - Raw query string (for full-text search)
   * @param embedding - Query embedding vector
   * @param filters - Tenant, trust score, safety, execution layer filters
   * @param options - Pagination, result options
   * @returns Scored results with confidence signals
   */
  search(
    query: string,
    embedding: number[],
    filters: SearchFilters,
    options?: SearchOptions
  ): Promise<SearchResult>;

  /**
   * Index a skill with its embeddings.
   *
   * Phase 1: Single embedding (agent_summary)
   * Phase 3: Multi-vector (agent_summary + 5 alternates)
   *
   * @param skill - Skill metadata
   * @param embeddings - Embedding set (1 or 6 vectors)
   */
  index(skill: SkillInput, embeddings: EmbeddingSet): Promise<void>;

  /**
   * Remove a skill from the search index.
   *
   * @param skillId - Skill UUID to delete
   */
  delete(skillId: string): Promise<void>;

  /**
   * Health check: verify database connectivity and measure latency.
   *
   * @returns Health status and latency in ms
   */
  healthCheck(): Promise<{ ok: boolean; latencyMs: number }>;
}

// ══════════════════════════════════════════════════════════════════════════════
// Provider Strategy Notes
// ══════════════════════════════════════════════════════════════════════════════
//
// PgVectorProvider (MVP):
//   - Stores 1–6 rows per skill in skill_embeddings
//   - Uses DISTINCT ON (skill_id) to return best match per skill
//   - Multi-vector happens at index time
//
// Future MeilisearchProvider:
//   - Stores 1 document per skill
//   - Expands query into multiple reformulations at query time
//   - Different mechanics, same SearchResult interface
//
// The confidence gating layer doesn't know or care which strategy the
// provider uses.
//
// ══════════════════════════════════════════════════════════════════════════════
