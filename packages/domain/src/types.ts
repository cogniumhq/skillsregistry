// ══════════════════════════════════════════════════════════════════════════════
// Domain-facing types for the search + retrieval surface
// ══════════════════════════════════════════════════════════════════════════════
//
// Extracted from the mothership `src/types.ts`. Intentionally trimmed to the
// types that flow through the SearchProvider abstraction (index write shape,
// filter shape, scored-result shape). Higher-level types used by the
// intelligence and composition layers land alongside those modules in later
// T-1.4x subtasks.
//
// Never widen this file with runtime-specific types (CF `Env`, queue
// bindings, KV namespace types). Those stay in the consumer.
//
// ══════════════════════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────────────────────
// Skill status / trust taxonomy
// ──────────────────────────────────────────────────────────────────────────────

export type SkillStatus =
  | 'draft'
  | 'published'
  | 'deprecated'
  | 'archived'
  | 'vulnerable'
  | 'revoked'
  | 'degraded'
  | 'contains-vulnerable';

export type SkillType =
  | 'atomic'
  | 'auto-composite'
  | 'human-composite'
  | 'forked';

export type VerificationTier =
  | 'unverified'
  | 'scanned'
  | 'verified'
  | 'certified';

export type TrustBadge = 'human-verified' | 'auto-distilled' | 'upstream';

// ──────────────────────────────────────────────────────────────────────────────
// Skill Input (ingestion)
// ──────────────────────────────────────────────────────────────────────────────

export interface SkillInput {
  id: string;
  name: string;
  slug: string;
  version: string;
  source: string;
  description: string;
  agentSummary?: string;
  tags: string[];
  category?: string;
  schemaJson?: Record<string, unknown>;
  authRequirements?: Record<string, unknown>;
  installMethod?: Record<string, unknown>;
  trustScore: number;
  capabilitiesRequired?: string[];
  executionLayer: string;
  tenantId: string;
}

export interface EmbeddingSet {
  agentSummary: {
    text: string;
    embedding: number[];
  };
  // §10 scope A: identity stamp persisted as skill_embeddings.embed_model.
  // Re-embed gate: rows whose embed_model differs from the current
  // Embedder.identity are enqueued by /v1/admin/embed-rebackfill.
  embedderIdentity: string;
  // Selects the storage column at write time:
  //   384 → legacy vector(384) embedding
  //   512 → halfvec(512) embedding_h512
  storedDims: number;

  // A2: optional shadow vector for the dual-write rollout. When DUAL_WRITE=1,
  // EmbedPipeline runs a second embedder in parallel and populates this
  // field. PgVectorProvider.index writes whichever column matches each
  // vector's storedDims. The shadow identity is stamped into the matching
  // embed_model* column so the re-embed gate works per column.
  shadowAgentSummary?: {
    embedding: number[];
  };
  shadowEmbedderIdentity?: string;
  shadowStoredDims?: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Search provider interface — filter/option/result shapes
// ──────────────────────────────────────────────────────────────────────────────

export interface SearchFilters {
  tenantId: string;
  tags?: string[];
  category?: string;
  minTrustScore?: number; // trust-based filtering
  executionLayer?: string; // filter by execution capability
  contentSafetyRequired?: boolean; // default true
  allowVulnerable?: boolean; // v5.0: include vulnerable/contains-vulnerable skills
  statusFilter?: SkillStatus[]; // v5.0: explicit status filter
  slug?: string; // v5.0: pin to specific slug
  version?: string; // v5.0: pin to specific version
  // v5.2: execution environment + visibility
  runtimeEnv?: string[]; // filter by runtime environment(s)
  visibility?: 'public' | 'private' | 'unlisted'; // default: respects tenant scope
  // v5.3: portable filter
  portable?: boolean;
}

export interface SearchOptions {
  limit?: number; // default 10
  offset?: number;
  includeMatchText?: boolean; // include source_text for debugging
}

export interface SearchResult {
  results: ScoredSkill[];
  confidence: ConfidenceSignal;
  meta: SearchMeta;
}

export interface ScoredSkill {
  skillId: string;
  score: number; // cosine similarity (0–1)
  fullTextScore: number; // tsvector rank (normalized 0–1)
  fusedScore: number; // final score after fusion
  matchSource: string; // which embedding type matched
  matchText?: string; // the text that matched
}

export interface ConfidenceSignal {
  topScore: number;
  gapToSecond: number;
  clusterDensity: number; // count of results above tier2 threshold
  keywordHits: number;
  tier: 1 | 2 | 3;
}

export interface SearchMeta {
  latencyMs: number;
  vectorSearchMs: number;
  fullTextSearchMs: number;
  fusionStrategy: 'score_blend' | 'rrf';
  totalCandidates: number;
  cacheHit: boolean;
}
