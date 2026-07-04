// ══════════════════════════════════════════════════════════════════════════════
// Zod round-trip smoke — every exported public schema
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  // common
  SkillIdParam,
  SkillSlugParam,
  VersionParam,
  HoursQuery,
  LimitQuery,
  OffsetQuery,
  // responses
  ErrorResponseSchema,
  SuccessResponseSchema,
  HealthResponseSchema,
  SearchResponseSchema,
  SkillDetailSchema,
  SkillPullResponseSchema,
  SkillVersionsResponseSchema,
  TierDistributionSchema,
  MatchSourcesResponseSchema,
  LatencyPercentilesSchema,
  CostBreakdownSchema,
  FailedQueriesResponseSchema,
  Tier3PatternsResponseSchema,
  RevokedImpactResponseSchema,
  VulnerableUsageResponseSchema,
  EvalRunResponseSchema,
  EvalResultsListSchema,
  EvalCompareResponseSchema,
  CompositionDetailSchema,
  AncestryResponseSchema,
  ForksResponseSchema,
  DependentsResponseSchema,
  StarResultSchema,
  StarStatusSchema,
  InvocationAcceptedSchema,
  CoOccurrenceResponseSchema,
  LeaderboardResponseSchema,
  PublishResultSchema,
  DeleteResultSchema,
  AuthorProfileSchema,
  AuthorSkillsResponseSchema,
  AdminSkillsListResponseSchema,
  // upstream
  TrustScoreRequestSchema,
  TrustScoreResponseSchema,
  BudgetResponseSchema,
  PublishRequestSchema,
  PublishResponseSchema,
  TrustScoreDeltaSchema,
  TrustScoreSyncResponseSchema,
  UpstreamErrorSchema,
} from './index.js';

// ──────────────────────────────────────────────────────────────────────────────
// Common OpenAPI params — string-based, minimal validation
// ──────────────────────────────────────────────────────────────────────────────

describe('common params', () => {
  it('SkillIdParam accepts a UUID', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(SkillIdParam.parse(uuid)).toBe(uuid);
  });

  it('SkillIdParam rejects a non-UUID', () => {
    expect(() => SkillIdParam.parse('not-a-uuid')).toThrow();
  });

  it('SkillSlugParam / VersionParam accept plain strings', () => {
    expect(SkillSlugParam.parse('rust-lint')).toBe('rust-lint');
    expect(VersionParam.parse('1.0.0')).toBe('1.0.0');
  });

  it.each([
    ['HoursQuery', HoursQuery, '24'],
    ['LimitQuery', LimitQuery, '100'],
    ['OffsetQuery', OffsetQuery, '0'],
  ] as const)('%s defaults to %s when omitted', (_, schema, expected) => {
    expect(schema.parse(undefined)).toBe(expected);
  });

  it.each([
    ['HoursQuery', HoursQuery, '72'],
    ['LimitQuery', LimitQuery, '50'],
    ['OffsetQuery', OffsetQuery, '20'],
  ] as const)('%s passes through a supplied string %s', (_, schema, value) => {
    expect(schema.parse(value)).toBe(value);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Response envelopes
// ──────────────────────────────────────────────────────────────────────────────

describe('generic envelopes', () => {
  it('ErrorResponseSchema round-trips', () => {
    const v = { error: 'boom' };
    expect(ErrorResponseSchema.parse(v)).toEqual(v);
  });

  it('ErrorResponseSchema requires error', () => {
    expect(() => ErrorResponseSchema.parse({})).toThrow();
  });

  it('SuccessResponseSchema round-trips', () => {
    expect(SuccessResponseSchema.parse({ success: true })).toEqual({
      success: true,
    });
  });

  it('SuccessResponseSchema requires boolean success', () => {
    expect(() => SuccessResponseSchema.parse({ success: 'yes' })).toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// HealthResponse
// ──────────────────────────────────────────────────────────────────────────────

describe('HealthResponseSchema', () => {
  const valid = {
    ok: true,
    service: 'skillsregistry',
    version: '1.0.0',
    environment: 'production',
    dbStatus: 'ok',
    dbLatencyMs: 12,
    dbError: null,
    tables: ['skills'],
    missingTables: [],
    aiStatus: 'ok',
    aiError: null,
    aiIdentity: 'ollama',
    timestamp: '2026-01-01T00:00:00Z',
  };

  it('round-trips a well-formed row', () => {
    expect(HealthResponseSchema.parse(valid)).toEqual(valid);
  });

  it('accepts aiIdentity as null / undefined', () => {
    expect(HealthResponseSchema.parse({ ...valid, aiIdentity: null }).aiIdentity).toBeNull();
    const { aiIdentity: _drop, ...withoutOptional } = valid;
    void _drop;
    expect(HealthResponseSchema.parse(withoutOptional).aiIdentity).toBeUndefined();
  });

  it('rejects wrong-typed dbLatencyMs', () => {
    expect(() =>
      HealthResponseSchema.parse({ ...valid, dbLatencyMs: 'fast' }),
    ).toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SearchResponse
// ──────────────────────────────────────────────────────────────────────────────

describe('SearchResponseSchema', () => {
  const valid = {
    skills: [
      {
        id: 'sk_1',
        name: 'A',
        slug: 'a',
        description: '',
        score: 0.9,
      },
    ],
    meta: {
      tier: 1,
      confidence: 0.9,
      signals: [{ source: 'bm25', score: 0.5, weight: 0.3 }],
      latencyMs: 42,
      source: 'pgvector',
      cached: false,
    },
  };

  it('round-trips a minimal shape', () => {
    expect(SearchResponseSchema.parse(valid)).toEqual(valid);
  });

  it('tolerates deepSearchUsed being absent', () => {
    const parsed = SearchResponseSchema.parse(valid);
    expect(parsed.meta.deepSearchUsed).toBeUndefined();
  });

  it('accepts all optional ScoredSkill trust fields', () => {
    const enriched = {
      ...valid,
      skills: [
        {
          ...valid.skills[0],
          trustScore: 0.8,
          verificationTier: 'verified',
          tags: ['rust'],
          category: 'dev-tools',
          publisherKeyId: null,
          signatureVerifiedAt: null,
          signatureFailureReason: null,
        },
      ],
    };
    expect(SearchResponseSchema.parse(enriched)).toEqual(enriched);
  });

  it('rejects a signal with no score', () => {
    const bad = {
      ...valid,
      meta: {
        ...valid.meta,
        signals: [{ source: 'bm25', weight: 0.3 }],
      },
    };
    expect(() => SearchResponseSchema.parse(bad)).toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SkillDetail — the heaviest schema; smoke-test nullable fields
// ──────────────────────────────────────────────────────────────────────────────

function baseSkillDetail() {
  return {
    id: 'sk_1',
    name: 'A',
    slug: 'a',
    version: '1.0.0',
    description: '',
    agentSummary: null,
    trustScore: 0.5,
    verificationTier: 'verified',
    trustBadge: null,
    status: 'published',
    executionLayer: 'api',
    mcpUrl: null,
    skillMd: null,
    capabilitiesRequired: [],
    skillType: 'atomic',
    schemaJson: null,
    source: 'manual',
    sourceUrl: null,
    tags: [],
    category: null,
    categories: [],
    ecosystem: null,
    language: null,
    license: null,
    readme: null,
    r2BundleKey: null,
    authRequirements: null,
    installMethod: null,
    forkedFrom: null,
    runCount: 0,
    lastRunAt: null,
    authorId: null,
    authorType: 'human',
    tenantId: null,
    revokedReason: null,
    remediationMessage: null,
    remediationUrl: null,
    replacementSkillId: null,
    replacementSlug: null,
    shareUrl: 'https://x/skills/a',
    avgExecutionTimeMs: null,
    errorRate: null,
    humanStarCount: 0,
    humanForkCount: 0,
    agentInvocationCount: 0,
    runtimeEnv: 'api',
    visibility: 'public',
    environmentVariables: [],
    cogniumScanned: false,
    cogniumScannedAt: null,
    scanCoverage: null,
    contentSafetyPassed: null,
    qualityScore: null,
    qualityTier: null,
    qualityResults: null,
    qualityAnalyzedAt: null,
    trustScoreV2: null,
    trustTier: null,
    trustResults: null,
    trustAnalyzedAt: null,
    understandResults: null,
    understandAnalyzedAt: null,
    specAlignmentScore: null,
    specGaps: null,
    specAnalyzedAt: null,
    publisherKeyId: null,
    signatureVerifiedAt: null,
    signatureFailureReason: null,
    createdAt: null,
    updatedAt: null,
    publishedAt: null,
  };
}

describe('SkillDetailSchema', () => {
  it('round-trips a fully-null baseline', () => {
    const v = baseSkillDetail();
    expect(SkillDetailSchema.parse(v)).toEqual(v);
  });

  it('rejects when a required non-nullable field is missing', () => {
    const { id: _drop, ...bad } = baseSkillDetail();
    void _drop;
    expect(() => SkillDetailSchema.parse(bad)).toThrow();
  });

  it('rejects when contentSafetyPassed is a string instead of boolean|null', () => {
    expect(() =>
      SkillDetailSchema.parse({ ...baseSkillDetail(), contentSafetyPassed: 'yes' }),
    ).toThrow();
  });

  it('accepts D2 publisher-signing fields as strings or nulls', () => {
    const v = {
      ...baseSkillDetail(),
      publisherKeyId: 'pk_1',
      signatureVerifiedAt: '2026-01-01T00:00:00Z',
      signatureFailureReason: null,
    };
    expect(SkillDetailSchema.parse(v).publisherKeyId).toBe('pk_1');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SkillPull / SkillVersions
// ──────────────────────────────────────────────────────────────────────────────

describe('SkillPullResponseSchema', () => {
  const v = {
    slug: 'a',
    version: '1.0.0',
    name: 'A',
    description: null,
    skillMd: null,
    schemaJson: null,
    executionLayer: 'api',
    runtimeEnv: 'api',
    portable: true,
    trustScore: 0.9,
    verificationTier: 'verified',
    trustBadge: null,
    status: 'published',
    tags: [],
    categories: [],
    authRequirements: null,
    capabilitiesRequired: [],
    mcpUrl: null,
    forkedFrom: null,
    source: 'manual',
    publisherKeyId: null,
    signatureVerifiedAt: null,
    signatureFailureReason: null,
  };

  it('round-trips a well-formed pull row', () => {
    expect(SkillPullResponseSchema.parse(v)).toEqual(v);
  });

  it('rejects when portable is missing', () => {
    const { portable: _drop, ...bad } = v;
    void _drop;
    expect(() => SkillPullResponseSchema.parse(bad)).toThrow();
  });
});

describe('SkillVersionsResponseSchema', () => {
  it('round-trips an empty list', () => {
    const v = { slug: 'a', totalVersions: 0, versions: [] };
    expect(SkillVersionsResponseSchema.parse(v)).toEqual(v);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Analytics envelopes with passthrough
// ──────────────────────────────────────────────────────────────────────────────

describe('analytics passthrough schemas', () => {
  it('TierDistribution keeps extra fields via passthrough', () => {
    const v = { tier1: 1, tier2: 2, tier3: 3, total: 6, extra: 'ok' };
    expect(TierDistributionSchema.parse(v)).toEqual(v);
  });

  it('LatencyPercentiles keeps extra fields', () => {
    const v = { p50: 10, p95: 20, p99: 30, p999: 40 };
    expect(LatencyPercentilesSchema.parse(v)).toEqual(v);
  });

  it('CostBreakdown accepts any object', () => {
    const v = { a: 1, b: 2 };
    expect(CostBreakdownSchema.parse(v)).toEqual(v);
  });

  it('MatchSourcesResponse accepts a numeric record', () => {
    const v = { matchSources: { bm25: 3, vec: 5 } };
    expect(MatchSourcesResponseSchema.parse(v)).toEqual(v);
  });

  it('FailedQueriesResponse accepts unknown[] payloads', () => {
    const v = { queries: [{ q: 'foo', tier: 3 }, 'bar'] };
    expect(FailedQueriesResponseSchema.parse(v)).toEqual(v);
  });

  it('Tier3PatternsResponse accepts unknown[] payloads', () => {
    const v = { patterns: [1, 2, 3] };
    expect(Tier3PatternsResponseSchema.parse(v)).toEqual(v);
  });

  it('RevokedImpactResponse round-trips', () => {
    const v = {
      revokedCount: 2,
      revokedSkills: [{ id: 'a' }],
      affectedSearches30d: 10,
    };
    expect(RevokedImpactResponseSchema.parse(v)).toEqual(v);
  });

  it('VulnerableUsageResponse round-trips', () => {
    const v = { vulnerableCount: 3, vulnerableSkills: [], appearedInSearch30d: 5 };
    expect(VulnerableUsageResponseSchema.parse(v)).toEqual(v);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Eval envelopes
// ──────────────────────────────────────────────────────────────────────────────

describe('EvalRunResponseSchema', () => {
  const v = {
    success: true,
    runId: 'r_1',
    timestamp: '2026-01-01T00:00:00Z',
    metrics: { recall1: 0.9, recall5: 0.99, mrr: 0.95 },
    summary: { fixtureCount: 91, passed: 91, failed: 0 },
    errors: [],
  };

  it('round-trips', () => {
    expect(EvalRunResponseSchema.parse(v)).toEqual(v);
  });

  it('tolerates extra metrics keys via passthrough', () => {
    const enriched = {
      ...v,
      metrics: { ...v.metrics, custom: 0.5 },
    };
    expect(EvalRunResponseSchema.parse(enriched).metrics.custom).toBe(0.5);
  });
});

describe('EvalResultsListSchema + EvalCompareResponseSchema', () => {
  it('EvalResultsList round-trips an empty list', () => {
    expect(EvalResultsListSchema.parse({ runs: [] })).toEqual({ runs: [] });
  });

  it('EvalCompare accepts arbitrary metrics/summary/tierDistribution', () => {
    const v = {
      runA: { runId: 'a', timestamp: 't' },
      runB: { runId: 'b', timestamp: 't' },
      metrics: { any: 1 },
      summary: { any: 2 },
      tierDistribution: { t1: 10 },
    };
    expect(EvalCompareResponseSchema.parse(v)).toEqual(v);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Composition / Lineage
// ──────────────────────────────────────────────────────────────────────────────

describe('CompositionDetailSchema', () => {
  it('round-trips a composition with steps + passthrough fields', () => {
    const v = {
      id: 'comp_1',
      steps: [
        {
          id: 's1',
          stepOrder: 1,
          skillId: 'sk_a',
          skillName: 'A',
          skillSlug: 'a',
          stepName: null,
          inputMapping: null,
          onError: 'fail',
        },
      ],
    };
    expect(CompositionDetailSchema.parse(v)).toEqual(v);
  });
});

describe('lineage envelopes', () => {
  it('AncestryResponse round-trips', () => {
    expect(AncestryResponseSchema.parse({ ancestry: [] })).toEqual({ ancestry: [] });
  });

  it('ForksResponse round-trips', () => {
    expect(ForksResponseSchema.parse({ forks: [] })).toEqual({ forks: [] });
  });

  it('DependentsResponse round-trips', () => {
    expect(DependentsResponseSchema.parse({ dependents: [] })).toEqual({
      dependents: [],
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Social
// ──────────────────────────────────────────────────────────────────────────────

describe('social envelopes', () => {
  it('StarResult keeps extra fields', () => {
    const v = { starred: true, starCount: 5, extra: 1 };
    expect(StarResultSchema.parse(v)).toEqual(v);
  });

  it('StarStatus tolerates missing starred', () => {
    expect(StarStatusSchema.parse({ starCount: 5 })).toEqual({ starCount: 5 });
  });

  it('InvocationAccepted requires both fields', () => {
    expect(InvocationAcceptedSchema.parse({ accepted: true, count: 3 })).toEqual({
      accepted: true,
      count: 3,
    });
    expect(() => InvocationAcceptedSchema.parse({ accepted: true })).toThrow();
  });

  it('CoOccurrence + Leaderboard round-trip', () => {
    expect(CoOccurrenceResponseSchema.parse({ cooccurrence: [] })).toEqual({
      cooccurrence: [],
    });
    expect(LeaderboardResponseSchema.parse({ leaderboard: [] })).toEqual({
      leaderboard: [],
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Publish / Author
// ──────────────────────────────────────────────────────────────────────────────

describe('publish envelopes', () => {
  it('PublishResult round-trips', () => {
    const v = { id: 'sk_1', slug: 'a', version: '1.0.0', status: 'published' };
    expect(PublishResultSchema.parse(v)).toEqual(v);
  });

  it('DeleteResult requires literal "deleted" status', () => {
    expect(DeleteResultSchema.parse({ id: 'sk_1', status: 'deleted' })).toEqual({
      id: 'sk_1',
      status: 'deleted',
    });
    expect(() =>
      DeleteResultSchema.parse({ id: 'sk_1', status: 'archived' }),
    ).toThrow();
  });
});

describe('author envelopes', () => {
  const profile = {
    id: 'author_1',
    handle: 'eyal',
    displayName: null,
    authorType: 'human',
    bio: null,
    avatarUrl: null,
    homepageUrl: null,
    botModel: null,
    verified: false,
    stats: {
      publishedCount: 0,
      totalStars: 0,
      totalInvocations: 0,
      totalForks: 0,
    },
    createdAt: '2026-01-01T00:00:00Z',
  };

  it('AuthorProfile round-trips', () => {
    expect(AuthorProfileSchema.parse(profile)).toEqual(profile);
  });

  it('AuthorSkillsResponse round-trips', () => {
    const v = { skills: [], limit: 20, offset: 0 };
    expect(AuthorSkillsResponseSchema.parse(v)).toEqual(v);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Admin skills list (T-3.4 admin UI)
// ──────────────────────────────────────────────────────────────────────────────

describe('AdminSkillsListResponseSchema', () => {
  it('round-trips an empty page', () => {
    const v = { skills: [], total: 0, limit: 100, offset: 0 };
    expect(AdminSkillsListResponseSchema.parse(v)).toEqual(v);
  });

  it('round-trips a populated row with mothership metadata', () => {
    const v = {
      skills: [
        {
          id: 'sk_1',
          slug: 'a',
          name: 'A',
          source: 'manual',
          version: '1.0.0',
          mothershipPublishStatus: 'published',
          mothershipUrl: 'https://api.skillsregistry.net/v1/skills/sk_1',
          mothershipPublishedAt: '2026-06-01T00:00:00Z',
          createdAt: '2026-05-01T00:00:00Z',
        },
      ],
      total: 1,
      limit: 100,
      offset: 0,
    };
    expect(AdminSkillsListResponseSchema.parse(v)).toEqual(v);
  });

  it('accepts nullable mothership + createdAt fields on unpublished rows', () => {
    const v = {
      skills: [
        {
          id: 'sk_2',
          slug: 'b',
          name: 'B',
          source: 'manual',
          version: '1.0.0',
          mothershipPublishStatus: null,
          mothershipUrl: null,
          mothershipPublishedAt: null,
          createdAt: null,
        },
      ],
      total: 1,
      limit: 100,
      offset: 0,
    };
    expect(AdminSkillsListResponseSchema.parse(v)).toEqual(v);
  });

  it('rejects a row with a missing required field', () => {
    const bad = {
      skills: [{ id: 'sk_1', slug: 'a', name: 'A' }],
      total: 1,
      limit: 100,
      offset: 0,
    };
    expect(() => AdminSkillsListResponseSchema.parse(bad)).toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Upstream (mothership) contracts
// ──────────────────────────────────────────────────────────────────────────────

describe('TrustScoreRequestSchema', () => {
  it('accepts a bare skill_id', () => {
    expect(TrustScoreRequestSchema.parse({ skill_id: 'sk_1' })).toEqual({
      skill_id: 'sk_1',
    });
  });

  it('rejects empty skill_id (min 1)', () => {
    expect(() => TrustScoreRequestSchema.parse({ skill_id: '' })).toThrow();
  });

  it('accepts optional manifest snapshot', () => {
    const v = {
      skill_id: 'sk_1',
      manifest: { name: 'A', version: '1.0.0', source: 'manual' },
      tenant_id: 'tenant_a',
    };
    expect(TrustScoreRequestSchema.parse(v)).toEqual(v);
  });
});

describe('TrustScoreResponseSchema', () => {
  const v = {
    skill_id: 'sk_1',
    trust_score: 0.87,
    trust_tier: 'A' as const,
    trust_breakdown: { security: 0.9, spec: 0.8 },
    scored_at: '2026-01-01T00:00:00Z',
    tokens_consumed: 42,
  };

  it('round-trips', () => {
    expect(TrustScoreResponseSchema.parse(v)).toEqual(v);
  });

  it('rejects trust_score > 1', () => {
    expect(() =>
      TrustScoreResponseSchema.parse({ ...v, trust_score: 1.1 }),
    ).toThrow();
  });

  it('rejects unknown trust_tier', () => {
    expect(() =>
      TrustScoreResponseSchema.parse({ ...v, trust_tier: 'S' }),
    ).toThrow();
  });

  it('rejects fractional tokens_consumed (int check)', () => {
    expect(() =>
      TrustScoreResponseSchema.parse({ ...v, tokens_consumed: 1.5 }),
    ).toThrow();
  });

  it('rejects negative tokens_consumed', () => {
    expect(() =>
      TrustScoreResponseSchema.parse({ ...v, tokens_consumed: -1 }),
    ).toThrow();
  });
});

describe('BudgetResponseSchema', () => {
  const v = {
    tenant_id: 'tenant_a',
    plan: 'growth' as const,
    tokens_total: 1000,
    tokens_remaining: 500,
    tokens_reset_at: '2026-01-01T00:00:00Z',
    low_balance: false,
  };

  it('round-trips', () => {
    expect(BudgetResponseSchema.parse(v)).toEqual(v);
  });

  it('rejects unknown plan', () => {
    expect(() => BudgetResponseSchema.parse({ ...v, plan: 'gold' })).toThrow();
  });
});

describe('PublishRequestSchema', () => {
  it('accepts a minimal publish request', () => {
    const v = {
      manifest: {
        name: 'A',
        slug: 'a',
        version: '1.0.0',
        source: 'manual',
        execution_layer: 'api',
      },
    };
    expect(PublishRequestSchema.parse(v)).toEqual(v);
  });

  it('rejects a bad source_url', () => {
    expect(() =>
      PublishRequestSchema.parse({
        manifest: {
          name: 'A',
          slug: 'a',
          version: '1.0.0',
          source: 'manual',
          execution_layer: 'api',
          source_url: 'not-a-url',
        },
      }),
    ).toThrow();
  });
});

describe('PublishResponseSchema', () => {
  it('rejects unknown status', () => {
    expect(() =>
      PublishResponseSchema.parse({
        skill_id: 'sk_1',
        slug: 'a',
        version: '1.0.0',
        status: 'weird',
        published_at: '2026-01-01T00:00:00Z',
        url: 'https://x/skills/a',
      }),
    ).toThrow();
  });

  it.each(['published', 'pending_review', 'rejected'] as const)(
    'accepts status %s',
    (status) => {
      const v = {
        skill_id: 'sk_1',
        slug: 'a',
        version: '1.0.0',
        status,
        published_at: '2026-01-01T00:00:00Z',
        url: 'https://x/skills/a',
      };
      expect(PublishResponseSchema.parse(v)).toEqual(v);
    },
  );
});

describe('TrustScoreDelta + Sync', () => {
  it('TrustScoreDelta round-trips', () => {
    const v = {
      skill_id: 'sk_1',
      trust_score: 0.5,
      trust_tier: 'B' as const,
      scored_at: '2026-01-01T00:00:00Z',
    };
    expect(TrustScoreDeltaSchema.parse(v)).toEqual(v);
  });

  it('TrustScoreSyncResponse round-trips with next_cursor', () => {
    const v = {
      since: '2026-01-01T00:00:00Z',
      until: '2026-01-02T00:00:00Z',
      count: 1,
      deltas: [
        {
          skill_id: 'sk_1',
          trust_score: 0.5,
          trust_tier: 'B' as const,
          scored_at: '2026-01-01T12:00:00Z',
        },
      ],
      next_cursor: '2026-01-01T12:00:00Z',
    };
    expect(TrustScoreSyncResponseSchema.parse(v)).toEqual(v);
  });

  it('TrustScoreSyncResponse round-trips without next_cursor', () => {
    const v = {
      since: '2026-01-01T00:00:00Z',
      until: '2026-01-02T00:00:00Z',
      count: 0,
      deltas: [],
    };
    expect(TrustScoreSyncResponseSchema.parse(v)).toEqual(v);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// UpstreamErrorSchema — full taxonomy
// ──────────────────────────────────────────────────────────────────────────────

const UPSTREAM_CODES = [
  'upstream_not_configured',
  'budget_exhausted',
  'unauthenticated',
  'forbidden',
  'not_found',
  'rate_limited',
  'bad_request',
  'upstream_unavailable',
  'upstream_timeout',
] as const;

describe('UpstreamErrorSchema', () => {
  it.each(UPSTREAM_CODES)('accepts code %s', (code) => {
    const v = { error: { code, message: 'x' } };
    expect(UpstreamErrorSchema.parse(v)).toEqual(v);
  });

  it('rejects a code outside the taxonomy', () => {
    expect(() =>
      UpstreamErrorSchema.parse({
        error: { code: 'kaboom', message: 'x' },
      }),
    ).toThrow();
  });

  it('accepts retry_after and detail as optional fields', () => {
    const v = {
      error: {
        code: 'rate_limited' as const,
        message: 'slow down',
        retry_after: 30,
        detail: { field: 'query' },
      },
      request_id: 'req_1',
    };
    expect(UpstreamErrorSchema.parse(v)).toEqual(v);
  });

  it('rejects a fractional retry_after (int check)', () => {
    expect(() =>
      UpstreamErrorSchema.parse({
        error: {
          code: 'rate_limited' as const,
          message: 'x',
          retry_after: 1.5,
        },
      }),
    ).toThrow();
  });

  it('rejects a non-positive retry_after (positive check)', () => {
    expect(() =>
      UpstreamErrorSchema.parse({
        error: {
          code: 'rate_limited' as const,
          message: 'x',
          retry_after: 0,
        },
      }),
    ).toThrow();
  });
});
