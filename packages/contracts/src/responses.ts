// ══════════════════════════════════════════════════════════════════════════════
// OpenAPI Response Schemas
// ══════════════════════════════════════════════════════════════════════════════

import { z } from '@hono/zod-openapi';

// ── Generic ──

export const ErrorResponseSchema = z
  .object({
    error: z.string(),
  })
  .openapi('ErrorResponse');

export const SuccessResponseSchema = z
  .object({
    success: z.boolean(),
  })
  .openapi('SuccessResponse');

// ── Health ──

export const HealthResponseSchema = z
  .object({
    ok: z.boolean(),
    service: z.string(),
    version: z.string(),
    environment: z.string(),
    dbStatus: z.string(),
    dbLatencyMs: z.number(),
    dbError: z.string().nullable(),
    tables: z.array(z.string()),
    missingTables: z.array(z.string()),
    aiStatus: z.string(),
    aiError: z.string().nullable(),
    aiIdentity: z.string().nullable().optional(),
    timestamp: z.string(),
  })
  .openapi('HealthResponse');

// ── Search ──

const ConfidenceSignalSchema = z.object({
  source: z.string(),
  score: z.number(),
  weight: z.number(),
});

const SearchMetaSchema = z.object({
  tier: z.number(),
  confidence: z.number(),
  signals: z.array(ConfidenceSignalSchema),
  latencyMs: z.number(),
  source: z.string(),
  cached: z.boolean(),
  deepSearchUsed: z.boolean().optional(),
});

const ScoredSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  score: z.number(),
  matchSource: z.string().optional(),
  trustScore: z.number().optional(),
  verificationTier: z.string().optional(),
  tags: z.array(z.string()).optional(),
  category: z.string().nullable().optional(),
  executionLayer: z.string().optional(),
  runtimeEnv: z.string().optional(),
  visibility: z.string().optional(),
  source: z.string().optional(),
  // D2 publisher-signing surface (nullable for pre-D2 / sync-exempt rows).
  publisherKeyId: z.string().nullable().optional(),
  signatureVerifiedAt: z.string().nullable().optional(),
  signatureFailureReason: z.string().nullable().optional(),
});

export const SearchResponseSchema = z
  .object({
    skills: z.array(ScoredSkillSchema),
    meta: SearchMetaSchema,
  })
  .openapi('SearchResponse');

// ── Skill Detail ──

export const SkillDetailSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    version: z.string(),
    description: z.string(),
    agentSummary: z.string().nullable(),
    trustScore: z.number(),
    verificationTier: z.string(),
    trustBadge: z.string().nullable(),
    status: z.string(),
    executionLayer: z.string(),
    mcpUrl: z.string().nullable(),
    skillMd: z.string().nullable(),
    capabilitiesRequired: z.array(z.string()),
    skillType: z.string(),
    schemaJson: z.unknown().nullable(),
    source: z.string(),
    sourceUrl: z.string().nullable(),
    tags: z.array(z.string()),
    category: z.string().nullable(),
    categories: z.array(z.string()),
    ecosystem: z.string().nullable(),
    language: z.string().nullable(),
    license: z.string().nullable(),
    readme: z.string().nullable(),
    r2BundleKey: z.string().nullable(),
    authRequirements: z.string().nullable(),
    installMethod: z.string().nullable(),
    forkedFrom: z.string().nullable(),
    runCount: z.number(),
    lastRunAt: z.string().nullable(),
    authorId: z.string().nullable(),
    authorType: z.string(),
    tenantId: z.string().nullable(),
    revokedReason: z.string().nullable(),
    remediationMessage: z.string().nullable(),
    remediationUrl: z.string().nullable(),
    replacementSkillId: z.string().nullable(),
    replacementSlug: z.string().nullable(),
    shareUrl: z.string(),
    avgExecutionTimeMs: z.number().nullable(),
    errorRate: z.number().nullable(),
    humanStarCount: z.number(),
    humanForkCount: z.number(),
    agentInvocationCount: z.number(),
    runtimeEnv: z.string(),
    visibility: z.string(),
    environmentVariables: z.array(z.string()),
    cogniumScanned: z.boolean(),
    cogniumScannedAt: z.string().nullable(),
    scanCoverage: z.string().nullable(),
    contentSafetyPassed: z.boolean().nullable(),
    qualityScore: z.number().nullable(),
    qualityTier: z.string().nullable(),
    qualityResults: z.unknown().nullable(),
    qualityAnalyzedAt: z.string().nullable(),
    trustScoreV2: z.number().nullable(),
    trustTier: z.string().nullable(),
    trustResults: z.unknown().nullable(),
    trustAnalyzedAt: z.string().nullable(),
    understandResults: z.unknown().nullable(),
    understandAnalyzedAt: z.string().nullable(),
    specAlignmentScore: z.number().nullable(),
    specGaps: z.unknown().nullable(),
    specAnalyzedAt: z.string().nullable(),
    // D2 publisher-signing surface — see techspec/skillsregistry.md §11 and
    // techspec/cortex.md §6.3. NULL for pre-D2 rows, sync-exempt rows, and
    // failed-verify rows (failure detail lives in signatureFailureReason).
    publisherKeyId: z.string().nullable(),
    signatureVerifiedAt: z.string().nullable(),
    signatureFailureReason: z.string().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
    publishedAt: z.string().nullable(),
  })
  .openapi('SkillDetail');

// ── Skill Pull (v5.3) ──

export const SkillPullResponseSchema = z
  .object({
    slug: z.string(),
    version: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    skillMd: z.string().nullable(),
    schemaJson: z.unknown().nullable(),
    executionLayer: z.string(),
    runtimeEnv: z.string(),
    portable: z.boolean(),
    trustScore: z.number(),
    verificationTier: z.string(),
    trustBadge: z.string().nullable(),
    status: z.string(),
    tags: z.array(z.string()),
    categories: z.array(z.string()),
    authRequirements: z.unknown().nullable(),
    capabilitiesRequired: z.array(z.string()),
    mcpUrl: z.string().nullable(),
    forkedFrom: z.string().nullable(),
    source: z.string(),
    // D2 publisher-signing surface — Cortex inspects these on pull to build
    // signatureChain (techspec/cortex.md §6.3) before dispatching.
    publisherKeyId: z.string().nullable(),
    signatureVerifiedAt: z.string().nullable(),
    signatureFailureReason: z.string().nullable(),
  })
  .openapi('SkillPullResponse');

// ── Skill Versions ──

const SkillVersionSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  status: z.string(),
  trustScore: z.number(),
  verificationTier: z.string(),
  runCount: z.number(),
  executionLayer: z.string(),
  source: z.string(),
  skillType: z.string(),
  runtimeEnv: z.string(),
  visibility: z.string(),
  cogniumScanned: z.boolean(),
  cogniumScannedAt: z.string().nullable(),
  scanCoverage: z.string().nullable(),
  // D2 publisher-signing surface per-version (techspec/skillsregistry.md §11).
  publisherKeyId: z.string().nullable(),
  signatureVerifiedAt: z.string().nullable(),
  signatureFailureReason: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
});

export const SkillVersionsResponseSchema = z
  .object({
    slug: z.string(),
    totalVersions: z.number(),
    versions: z.array(SkillVersionSummarySchema),
  })
  .openapi('SkillVersionsResponse');

// ── Analytics ──

export const TierDistributionSchema = z
  .object({
    tier1: z.number(),
    tier2: z.number(),
    tier3: z.number(),
    total: z.number(),
  })
  .passthrough()
  .openapi('TierDistribution');

export const MatchSourcesResponseSchema = z
  .object({
    matchSources: z.record(z.number()),
  })
  .openapi('MatchSourcesResponse');

export const LatencyPercentilesSchema = z
  .object({
    p50: z.number(),
    p95: z.number(),
    p99: z.number(),
  })
  .passthrough()
  .openapi('LatencyPercentiles');

export const CostBreakdownSchema = z.object({}).passthrough().openapi('CostBreakdown');

export const FailedQueriesResponseSchema = z
  .object({
    queries: z.array(z.unknown()),
  })
  .openapi('FailedQueriesResponse');

export const Tier3PatternsResponseSchema = z
  .object({
    patterns: z.array(z.unknown()),
  })
  .openapi('Tier3PatternsResponse');

export const RevokedImpactResponseSchema = z
  .object({
    revokedCount: z.number(),
    revokedSkills: z.array(z.unknown()),
    affectedSearches30d: z.number(),
  })
  .openapi('RevokedImpactResponse');

export const VulnerableUsageResponseSchema = z
  .object({
    vulnerableCount: z.number(),
    vulnerableSkills: z.array(z.unknown()),
    appearedInSearch30d: z.number(),
  })
  .openapi('VulnerableUsageResponse');

// ── Eval ──

export const EvalRunResponseSchema = z
  .object({
    success: z.boolean(),
    runId: z.string(),
    timestamp: z.string(),
    metrics: z.object({
      recall1: z.number(),
      recall5: z.number(),
      mrr: z.number(),
    }).passthrough(),
    summary: z.object({
      fixtureCount: z.number(),
      passed: z.number(),
      failed: z.number(),
    }),
    errors: z.array(z.unknown()),
  })
  .openapi('EvalRunResponse');

export const EvalResultsListSchema = z
  .object({
    runs: z.array(
      z.object({
        runId: z.string(),
        timestamp: z.string(),
        recall1: z.number(),
        recall5: z.number(),
        mrr: z.number(),
        passed: z.number(),
        failed: z.number(),
        fixtureCount: z.number(),
      })
    ),
  })
  .openapi('EvalResultsList');

export const EvalCompareResponseSchema = z
  .object({
    runA: z.object({ runId: z.string(), timestamp: z.string() }),
    runB: z.object({ runId: z.string(), timestamp: z.string() }),
    metrics: z.record(z.unknown()),
    summary: z.record(z.unknown()),
    tierDistribution: z.record(z.unknown()),
  })
  .openapi('EvalCompareResponse');

// ── Composition ──

export const CompositionDetailSchema = z
  .object({
    steps: z.array(
      z.object({
        id: z.string(),
        stepOrder: z.number(),
        skillId: z.string(),
        skillName: z.string(),
        skillSlug: z.string(),
        stepName: z.string().nullable(),
        inputMapping: z.unknown().nullable(),
        onError: z.string(),
      })
    ),
  })
  .passthrough()
  .openapi('CompositionDetail');

// ── Lineage ──

export const AncestryResponseSchema = z
  .object({
    ancestry: z.array(z.unknown()),
  })
  .openapi('AncestryResponse');

export const ForksResponseSchema = z
  .object({
    forks: z.array(z.unknown()),
  })
  .openapi('ForksResponse');

export const DependentsResponseSchema = z
  .object({
    dependents: z.array(z.unknown()),
  })
  .openapi('DependentsResponse');

// ── Social ──

export const StarResultSchema = z
  .object({
    starred: z.boolean(),
    starCount: z.number(),
  })
  .passthrough()
  .openapi('StarResult');

export const StarStatusSchema = z
  .object({
    starCount: z.number(),
    starred: z.boolean().optional(),
  })
  .passthrough()
  .openapi('StarStatus');

export const InvocationAcceptedSchema = z
  .object({
    accepted: z.boolean(),
    count: z.number(),
  })
  .openapi('InvocationAccepted');

export const CoOccurrenceResponseSchema = z
  .object({
    cooccurrence: z.array(z.unknown()),
  })
  .openapi('CoOccurrenceResponse');

// ── Leaderboards ──

export const LeaderboardResponseSchema = z
  .object({
    leaderboard: z.array(z.unknown()),
  })
  .openapi('LeaderboardResponse');

// ── Publish ──

export const PublishResultSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    version: z.string(),
    status: z.string(),
  })
  .openapi('PublishResult');

export const DeleteResultSchema = z
  .object({
    id: z.string(),
    status: z.literal('deleted'),
  })
  .openapi('DeleteResult');

// ── Authors ──

export const AuthorProfileSchema = z
  .object({
    id: z.string(),
    handle: z.string(),
    displayName: z.string().nullable(),
    authorType: z.string(),
    bio: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    homepageUrl: z.string().nullable(),
    botModel: z.string().nullable(),
    verified: z.boolean(),
    stats: z.object({
      publishedCount: z.number(),
      totalStars: z.number(),
      totalInvocations: z.number(),
      totalForks: z.number(),
    }),
    createdAt: z.string(),
  })
  .openapi('AuthorProfile');

export const AuthorSkillsResponseSchema = z
  .object({
    skills: z.array(z.unknown()),
    limit: z.number(),
    offset: z.number(),
  })
  .openapi('AuthorSkillsResponse');
