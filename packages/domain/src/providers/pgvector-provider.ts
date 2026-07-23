// ══════════════════════════════════════════════════════════════════════════════
// PgVectorProvider — Postgres + pgvector Implementation
// ══════════════════════════════════════════════════════════════════════════════
//
// CRITICAL: This is the ONLY file that imports Postgres types. The
// intelligence layer talks only through the SearchProvider interface.
//
// Strategy:
// - Stores 1–6 rows per skill in skill_embeddings
// - Uses DISTINCT ON (skill_id) to return best match per skill
// - Multi-vector happens at index time (Phase 3)
// - Score fusion: weighted blend of vector similarity + full-text rank
//
// Runtime coupling was removed during the T-1.4c extraction: the mothership
// constructor previously accepted `Env` and called `createPool(env)`. The
// runtime-agnostic version accepts a `SqlPool` and explicit config options.
// Consumers assemble the pool from their driver of choice (`pg`, Neon
// serverless, in-memory double).
//
// ══════════════════════════════════════════════════════════════════════════════

import type { SqlPool } from '../adapters/sql.js';
import { textNormSha256 } from '../ingestion/text-fingerprint.js';
import type { SearchProvider } from './search-provider.js';
import type {
  ConfidenceSignal,
  EmbeddingSet,
  ScoredSkill,
  SearchFilters,
  SearchOptions,
  SearchResult,
  SkillInput,
} from '../types.js';

/**
 * §10 A7: read-side shape of the two stamps on a skill_embeddings row.
 * Used by the embed-consumer to decide whether to call the embedder at all.
 */
export interface EmbeddingStamps {
  embedModel: string;
  textNormSha256: string | null;
}

export interface PgVectorProviderOptions {
  /** Postgres pool. Structurally matches `pg.Pool` / Neon serverless `Pool`. */
  pool: SqlPool;
  /** §10 fusion mode: 'linear' (default) or 'rrf'. */
  fusionMode?: 'linear' | 'rrf';
  /** RRF damping constant when fusionMode='rrf'. Default 60. */
  rrfK?: number;
  /** Tier 1 confidence threshold. Default 0.62 (linear) / 0.030 (rrf). */
  tier1Threshold?: number;
  /** Tier 2 confidence threshold. Default 0.58 (linear) / 0.018 (rrf). */
  tier2Threshold?: number;
  /** Linear vector weight. Default 0.7. */
  vectorWeight?: number;
  /** Linear full-text weight. Default 0.3. */
  fullTextWeight?: number;
  /** Version trust weight. Default 0.7. */
  versionTrustWeight?: number;
  /** Version usage weight. Default 0.3. */
  versionUsageWeight?: number;
  /** Multiplicative trust-score boost on fused score. Default 0.3. */
  trustBoostWeight?: number;
  /** Fetch N× candidates before trust-boost pagination. Default 3. */
  candidatePoolMultiplier?: number;
}

export class PgVectorProvider implements SearchProvider {
  // Always-excluded statuses (never shown in search)
  private static readonly BLOCKED_STATUSES = ['revoked', 'draft', 'degraded'];

  private pool: SqlPool;

  // Configurable thresholds
  private tier1Threshold: number;
  private tier2Threshold: number;
  private vectorWeight: number;
  private fullTextWeight: number;
  private versionTrustWeight: number;
  private versionUsageWeight: number;
  private trustBoostWeight: number;
  private candidatePoolMultiplier: number;
  private fusionMode: 'linear' | 'rrf';
  private rrfK: number;

  // §10 A10 (post-cutover): single canonical column. Migration 0023 dropped
  // the legacy vector(384) `embedding` column and renamed `embedding_h512` →
  // `embedding`, so the on-disk column is halfvec(512) under its old name.
  // No more EMBEDDING_PROVIDER branching — the only supported embedder is the
  // qwen3-embedding-0.6B @ MRL-512 path via llmproxy.
  private static readonly EMBEDDING_COLUMN = 'embedding';
  private static readonly EMBEDDING_CAST = 'halfvec';

  constructor(opts: PgVectorProviderOptions) {
    this.pool = opts.pool;

    // §10 fusion mode. Default "linear" preserves current behavior bit-for-bit.
    // "rrf" produces scores on a much smaller scale (max ≈ 2/(k+1) ≈ 0.0328
    // at k=60), so tier thresholds are recalibrated to that scale below.
    const mode = opts.fusionMode ?? 'linear';
    if (mode !== 'linear' && mode !== 'rrf') {
      throw new Error(`Unknown fusionMode: ${mode} (expected "linear" or "rrf")`);
    }
    this.fusionMode = mode;
    this.rrfK = opts.rrfK ?? 60;

    // Tier threshold defaults — mode-aware.
    //
    // linear (default):
    //   tier1=0.62, tier2=0.58 — §10 A4 recalibration for qwen3-embedding-0.6B
    //   @ halfvec(512), measured 2026-06-11 against the 91-fixture eval on the
    //   production DB. Same methodology as the bge baseline (T1 at
    //   P30 of correct top-1 scores, T2 at P10) but on the new score
    //   distribution: P10=0.576, P30=0.617, P50=0.630, P75=0.662, P90=0.699.
    //   Distribution: ~56% T1 (80% rank-1 accuracy), ~21% T2, ~23% T3.
    //
    // rrf:
    //   tier1=0.030, tier2=0.018 — calibrated against RRF max 2/61 ≈ 0.0328.
    //   tier1 ≈ "ranked highly in both retrievers" (~0.91 of theoretical max).
    //   tier2 ≈ "ranked highly in at least one retriever" (~0.55 of max).
    //   These are starting points; a future PR will tune against a judged eval.
    const t1Default = this.fusionMode === 'rrf' ? 0.030 : 0.62;
    const t2Default = this.fusionMode === 'rrf' ? 0.018 : 0.58;
    this.tier1Threshold = opts.tier1Threshold ?? t1Default;
    this.tier2Threshold = opts.tier2Threshold ?? t2Default;

    this.vectorWeight = opts.vectorWeight ?? 0.7;
    this.fullTextWeight = opts.fullTextWeight ?? 0.3;
    this.versionTrustWeight = opts.versionTrustWeight ?? 0.7;
    this.versionUsageWeight = opts.versionUsageWeight ?? 0.3;
    this.trustBoostWeight = opts.trustBoostWeight ?? 0.3;
    this.candidatePoolMultiplier = opts.candidatePoolMultiplier ?? 3;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Status Filter Builder
  // ────────────────────────────────────────────────────────────────────────────

  private buildStatusFilter(
    filters: SearchFilters,
    params: any[],
    paramCount: { value: number },
  ): string[] {
    const conditions: string[] = [];

    // Always exclude revoked, draft, degraded
    conditions.push(`s.status NOT IN (${PgVectorProvider.BLOCKED_STATUSES.map(() => `$${++paramCount.value}`).join(', ')})`);
    params.push(...PgVectorProvider.BLOCKED_STATUSES);

    // Conditionally exclude vulnerable/contains-vulnerable
    if (!filters.allowVulnerable) {
      conditions.push(`s.status NOT IN ($${++paramCount.value}, $${++paramCount.value})`);
      params.push('vulnerable', 'contains-vulnerable');
    }

    // Explicit status filter overrides the above (must still exclude BLOCKED)
    if (filters.statusFilter && filters.statusFilter.length > 0) {
      const allowed = filters.statusFilter.filter(
        s => !PgVectorProvider.BLOCKED_STATUSES.includes(s)
      );
      if (allowed.length > 0) {
        conditions.push(`s.status IN (${allowed.map(() => `$${++paramCount.value}`).join(', ')})`);
        params.push(...allowed);
      }
    }

    // Slug pin (best-version-per-slug)
    if (filters.slug) {
      conditions.push(`s.slug = $${++paramCount.value}`);
      params.push(filters.slug);
    }

    // Version pin
    if (filters.version) {
      conditions.push(`s.version = $${++paramCount.value}`);
      params.push(filters.version);
    }

    return conditions;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Search Implementation
  // ────────────────────────────────────────────────────────────────────────────

  async search(
    query: string,
    embedding: number[],
    filters: SearchFilters,
    options?: SearchOptions
  ): Promise<SearchResult> {
    const startTime = Date.now();
    const limit = options?.limit ?? 10;
    const offset = options?.offset ?? 0;
    const includeMatchText = options?.includeMatchText ?? false;

    // Widen candidate pool so trust boost can rescue high-trust skills
    const poolSize = (limit + offset) * this.candidatePoolMultiplier;

    // Start vector and full-text searches in parallel
    const vectorSearchStart = Date.now();
    const vectorResults = await this.vectorSearch(embedding, filters, poolSize);
    const vectorSearchMs = Date.now() - vectorSearchStart;

    const fullTextSearchStart = Date.now();
    const fullTextResults = await this.fullTextSearch(query, filters, poolSize);
    const fullTextSearchMs = Date.now() - fullTextSearchStart;

    // Merge and fuse scores (trust_score flows through from vector search)
    const fusedResults = this.fuseScores(vectorResults, fullTextResults);

    // Apply trust-score boost on fused results BEFORE pagination
    // Trust scores are already available from the vector search SQL (no extra round-trip)
    if (this.trustBoostWeight > 0) {
      for (const fr of fusedResults) {
        fr.fusedScore *= 1 + this.trustBoostWeight * (fr.trustScore - 0.5);
      }
      fusedResults.sort((a, b) => b.fusedScore - a.fusedScore);
    }

    // Paginate AFTER trust boost
    const paginatedResults = fusedResults.slice(offset, offset + limit);

    // Only enrich the final page with full skill metadata (single DB round-trip for ~10 skills)
    const { scoredSkills } = await this.enrichWithSkillMetadata(
      paginatedResults,
      includeMatchText
    );

    // Compute confidence on the final results (raw fused scores already include trust boost)
    const confidence = this.computeConfidence(scoredSkills);

    const totalLatencyMs = Date.now() - startTime;

    return {
      results: scoredSkills,
      confidence,
      meta: {
        latencyMs: totalLatencyMs,
        vectorSearchMs,
        fullTextSearchMs,
        fusionStrategy: this.fusionMode === 'rrf' ? 'rrf' : 'score_blend',
        totalCandidates: fusedResults.length,
        cacheHit: false,
      },
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Vector Similarity Search
  // ────────────────────────────────────────────────────────────────────────────

  private async vectorSearch(
    embedding: number[],
    filters: SearchFilters,
    limit: number
  ): Promise<Array<{ skillId: string; score: number; matchSource: string; matchText: string; trustScore: number }>> {
    const embeddingStr = `[${embedding.join(',')}]`;

    // ── Param layout ──
    //   $1 tenantId (CTE tenant filter + outer visibility check)
    //   $2 embedding string (CTE distance sort + score expression)
    //   $3 final LIMIT (poolSize)
    //   $4 KNN over-fetch LIMIT (candidate budget from HNSW)
    //   $5+ filter params (appended by buildStatusFilter and s.* conditions below)
    //
    // KNN candidate budget: pgvector's hnsw.ef_search (default 40) is the real
    // bound on how many rows the index returns. We LIMIT generously at 200 so
    // that if a deploy raises ef_search globally the extra candidates flow
    // through automatically. A per-query `SET LOCAL hnsw.ef_search` would need
    // a transaction (~130ms of extra round-trips over Hyperdrive) and the
    // top-K recall gain is not worth that cost.
    const knnLimit = 200;
    const params: any[] = [filters.tenantId, embeddingStr, limit, knnLimit];
    const paramCount = { value: 4 };

    // Only s.* conditions live post-join. The se.* filters (tenant scope and
    // embedding NOT NULL) are inlined in the CTE below where they are cheap.
    const conditions: string[] = [];

    // v5.0: Status filter (always exclude revoked/draft/degraded)
    conditions.push(...this.buildStatusFilter(filters, params, paramCount));

    if (filters.minTrustScore !== undefined) {
      conditions.push(`s.trust_score >= $${++paramCount.value}`);
      params.push(filters.minTrustScore);
    }

    if (filters.contentSafetyRequired !== false) {
      conditions.push('s.content_safety_passed = true');
    }

    if (filters.executionLayer) {
      conditions.push(`s.execution_layer = $${++paramCount.value}`);
      params.push(filters.executionLayer);
    }

    if (filters.category) {
      conditions.push(`s.category = $${++paramCount.value}`);
      params.push(filters.category);
    }

    if (filters.tags && filters.tags.length > 0) {
      conditions.push(`s.tags && $${++paramCount.value}::text[]`);
      params.push(filters.tags);
    }

    // v5.2: visibility filter — public by default, tenant can see own private/unlisted
    if (filters.visibility) {
      conditions.push(`s.visibility = $${++paramCount.value}`);
      params.push(filters.visibility);
    } else {
      conditions.push(`(s.visibility = 'public' OR (s.visibility IN ('private', 'unlisted') AND s.tenant_id = $1))`);
    }

    // v5.2: runtime environment filter
    if (filters.runtimeEnv && filters.runtimeEnv.length > 0) {
      conditions.push(`s.runtime_env = ANY($${++paramCount.value}::text[])`);
      params.push(filters.runtimeEnv);
    }

    // v5.3: portable filter
    if (filters.portable === true) {
      conditions.push('s.portable = true');
    }

    const whereClause = conditions.join(' AND ');
    const col = PgVectorProvider.EMBEDDING_COLUMN;
    const cast = PgVectorProvider.EMBEDDING_CAST;

    // §10 (2026-07-16 X8 fix): KNN-first. The previous shape
    //   SELECT DISTINCT ON (s.slug) ... ORDER BY s.slug, version_rank DESC, dist ASC
    // forced Postgres to compute the halfvec distance for every embedding row
    // (~102K in prod) on every uncached query — a parallel seq scan + sort —
    // because HNSW returns rows in *distance* order but DISTINCT ON needed
    // *slug* order first. Measured: 6432ms vs 143ms for the same KNN done
    // index-first. Fix: HNSW top-K in a CTE, then dedup by slug + apply s.*
    // filters on the small candidate set. Result shape, filter semantics, and
    // best-version-per-slug ordering are identical.
    //
    // §10 A3: defence-in-depth `${col} IS NOT NULL` — migration 0023 set the
    // column NOT NULL, but keep the guard so any row inserted between deploy
    // and migration run cannot poison ANN with a NULL distance.
    const sql = `
      WITH knn AS (
        SELECT se.skill_id, se.source, se.source_text,
               (se.${col} <=> $2::${cast}) AS dist
        FROM skill_embeddings se
        WHERE se.tenant_id IN ($1, 'default')
          AND se.${col} IS NOT NULL
        ORDER BY se.${col} <=> $2::${cast}
        LIMIT $4
      )
      SELECT skill_id, score, match_source, match_text, trust_score
      FROM (
        SELECT DISTINCT ON (s.slug)
          knn.skill_id,
          1 - knn.dist AS score,
          knn.source AS match_source,
          knn.source_text AS match_text,
          COALESCE(s.trust_score, 0.5) AS trust_score,
          (COALESCE(s.trust_score, 0.5) * ${this.versionTrustWeight}
           + LEAST(COALESCE(s.run_count, 0)::float / 100.0, ${this.versionUsageWeight})) AS version_rank
        FROM knn
        INNER JOIN skills s ON s.id = knn.skill_id
        WHERE ${whereClause}
        ORDER BY s.slug, version_rank DESC, knn.dist ASC
      ) ranked
      ORDER BY score DESC
      LIMIT $3
    `;

    const result = await this.pool.query(sql, params);

    return result.rows.map((row: any) => ({
      skillId: row.skill_id,
      score: row.score,
      matchSource: row.match_source,
      matchText: row.match_text,
      trustScore: parseFloat(row.trust_score) || 0.5,
    }));
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Full-Text Search
  // ────────────────────────────────────────────────────────────────────────────

  private async fullTextSearch(
    query: string,
    filters: SearchFilters,
    limit: number
  ): Promise<Array<{ skillId: string; score: number; keywordHits: number }>> {
    // Build WHERE clause — include tenant's own + public ('default') embeddings
    const conditions: string[] = ["se.tenant_id IN ($1, 'default')"];
    const params: any[] = [filters.tenantId, limit];
    const paramCount = { value: 2 };

    // v5.0: Status filter (always exclude revoked/draft/degraded)
    conditions.push(...this.buildStatusFilter(filters, params, paramCount));

    if (filters.minTrustScore !== undefined) {
      conditions.push(`s.trust_score >= $${++paramCount.value}`);
      params.push(filters.minTrustScore);
    }

    if (filters.contentSafetyRequired !== false) {
      conditions.push('s.content_safety_passed = true');
    }

    if (filters.executionLayer) {
      conditions.push(`s.execution_layer = $${++paramCount.value}`);
      params.push(filters.executionLayer);
    }

    if (filters.category) {
      conditions.push(`s.category = $${++paramCount.value}`);
      params.push(filters.category);
    }

    if (filters.tags && filters.tags.length > 0) {
      conditions.push(`s.tags && $${++paramCount.value}::text[]`);
      params.push(filters.tags);
    }

    // v5.2: visibility filter — public by default, tenant can see own private/unlisted
    if (filters.visibility) {
      conditions.push(`s.visibility = $${++paramCount.value}`);
      params.push(filters.visibility);
    } else {
      conditions.push(`(s.visibility = 'public' OR (s.visibility IN ('private', 'unlisted') AND s.tenant_id = $1))`);
    }

    // v5.2: runtime environment filter
    if (filters.runtimeEnv && filters.runtimeEnv.length > 0) {
      conditions.push(`s.runtime_env = ANY($${++paramCount.value}::text[])`);
      params.push(filters.runtimeEnv);
    }

    // v5.3: portable filter
    if (filters.portable === true) {
      conditions.push('s.portable = true');
    }

    const whereClause = conditions.join(' AND ');

    // Full-text search: best version per slug, then rank by score
    ++paramCount.value;
    const queryParam = paramCount.value;
    const sql = `
      SELECT skill_id, raw_score, normalized_score, keyword_hits
      FROM (
        SELECT DISTINCT ON (s.slug)
          se.skill_id,
          ts_rank_cd(se.tsv, plainto_tsquery('english', $${queryParam})) AS raw_score,
          ts_rank_cd(se.tsv, plainto_tsquery('english', $${queryParam}), 32) AS normalized_score,
          (
            SELECT COUNT(*)
            FROM unnest(tsvector_to_array(se.tsv)) AS term
            WHERE term = ANY(string_to_array(lower($${queryParam}), ' '))
          ) AS keyword_hits,
          (COALESCE(s.trust_score, 0.5) * ${this.versionTrustWeight}
           + LEAST(COALESCE(s.run_count, 0)::float / 100.0, ${this.versionUsageWeight})) AS version_rank
        FROM skill_embeddings se
        INNER JOIN skills s ON s.id = se.skill_id
        WHERE ${whereClause}
          AND se.tsv @@ plainto_tsquery('english', $${queryParam})
        ORDER BY s.slug, version_rank DESC, raw_score DESC
      ) ranked
      ORDER BY raw_score DESC
      LIMIT $2
    `;

    params.push(query);

    try {
      const result = await this.pool.query(sql, params);

      // Normalize scores to 0-1 range
      const maxScore = Math.max(...result.rows.map((r: any) => r.raw_score), 1);

      return result.rows.map((row: any) => ({
        skillId: row.skill_id,
        score: row.raw_score / maxScore,
        keywordHits: parseInt(row.keyword_hits) || 0,
      }));
    } catch (error) {
      // If full-text search fails (e.g., empty query), return empty results
      console.error('Full-text search error:', error);
      return [];
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Score Fusion
  // ────────────────────────────────────────────────────────────────────────────

  private fuseScores(
    vectorResults: Array<{ skillId: string; score: number; matchSource: string; matchText: string; trustScore: number }>,
    fullTextResults: Array<{ skillId: string; score: number; keywordHits: number }>
  ): Array<{
    skillId: string;
    vectorScore: number;
    fullTextScore: number;
    fusedScore: number;
    matchSource: string;
    matchText: string;
    keywordHits: number;
    trustScore: number;
  }> {
    if (this.fusionMode === 'rrf') {
      return this.fuseScoresRRF(vectorResults, fullTextResults);
    }
    return this.fuseScoresLinear(vectorResults, fullTextResults);
  }

  // ── Linear blend (legacy default) ─────────────────────────────────────────
  // fusedScore = vectorWeight * vScore + fullTextWeight * ftScore
  // Iterates vectorResults only — FTS-only matches are dropped, matching the
  // historical behavior of this provider. Switch to RRF to rescue them.
  private fuseScoresLinear(
    vectorResults: Array<{ skillId: string; score: number; matchSource: string; matchText: string; trustScore: number }>,
    fullTextResults: Array<{ skillId: string; score: number; keywordHits: number }>
  ): Array<{
    skillId: string;
    vectorScore: number;
    fullTextScore: number;
    fusedScore: number;
    matchSource: string;
    matchText: string;
    keywordHits: number;
    trustScore: number;
  }> {
    const fullTextMap = new Map(
      fullTextResults.map((r) => [r.skillId, { score: r.score, keywordHits: r.keywordHits }])
    );

    const merged = vectorResults.map((vr) => {
      const ft = fullTextMap.get(vr.skillId);
      const fullTextScore = ft?.score ?? 0;
      const fusedScore =
        this.vectorWeight * vr.score + this.fullTextWeight * fullTextScore;

      return {
        skillId: vr.skillId,
        vectorScore: vr.score,
        fullTextScore,
        fusedScore,
        matchSource: vr.matchSource,
        matchText: vr.matchText,
        keywordHits: ft?.keywordHits ?? 0,
        trustScore: vr.trustScore,
      };
    });

    return merged.sort((a, b) => b.fusedScore - a.fusedScore);
  }

  // ── Reciprocal Rank Fusion ────────────────────────────────────────────────
  //   fusedScore(s) = Σ_r 1 / (k + rank_r(s))         (ranks are 1-indexed)
  // Items absent from a retriever's list contribute 0 from that retriever.
  // Unlike the linear path, RRF iterates the UNION of both lists, so FTS-only
  // matches are kept. Trust score and matchSource/matchText come from the
  // vector row when present; otherwise we synthesize a passage-source row
  // since FTS matches against the same source_text column anyway.
  //
  // Score scale: max possible = 2 * 1/(k+1). With k=60 that's ~0.0328. Confidence
  // tier thresholds must be recalibrated when this mode is active (see PR-3).
  private fuseScoresRRF(
    vectorResults: Array<{ skillId: string; score: number; matchSource: string; matchText: string; trustScore: number }>,
    fullTextResults: Array<{ skillId: string; score: number; keywordHits: number }>
  ): Array<{
    skillId: string;
    vectorScore: number;
    fullTextScore: number;
    fusedScore: number;
    matchSource: string;
    matchText: string;
    keywordHits: number;
    trustScore: number;
  }> {
    const k = this.rrfK;

    // Rank maps: skillId → 1-indexed rank in each retriever's list.
    // vectorResults / fullTextResults are already returned in best-first order.
    const vRank = new Map<string, number>();
    vectorResults.forEach((r, i) => vRank.set(r.skillId, i + 1));
    const ftRank = new Map<string, number>();
    fullTextResults.forEach((r, i) => ftRank.set(r.skillId, i + 1));

    const vById = new Map(vectorResults.map((r) => [r.skillId, r]));
    const ftById = new Map(fullTextResults.map((r) => [r.skillId, r]));

    const ids = new Set<string>([...vRank.keys(), ...ftRank.keys()]);
    const merged: Array<{
      skillId: string;
      vectorScore: number;
      fullTextScore: number;
      fusedScore: number;
      matchSource: string;
      matchText: string;
      keywordHits: number;
      trustScore: number;
    }> = [];

    for (const id of ids) {
      const vr = vById.get(id);
      const fr = ftById.get(id);
      const vR = vRank.get(id);
      const fR = ftRank.get(id);
      const vContrib = vR !== undefined ? 1 / (k + vR) : 0;
      const fContrib = fR !== undefined ? 1 / (k + fR) : 0;

      merged.push({
        skillId: id,
        vectorScore: vr?.score ?? 0,
        fullTextScore: fr?.score ?? 0,
        fusedScore: vContrib + fContrib,
        matchSource: vr?.matchSource ?? 'agent_summary',
        matchText: vr?.matchText ?? '',
        keywordHits: fr?.keywordHits ?? 0,
        // FTS-only rows have no vector trust_score available; use 0.5 neutral
        // so the multiplicative trust boost is a no-op for them.
        trustScore: vr?.trustScore ?? 0.5,
      });
    }

    return merged.sort((a, b) => b.fusedScore - a.fusedScore);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Enrich with Skill Metadata
  // ────────────────────────────────────────────────────────────────────────────

  private async enrichWithSkillMetadata(
    fusedResults: Array<{
      skillId: string;
      vectorScore: number;
      fullTextScore: number;
      fusedScore: number;
      matchSource: string;
      matchText: string;
      keywordHits: number;
      trustScore: number;
    }>,
    includeMatchText: boolean
  ): Promise<{ scoredSkills: ScoredSkill[]; trustScores: Map<string, number> }> {
    if (fusedResults.length === 0) {
      return { scoredSkills: [], trustScores: new Map() };
    }

    const skillIds = fusedResults.map((r) => r.skillId);

    const sql = `
      SELECT
        id, name, slug, version, agent_summary, trust_score,
        execution_layer, capabilities_required, status,
        skill_type, verification_tier, trust_badge,
        forked_from, run_count, last_run_at,
        revoked_reason, remediation_message, remediation_url,
        replacement_skill_id,
        publisher_key_id, signature_verified_at, signature_failure_reason
      FROM skills
      WHERE id = ANY($1::uuid[])
    `;

    const result = await this.pool.query(sql, [skillIds]);

    // Create lookup map
    const skillMap = new Map(
      result.rows.map((row: any) => [
        row.id,
        {
          id: row.id,
          name: row.name,
          slug: row.slug,
          version: row.version ?? '1.0.0',
          agentSummary: row.agent_summary,
          trustScore: parseFloat(row.trust_score),
          executionLayer: row.execution_layer,
          capabilitiesRequired: row.capabilities_required ?? [],
          status: row.status ?? 'published',
          skillType: row.skill_type ?? 'atomic',
          verificationTier: row.verification_tier ?? 'unverified',
          trustBadge: row.trust_badge ?? null,
          forkedFrom: row.forked_from ?? undefined,
          runCount: parseInt(row.run_count) || 0,
          lastRunAt: row.last_run_at?.toISOString() ?? undefined,
          revokedReason: row.revoked_reason ?? undefined,
          remediationMessage: row.remediation_message ?? undefined,
          remediationUrl: row.remediation_url ?? undefined,
          replacementSkillId: row.replacement_skill_id ?? undefined,
          publisherKeyId: row.publisher_key_id ?? null,
          signatureVerifiedAt: row.signature_verified_at?.toISOString() ?? null,
          signatureFailureReason: row.signature_failure_reason ?? null,
        },
      ])
    );

    // Build trust score lookup for post-confidence boost
    const trustScores = new Map<string, number>();
    for (const [id, skill] of skillMap) {
      trustScores.set(id as string, (skill as any).trustScore || 0.5);
    }

    // Merge with fused scores
    // Note: trust boost is applied AFTER confidence computation in search()
    const scoredSkills = fusedResults
      .map((fr) => {
        const skill = skillMap.get(fr.skillId);
        if (!skill) return null;

        const scoredSkill: ScoredSkill = {
          skillId: fr.skillId,
          score: fr.vectorScore,
          fullTextScore: fr.fullTextScore,
          fusedScore: fr.fusedScore,
          matchSource: fr.matchSource,
        };

        if (includeMatchText) {
          scoredSkill.matchText = fr.matchText;
        }

        return scoredSkill;
      })
      .filter((s): s is ScoredSkill => s !== null);

    return { scoredSkills, trustScores };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Confidence Signal Computation
  // ────────────────────────────────────────────────────────────────────────────

  private computeConfidence(results: ScoredSkill[]): ConfidenceSignal {
    if (results.length === 0) {
      return {
        topScore: 0,
        gapToSecond: 0,
        clusterDensity: 0,
        keywordHits: 0,
        tier: 3,
      };
    }

    const topScore = results[0]!.fusedScore;
    const gapToSecond = results.length > 1 ? topScore - results[1]!.fusedScore : 1.0;

    // Cluster density: count results above tier2 threshold
    const clusterDensity = results.filter(
      (r) => r.fusedScore >= this.tier2Threshold
    ).length;

    // Keyword hits from full-text search (approximate)
    const keywordHits = results[0]!.fullTextScore > 0 ? 1 : 0;

    // Determine tier based on top score
    let tier: 1 | 2 | 3;
    if (topScore >= this.tier1Threshold && gapToSecond >= 0.05) {
      tier = 1; // High confidence
    } else if (topScore >= this.tier2Threshold) {
      tier = 2; // Medium confidence
    } else {
      tier = 3; // Low confidence, needs LLM fallback
    }

    return {
      topScore,
      gapToSecond,
      clusterDensity,
      keywordHits,
      tier,
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Embedding stamps (§10 A7) — idempotent re-embed gate
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Return the two stamps for the agent_summary row of `skillId` in `tenantId`,
   * or null if no row exists. The embed-consumer compares these against the
   * current embedder identity + fingerprint of the incoming text to decide
   * whether to call /v1/embeddings at all.
   *
   * A row with `text_norm_sha256 = NULL` is intentionally returned as null on
   * that field so the caller treats it as a forced re-embed (pre-A7 rows
   * predate the fingerprint and must be re-stamped on next touch).
   */
  async getEmbeddingStamps(
    skillId: string,
    tenantId: string
  ): Promise<EmbeddingStamps | null> {
    const result = await this.pool.query(
      `SELECT embed_model, text_norm_sha256
         FROM skill_embeddings
        WHERE skill_id = $1
          AND tenant_id = $2
          AND source = 'agent_summary'
        LIMIT 1`,
      [skillId, tenantId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      embedModel: row.embed_model,
      textNormSha256: row.text_norm_sha256 ?? null,
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Index Implementation
  // ────────────────────────────────────────────────────────────────────────────

  async index(skill: SkillInput, embeddings: EmbeddingSet): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Insert or update skill record (required for foreign key constraint)
      await client.query(
        `INSERT INTO skills (
          id, name, slug, version, source, description, agent_summary,
          tags, category, trust_score, capabilities_required, execution_layer,
          content_safety_passed, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          agent_summary = EXCLUDED.agent_summary,
          updated_at = NOW()`,
        [
          skill.id,
          skill.name,
          skill.slug,
          skill.version,
          skill.source,
          skill.description,
          skill.agentSummary,
          skill.tags,
          skill.category,
          skill.trustScore,
          skill.capabilitiesRequired || [],
          skill.executionLayer,
          true, // content_safety_passed
        ]
      );

      // Delete existing embeddings for this skill
      await client.query(
        'DELETE FROM skill_embeddings WHERE skill_id = $1 AND tenant_id = $2',
        [skill.id, skill.tenantId]
      );

      // §10 A10 (post-cutover): single-column write. The canonical `embedding`
      // column is halfvec(512); the embedder is the qwen3-embedding-0.6B @
      // MRL-512 path via llmproxy. Anything else is rejected upstream — the
      // ingest pipeline only produces 512-d vectors after the cutover. We
      // assert here so a misconfigured embedder fails loud instead of
      // silently writing an undersized vector that pgvector would reject.
      if (embeddings.storedDims !== 512) {
        throw new Error(
          `Embedder reported storedDims=${embeddings.storedDims}; only 512 is supported post-§10 A10 cutover`
        );
      }

      const agentSummaryVector = `[${embeddings.agentSummary.embedding.join(',')}]`;

      // §10 A7: stamp the normalized-text fingerprint alongside the model
      // identity. The embed-consumer reads both via getEmbeddingStamps() to
      // short-circuit redundant re-embeds on replays.
      const fingerprint = await textNormSha256(embeddings.agentSummary.text);

      await client.query(
        `INSERT INTO skill_embeddings (skill_id, tenant_id, source, source_text, embedding, embed_model, text_norm_sha256)
         VALUES ($1, $2, $3, $4, $5::halfvec, $6, $7)`,
        [
          skill.id,
          skill.tenantId,
          'agent_summary',
          embeddings.agentSummary.text,
          agentSummaryVector,
          embeddings.embedderIdentity,
          fingerprint,
        ]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Delete Implementation
  // ────────────────────────────────────────────────────────────────────────────

  async delete(skillId: string): Promise<void> {
    // Embeddings are CASCADE deleted via FK constraint on skill_embeddings
    // This just ensures we clean up any orphaned records
    await this.pool.query('DELETE FROM skill_embeddings WHERE skill_id = $1', [
      skillId,
    ]);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Health Check Implementation
  // ────────────────────────────────────────────────────────────────────────────

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      await this.pool.query('SELECT 1');
      const latencyMs = Date.now() - start;
      return { ok: true, latencyMs };
    } catch (error) {
      const latencyMs = Date.now() - start;
      console.error('Health check failed:', error);
      return { ok: false, latencyMs };
    }
  }
}
