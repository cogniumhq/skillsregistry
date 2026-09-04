// ══════════════════════════════════════════════════════════════════════════════
// SearchService — the public-route seam around `ConfidenceGate`.
// ══════════════════════════════════════════════════════════════════════════════
//
// `T-2.11c` public handler `GET /v1/search` calls into this. The service:
//
//   1. Delegates to `ConfidenceGate.findSkill(query, tenantId, options,
//      afterResponse)` which owns the T1/T2/T3 routing, provider search,
//      optional deep-search + reranker + cache read/write, log emit.
//
//   2. Transforms the domain-shaped `FindSkillResponse` into the
//      contract-shaped `SearchResponse` (see
//      `@skillsregistry/contracts/responses.SearchResponseSchema`) that the
//      mothership REST surface promises.
//
// The transform is the point of this file. `FindSkillResponse.results`
// carries the full `SkillResult` (~30 fields, including run counts, quality
// tiers, D2 signing surface, etc.) whereas the wire contract's
// `ScoredSkillSchema` is a bounded projection. This mapping does the
// projection deterministically so the mothership and local node return
// bit-identical JSON for the same skill set.
//
// Note: the domain's `confidence` is a categorical (`high|medium|low_enriched|
// no_match`) while the wire contract's `confidence` is a number 0..1.
// We map by taking the top-result `score` (already normalized to 0..1 by
// the provider fusion). `signals` is documented as advisory — mothership
// populates it with per-source contributions during fusion; the local node
// leaves it empty since the domain response does not carry those
// per-source scores. A future task can plumb them through the provider.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { NodeAfterResponse } from '../adapters/index.js';
import type {
  ConfidenceGate,
  FindSkillOptions,
} from '@skillsregistry/domain/intelligence';
import type {
  Appetite,
  FindSkillResponse,
  SkillResult,
  SkillVisibility,
} from '@skillsregistry/domain/types';

/**
 * Options accepted by `search()`. Mirrors the query surface of
 * `GET /v1/search` — the route handler wires each param through 1:1
 * after validating it.
 */
export interface SearchOptions {
  /** Advisory tenant scope. Air-gap local installs pass `'local'`. */
  tenantId: string;
  /** Optional risk appetite; defaults to `SEARCH_DEFAULT_APPETITE`. */
  appetite?: Appetite;
  /** Result cap (1..50). Defaults to 10. */
  limit?: number;
  /** Tag filter. */
  tags?: string[];
  /** Category filter (single value). */
  category?: string;
  /** Runtime env filter (multi-value: 'api', 'vm', 'llm', 'agent', ...). */
  runtimeEnv?: string[];
  /** Visibility filter — 4-band model per `SkillVisibility` (#95). */
  visibility?: SkillVisibility;
  /** Portable filter (MCP-portable skills only). */
  portable?: boolean;
}

/** Skill projection matching `ScoredSkillSchema` in `@skillsregistry/contracts`. */
export interface ScoredSkill {
  id: string;
  name: string;
  slug: string;
  description: string;
  score: number;
  matchSource?: string;
  trustScore?: number;
  verificationTier?: string;
  tags?: string[];
  category?: string | null;
  executionLayer?: string;
  runtimeEnv?: string;
  visibility?: string;
  source?: string;
  publisherKeyId?: string | null;
  signatureVerifiedAt?: string | null;
  signatureFailureReason?: string | null;
}

/** Meta projection matching `SearchMetaSchema`. */
export interface SearchMeta {
  tier: number;
  confidence: number;
  signals: Array<{ source: string; score: number; weight: number }>;
  latencyMs: number;
  source: string;
  cached: boolean;
  deepSearchUsed?: boolean;
}

/** Envelope matching `SearchResponseSchema`. */
export interface SearchResponse {
  skills: ScoredSkill[];
  meta: SearchMeta;
}

export interface SearchServiceOptions {
  gate: ConfidenceGate;
  afterResponse: NodeAfterResponse;
}

export class SearchService {
  private readonly gate: ConfidenceGate;
  private readonly afterResponse: NodeAfterResponse;

  constructor(opts: SearchServiceOptions) {
    this.gate = opts.gate;
    this.afterResponse = opts.afterResponse;
  }

  /**
   * Run a search. Delegates to `ConfidenceGate.findSkill` and projects the
   * result into the wire contract shape. Never throws through — provider
   * / embedder / cache errors surface as thrown from `gate.findSkill`.
   */
  async search(query: string, options: SearchOptions): Promise<SearchResponse> {
    const gateOptions: FindSkillOptions = {
      limit: options.limit,
      appetite: options.appetite,
      tags: options.tags,
      category: options.category,
      runtimeEnv: options.runtimeEnv,
      visibility: options.visibility,
      portable: options.portable,
    };

    const domain = await this.gate.findSkill(
      query,
      options.tenantId,
      gateOptions,
      this.afterResponse,
    );

    return projectResponse(domain);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain → contract mapping. Pure. Exported for direct testing.
// ─────────────────────────────────────────────────────────────────────────────

export function projectResponse(domain: FindSkillResponse): SearchResponse {
  const skills = domain.results.map(projectSkill);
  const topScore = skills.length > 0 ? skills[0]!.score : 0;

  const meta: SearchMeta = {
    tier: domain.meta.tier,
    confidence: clamp01(topScore),
    // Per-source signals aren't carried on `FindSkillResponse.meta` today.
    // Kept empty so the wire shape is complete; a future provider-surface
    // change can populate this without changing consumers.
    signals: [],
    latencyMs: domain.meta.latencyMs,
    source: 'local',
    cached: domain.meta.cacheHit,
    deepSearchUsed: domain.meta.llmInvoked,
  };

  return { skills, meta };
}

function projectSkill(r: SkillResult): ScoredSkill {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.agentSummary,
    score: r.score,
    matchSource: r.matchSource,
    trustScore: r.trustScore,
    verificationTier: r.verificationTier,
    tags: r.tags,
    // `category` isn't on `SkillResult` — the mothership sources it from
    // the raw manifest and returns null when absent. We honor that.
    category: null,
    executionLayer: r.executionLayer,
    runtimeEnv: r.runtimeEnv,
    visibility: r.visibility,
    source: 'local',
    publisherKeyId: r.publisherKeyId ?? null,
    signatureVerifiedAt: r.signatureVerifiedAt ?? null,
    signatureFailureReason: r.signatureFailureReason ?? null,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
