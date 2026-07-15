// ══════════════════════════════════════════════════════════════════════════════
// ConfidenceGate — three-tier routing orchestrator
// ══════════════════════════════════════════════════════════════════════════════
//
// Wraps the `SearchProvider` and implements confidence-gated routing:
//
//   Tier 1 (HIGH):   return immediately. Log + cache. No LLM. ~50ms.
//   Tier 2 (MEDIUM): return immediately + optionally fire async LLM
//                     enrichment. Enriched result cached for next hit.
//   Tier 3 (LOW):    full LLM deep search before responding.
//
// Confidence assessment uses multiple signals:
//   - Top score vs thresholds
//   - Score gap between #1 and #2
//   - Full-text keyword hits
//   - Cluster density
//
// Every runtime binding is behind an adapter — the gate itself has no
// direct dependency on any host. Options struct pins all tunable knobs
// (thresholds, deep-search on/off, reranker on/off, name-boost weight).
//
// ══════════════════════════════════════════════════════════════════════════════

import type { AfterResponse } from '../adapters/after-response.js';
import type { SearchCachePort } from '../adapters/search-cache.js';
import type { SearchLoggerPort } from '../adapters/search-logger.js';
import type { SqlPool } from '../adapters/sql.js';
import type { SearchProvider } from '../providers/search-provider.js';
import { CircuitBreaker } from '../resilience/circuit-breaker.js';
import {
  appetiteToAllowVulnerable,
  appetiteToTrustThreshold,
  type Appetite,
  type FindSkillResponse,
  type ScoredSkill,
  type SearchFilters,
  type SearchResult,
  type SkillResult,
  type SkillVisibility,
} from '../types.js';
import { CompositionDetector } from './composition-detector.js';
import { DeepSearch } from './deep-search.js';
import { Reranker } from './reranker.js';
import type { RerankerBackend } from './reranker-backend.js';

// ──────────────────────────────────────────────────────────────────────────────
// Options
// ──────────────────────────────────────────────────────────────────────────────

export interface FindSkillOptions {
  limit?: number;
  appetite?: Appetite;
  tags?: string[];
  category?: string;
  runtimeEnv?: string[];
  /** 4-band tenant-scope visibility per cortex.md §16.6. */
  visibility?: SkillVisibility;
  portable?: boolean;
  /**
   * Overrides the appetite-derived trust-score floor. Threading in from
   * `FindSkillRequest.minTrust` (Cortex sends this per §6.2).
   */
  minTrust?: number;
  /** Overrides `appetiteToAllowVulnerable(appetite)` when set. */
  allowVulnerable?: boolean;
}

export interface ConfidenceGateOptions {
  provider: SearchProvider;
  embedFn: (text: string) => Promise<number[]>;
  cache: SearchCachePort;
  logger: SearchLoggerPort;
  pool: SqlPool;
  deepSearch: DeepSearch;
  compositionDetector: CompositionDetector;
  reranker: Reranker;
  /**
   * The cross-encoder backend identity — surfaced on log entries so
   * offline analysis can attribute rerank quality to a backend.
   */
  rerankerBackend?: RerankerBackend;

  // Behavior knobs — mothership defaults preserved.
  fusionMode?: 'linear' | 'rrf';
  tier1Threshold?: number;
  tier2Threshold?: number;
  gapThreshold?: number;
  clusterDensityThreshold?: number;
  deepSearchEnabled?: boolean;
  rerankerEnabled?: boolean;
  /** Gate on when to skip reranker at T1. See §12 latency tuning notes. */
  skipRerankerGap?: number;
  /** Circuit-breaker knobs — shared by every LLM/reranker call. */
  circuitBreakerThreshold?: number;
  circuitBreakerCooldownMs?: number;
  /** Default appetite when the caller does not pass one. */
  defaultAppetite?: Appetite;
  /** LLM identity string surfaced on log entries. */
  llmIdentity?: string;
  /** Name-token boost weight (0 disables). Mothership default 0.15. */
  nameBoostWeight?: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// ConfidenceGate
// ──────────────────────────────────────────────────────────────────────────────

export class ConfidenceGate {
  private provider: SearchProvider;
  private embedFn: (text: string) => Promise<number[]>;
  private cache: SearchCachePort;
  private logger: SearchLoggerPort;
  private pool: SqlPool;

  private tier1Threshold: number;
  private tier2Threshold: number;
  private gapThreshold: number;
  private clusterDensityThreshold: number;
  private deepSearchEnabled: boolean;
  private rerankerEnabled: boolean;
  private skipRerankerGap: number;
  private defaultAppetite: Appetite;
  private llmIdentity: string | undefined;
  private nameBoostWeight: number;

  private deepSearch: DeepSearch;
  private compositionDetector: CompositionDetector;
  private reranker: Reranker;
  private circuitBreaker: CircuitBreaker;

  constructor(opts: ConfidenceGateOptions) {
    this.provider = opts.provider;
    this.embedFn = opts.embedFn;
    this.cache = opts.cache;
    this.logger = opts.logger;
    this.pool = opts.pool;

    // Tier threshold defaults must agree with PgVectorProvider so that the
    // gate and the provider classify on the same scale. Defaults are
    // mode-aware: `linear` lives on a ~0..1 scale, `rrf` lives on a
    // ~0..0.033 scale. See PgVectorProvider constructor for the
    // calibration rationale.
    //
    // §10 A4: linear defaults calibrated for qwen3-embedding-0.6B @
    // halfvec(512). P30/P10 of correct top-1 scores on the 91-fixture
    // eval against the production DB.
    const mode = opts.fusionMode ?? 'linear';
    const t1Default = mode === 'rrf' ? 0.03 : 0.62;
    const t2Default = mode === 'rrf' ? 0.018 : 0.58;
    this.tier1Threshold = opts.tier1Threshold ?? t1Default;
    this.tier2Threshold = opts.tier2Threshold ?? t2Default;
    this.gapThreshold = opts.gapThreshold ?? 0.05;
    this.clusterDensityThreshold = opts.clusterDensityThreshold ?? 0.05;
    this.deepSearchEnabled = opts.deepSearchEnabled ?? true;
    this.rerankerEnabled = opts.rerankerEnabled ?? false;
    this.skipRerankerGap = opts.skipRerankerGap ?? 0.1;
    this.defaultAppetite = opts.defaultAppetite ?? 'balanced';
    this.llmIdentity = opts.llmIdentity;
    this.nameBoostWeight = opts.nameBoostWeight ?? 0.15;

    this.circuitBreaker = new CircuitBreaker(
      opts.circuitBreakerThreshold ?? 3,
      opts.circuitBreakerCooldownMs ?? 30000
    );

    this.reranker = opts.reranker;
    this.deepSearch = opts.deepSearch;
    this.compositionDetector = opts.compositionDetector;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Main findSkill orchestrator
  // ──────────────────────────────────────────────────────────────────────────

  async findSkill(
    query: string,
    tenantId: string,
    options: FindSkillOptions,
    afterResponse: AfterResponse
  ): Promise<FindSkillResponse> {
    const startTime = Date.now();

    const appetite = options.appetite ?? this.defaultAppetite;
    const limit = options.limit ?? 10;

    // ── 1. Cache Check ──
    const cached = await this.cache.get(query, tenantId, appetite);
    if (cached) {
      cached.meta.latencyMs = Date.now() - startTime;
      return cached;
    }

    // ── 2. Embed Query ──
    const embedding = await this.embedFn(query);

    // ── 3. Build Filters ──
    // `minTrust` + `allowVulnerable` (Cortex per cortex.md §6.2) override the
    // appetite-derived defaults when the caller sets them explicitly. Missing
    // → fall back to the appetite mapping.
    const filters: SearchFilters = {
      tenantId,
      tags: options.tags,
      category: options.category,
      minTrustScore: options.minTrust ?? appetiteToTrustThreshold(appetite),
      contentSafetyRequired: true,
      allowVulnerable:
        options.allowVulnerable ?? appetiteToAllowVulnerable(appetite),
      runtimeEnv: options.runtimeEnv,
      visibility: options.visibility,
      portable: options.portable,
    };

    // ── 4. Provider Search ──
    const searchResult = await this.provider.search(query, embedding, filters, {
      limit,
    });

    // ── 5. Assess Confidence (multi-signal) ──
    // Assess BEFORE reranking — confidence thresholds are calibrated for
    // bi-encoder scores.
    const assessedTier = this.assessConfidence(searchResult);

    // If circuit breaker is open, force Tier 1 (skip LLM calls)
    const degraded = this.circuitBreaker.isOpen && assessedTier > 1;
    const tier = degraded ? 1 : assessedTier;

    // ── 5b. Parallel: Reranking + LLM Query Expansion ──
    // For T2+, start LLM query expansion in parallel with reranking since
    // they're independent — reranking reorders initial results while the
    // LLM generates alternate phrasings. Saves ~200-300ms on T2.
    let reranked = false;
    let preGeneratedQueries: string[] | undefined;

    if (
      tier >= 2 &&
      this.deepSearchEnabled &&
      this.rerankerEnabled &&
      searchResult.results.length > 1
    ) {
      // Run reranking + LLM expansion in parallel
      const [rerankerResult, altQueries] = await Promise.all([
        this.reranker.rerank(query, searchResult.results),
        this.deepSearch
          .generateAlternateQueries(query)
          .catch(() => [] as string[]),
      ]);
      if (rerankerResult.applied) {
        searchResult.results = rerankerResult.results;
        reranked = true;
      }
      preGeneratedQueries = altQueries;
    } else if (this.rerankerEnabled && searchResult.results.length > 1) {
      // T1: skip reranker when top result is clearly dominant (large gap
      // saves ~120ms).
      if (searchResult.confidence.gapToSecond < this.skipRerankerGap) {
        const rerankerResult = await this.reranker.rerank(
          query,
          searchResult.results
        );
        if (rerankerResult.applied) {
          searchResult.results = rerankerResult.results;
          reranked = true;
        }
      }
    }

    // ── 6. Route by Tier ──
    let response: FindSkillResponse;

    switch (tier) {
      case 1:
        response = await this.handleTier1(
          query,
          searchResult,
          startTime,
          degraded,
          reranked
        );
        break;

      case 2:
        response = await this.handleTier2(
          query,
          searchResult,
          filters,
          startTime,
          reranked,
          preGeneratedQueries
        );
        break;

      default:
        response = await this.handleTier3(
          query,
          embedding,
          searchResult,
          filters,
          tenantId,
          startTime,
          reranked
        );
        break;
    }

    // ── 7. Log Event (Non-Blocking) ──
    const logEntry = this.logger.buildLogEntry({
      query,
      tenantId,
      appetite,
      tier,
      cacheHit: false,
      topScore: searchResult.confidence.topScore,
      gapToSecond: searchResult.confidence.gapToSecond,
      clusterDensity: searchResult.confidence.clusterDensity,
      keywordHits: searchResult.confidence.keywordHits,
      resultCount: response.results.length,
      matchSource: searchResult.results[0]?.matchSource,
      resultSkillIds: response.results.map((r) => r.id),
      totalLatencyMs: Date.now() - startTime,
      vectorSearchMs: searchResult.meta.vectorSearchMs,
      fullTextSearchMs: searchResult.meta.fullTextSearchMs,
      fusionStrategy: searchResult.meta.fusionStrategy,
      llmInvoked: tier >= 2 && this.deepSearchEnabled,
      llmModel: tier >= 2 ? this.llmIdentity : undefined,
      embeddingCost: this.logger.estimateEmbeddingCost(query.length),
      llmCost: tier === 3 ? 0.0003 : tier === 2 ? 0.0001 : 0,
      alternateQueriesUsed: response.searchTrace?.alternateQueries,
      compositionDetected: response.composition?.detected ?? false,
      generationHintReturned: !!response.generationHints,
    });

    afterResponse.run(() => this.logger.log(logEntry));

    // ── 8. Cache Result (Non-Blocking) ──
    afterResponse.run(() =>
      this.cache.set(query, tenantId, appetite, response, tier)
    );

    return response;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Confidence assessment (multi-signal)
  // ──────────────────────────────────────────────────────────────────────────

  private assessConfidence(result: SearchResult): 1 | 2 | 3 {
    if (result.results.length === 0) {
      return 3;
    }

    const topScore = result.confidence.topScore;
    const gap = result.confidence.gapToSecond;
    const keywordHits = result.confidence.keywordHits;

    // HIGH: top_score > tier1 AND (gap > gapThreshold OR keywordHits > 0)
    if (
      topScore >= this.tier1Threshold &&
      (gap >= this.gapThreshold || keywordHits > 0)
    ) {
      return 1;
    }

    // MEDIUM: top_score > tier2
    if (topScore >= this.tier2Threshold) {
      return 2;
    }

    // LOW: everything else
    return 3;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Tier handlers
  // ──────────────────────────────────────────────────────────────────────────

  private async handleTier1(
    query: string,
    result: SearchResult,
    startTime: number,
    degraded: boolean = false,
    reranked: boolean = false
  ): Promise<FindSkillResponse> {
    const skillResults = await this.buildSkillResults(result.results, query);

    return {
      results: skillResults,
      confidence: 'high',
      enriched: false,
      meta: {
        matchSources: result.results.slice(0, 3).map((r) => r.matchSource),
        latencyMs: Date.now() - startTime,
        tier: 1,
        cacheHit: false,
        llmInvoked: false,
        ...(degraded ? { degraded: true } : {}),
        ...(reranked ? { reranked: true } : {}),
      },
    };
  }

  private async handleTier2(
    query: string,
    result: SearchResult,
    filters: SearchFilters,
    startTime: number,
    reranked: boolean = false,
    preGeneratedQueries?: string[]
  ): Promise<FindSkillResponse> {
    // Synchronous LLM expansion: generate alternate queries, re-search, merge.
    // Pre-generated queries from the parallel reranking+LLM step skip the
    // LLM call.
    if (this.deepSearchEnabled) {
      try {
        const enrichedResult = await this.deepSearch.expandAndReSearch(
          query,
          result,
          filters,
          preGeneratedQueries
        );

        if (enrichedResult.results.length > 0) {
          const skillResults = await this.buildSkillResults(
            enrichedResult.results,
            query
          );
          return {
            results: skillResults,
            confidence: 'medium',
            enriched: true,
            meta: {
              matchSources: enrichedResult.results
                .slice(0, 3)
                .map((r) => r.matchSource),
              latencyMs: Date.now() - startTime,
              tier: 2,
              cacheHit: false,
              llmInvoked: true,
              ...(reranked ? { reranked: true } : {}),
            },
          };
        }
      } catch (error) {
        console.error('Tier 2 enrichment error:', error);
        // Fall through to return unenriched results
      }
    }

    // Fallback: return unenriched results
    const skillResults = await this.buildSkillResults(result.results, query);
    return {
      results: skillResults,
      confidence: 'medium',
      enriched: false,
      meta: {
        matchSources: result.results.slice(0, 3).map((r) => r.matchSource),
        latencyMs: Date.now() - startTime,
        tier: 2,
        cacheHit: false,
        llmInvoked: false,
        ...(reranked ? { reranked: true } : {}),
      },
    };
  }

  private async handleTier3(
    query: string,
    embedding: number[],
    result: SearchResult,
    filters: SearchFilters,
    tenantId: string,
    startTime: number,
    reranked: boolean = false
  ): Promise<FindSkillResponse> {
    if (!this.deepSearchEnabled) {
      // Deep search disabled — return raw results
      const skillResults = await this.buildSkillResults(result.results, query);
      return {
        results: skillResults,
        confidence: 'low_enriched',
        enriched: false,
        meta: {
          matchSources: result.results.slice(0, 3).map((r) => r.matchSource),
          latencyMs: Date.now() - startTime,
          tier: 3,
          cacheHit: false,
          llmInvoked: false,
          ...(reranked ? { reranked: true } : {}),
        },
      };
    }

    // Full LLM deep search (blocking)
    const deepResult = await this.deepSearch.deepSearch(
      query,
      embedding,
      result,
      filters
    );

    // Run composition detection if deep search flagged it
    let composition = deepResult.composition;
    if (!composition && deepResult.trace.alternateQueries.length > 0) {
      // Check if the merged results suggest composition
      composition = await this.compositionDetector.detect(
        query,
        deepResult.result.results,
        { tenantId }
      );
      if (!composition.detected) {
        composition = undefined;
      }
    }

    const skillResults = await this.buildSkillResults(
      deepResult.result.results,
      query
    );

    const confidence: FindSkillResponse['confidence'] = deepResult.noMatch
      ? 'no_match'
      : 'low_enriched';

    return {
      results: skillResults,
      confidence,
      enriched: true,
      composition,
      searchTrace: {
        originalQuery: deepResult.trace.originalQuery,
        alternateQueries: deepResult.trace.alternateQueries,
        terminologyMap: deepResult.trace.terminologyMap,
        reasoning: deepResult.trace.reasoning,
      },
      generationHints: deepResult.generationHints,
      meta: {
        matchSources: deepResult.result.results
          .slice(0, 3)
          .map((r) => r.matchSource),
        latencyMs: Date.now() - startTime,
        tier: 3,
        cacheHit: false,
        llmInvoked: true,
        ...(reranked ? { reranked: true } : {}),
      },
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Build SkillResult[] from ScoredSkill[]
  // ──────────────────────────────────────────────────────────────────────────

  private async buildSkillResults(
    scoredSkills: ScoredSkill[],
    query?: string
  ): Promise<SkillResult[]> {
    if (scoredSkills.length === 0) {
      return [];
    }

    const skillIds = scoredSkills.map((s) => s.skillId);

    const sql = `
      SELECT
        s.id,
        s.name,
        s.slug,
        s.version,
        s.agent_summary,
        s.trust_score,
        s.execution_layer,
        s.mcp_url,
        s.capabilities_required,
        s.skill_type,
        s.status,
        s.verification_tier,
        s.trust_badge,
        s.forked_from,
        s.run_count,
        s.last_run_at,
        s.revoked_reason,
        s.remediation_message,
        s.remediation_url,
        s.replacement_skill_id,
        rs.slug AS replacement_slug,
        s.tags,
        s.avg_execution_time_ms,
        s.error_rate,
        s.human_star_count,
        s.human_fork_count,
        s.agent_invocation_count,
        s.composition_inclusion_count,
        s.runtime_env,
        s.visibility,
        s.publisher_key_id,
        s.signature_verified_at,
        s.signature_failure_reason,
        a.handle AS author_handle,
        a.author_type AS author_type
      FROM skills s
      LEFT JOIN skills rs ON rs.id = s.replacement_skill_id
      LEFT JOIN authors a ON a.id = s.author_id
      WHERE s.id = ANY($1::uuid[])
    `;

    const result = await this.pool.query(sql, [skillIds]);

    const skillMap = new Map<string, SkillResult>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pg row
      result.rows.map((row: any) => [
        row.id as string,
        {
          id: row.id,
          name: row.name,
          slug: row.slug,
          version: row.version ?? '1.0.0',
          agentSummary: row.agent_summary,
          trustScore: parseFloat(row.trust_score),
          executionLayer: row.execution_layer,
          mcpUrl: row.mcp_url ?? undefined,
          capabilitiesRequired: row.capabilities_required ?? [],
          skillType: row.skill_type ?? 'atomic',
          status: row.status ?? 'published',
          verificationTier: row.verification_tier ?? 'unverified',
          trustBadge: row.trust_badge ?? null,
          forkedFrom: row.forked_from ?? undefined,
          runCount: parseInt(row.run_count) || 0,
          lastRunAt: row.last_run_at?.toISOString() ?? undefined,
          revokedReason: row.revoked_reason ?? undefined,
          remediationMessage: row.remediation_message ?? undefined,
          remediationUrl: row.remediation_url ?? undefined,
          replacementSkillId: row.replacement_skill_id ?? undefined,
          replacementSlug: row.replacement_slug ?? undefined,
          shareUrl: `https://skillsregistry.net/skills/${row.slug}`,
          tags: row.tags ?? undefined,
          avgExecutionTimeMs: row.avg_execution_time_ms ?? undefined,
          errorRate: row.error_rate ?? undefined,
          humanStarCount: parseInt(row.human_star_count) || 0,
          humanForkCount: parseInt(row.human_fork_count) || 0,
          agentInvocationCount: parseInt(row.agent_invocation_count) || 0,
          compositionInclusionCount:
            parseInt(row.composition_inclusion_count) || 0,
          runtimeEnv: row.runtime_env ?? 'api',
          visibility: row.visibility ?? 'public',
          authorHandle: row.author_handle ?? undefined,
          authorType: row.author_type ?? undefined,
          publisherKeyId: row.publisher_key_id ?? null,
          signatureVerifiedAt: row.signature_verified_at?.toISOString() ?? null,
          signatureFailureReason: row.signature_failure_reason ?? null,
          // Filled in below from the ScoredSkill
          score: 0,
          matchSource: '',
        },
      ])
    );

    const results: SkillResult[] = [];
    for (const ss of scoredSkills) {
      const skill = skillMap.get(ss.skillId);
      if (!skill) continue;

      results.push({
        ...skill,
        score: ss.fusedScore,
        matchSource: ss.matchSource,
        matchText: ss.matchText,
      });
    }

    // Name-match boost: if query tokens appear in the skill name, boost score.
    // Corrects reranker misrankings where a generic tool outranks a named match.
    if (query && results.length > 1 && this.nameBoostWeight > 0) {
      const nameBoostWeight = this.nameBoostWeight;
      const queryTokens = query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length >= 3);

      for (const result of results) {
        const nameLower = result.name.toLowerCase();
        const matchCount = queryTokens.filter((t) =>
          nameLower.includes(t)
        ).length;
        if (matchCount > 0) {
          const overlap = matchCount / queryTokens.length;
          result.score *= 1 + nameBoostWeight * overlap;
        }
      }
      results.sort((a, b) => b.score - a.score);
    }

    return this.deduplicateByName(results);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Search-time dedup (cross-source)
  // ──────────────────────────────────────────────────────────────────────────

  private deduplicateByName(results: SkillResult[]): SkillResult[] {
    const seen = new Map<string, number>(); // normalized name → index in deduped
    const deduped: SkillResult[] = [];

    for (const result of results) {
      const key = result.name.toLowerCase().trim();
      const existingIdx = seen.get(key);

      if (existingIdx === undefined) {
        seen.set(key, deduped.length);
        deduped.push(result);
      } else {
        // Keep the one with higher score; if tied, prefer higher trustScore
        const existing = deduped[existingIdx]!;
        if (
          result.score > existing.score ||
          (result.score === existing.score &&
            result.trustScore > existing.trustScore)
        ) {
          deduped[existingIdx] = result;
        }
      }
    }

    return deduped;
  }
}
