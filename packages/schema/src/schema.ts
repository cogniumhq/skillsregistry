// ══════════════════════════════════════════════════════════════════════════════
// Drizzle Schema Definitions
// ══════════════════════════════════════════════════════════════════════════════
//
// Defines database schema for type-safe queries.
//
// Note: The skills table is managed by the broader SkillsRegistry platform.
// This file defines it for type safety, but search service doesn't create it.
//
// ══════════════════════════════════════════════════════════════════════════════

import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  boolean,
  jsonb,
  integer,
  smallint,
  real,
  bigint,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ──────────────────────────────────────────────────────────────────────────────
// Skills Table (Platform-Managed, Defined for Type Safety)
// ──────────────────────────────────────────────────────────────────────────────

export const skills = pgTable(
  'skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    version: text('version').notNull().default('1.0.0'),
    source: text('source').notNull(),
    description: text('description'),
    agentSummary: text('agent_summary'),
    alternateQueries: text('alternate_queries').array(),
    schemaJson: jsonb('schema_json'),
    authRequirements: jsonb('auth_requirements'),
    installMethod: jsonb('install_method'),
    trustScore: numeric('trust_score', { precision: 3, scale: 2 }).default('0.5'),
    capabilitiesRequired: text('capabilities_required').array(),
    executionLayer: text('execution_layer').notNull(),
    contentSafetyPassed: boolean('content_safety_passed').default(true),
    tags: text('tags').array(),
    category: text('category'),
    // Phase 5: Sync pipeline columns
    sourceUrl: text('source_url'),
    sourceHash: text('source_hash'),
    repositoryUrl: text('repository_url'),
    mcpUrl: text('mcp_url'),
    skillMd: text('skill_md'),
    r2BundleKey: text('r2_bundle_key'),
    tenantId: text('tenant_id'),
    cogniumScannedAt: timestamp('cognium_scanned_at'),
    cogniumJobId: text('cognium_job_id'),
    cogniumJobSubmittedAt: timestamp('cognium_job_submitted_at'),
    // Composition & Social layer (v4)
    // Author attribution
    authorId: uuid('author_id'),
    authorType: text('author_type').notNull().default('human'),
    authorBotModel: text('author_bot_model'),
    authorBotPromptHash: text('author_bot_prompt_hash'),
    // v5.0: skill type
    skillType: text('skill_type').notNull().default('atomic'),
    status: text('status').notNull().default('published'),
    // v5.0: status lifecycle tracking
    revokedAt: timestamp('revoked_at'),
    revokedReason: text('revoked_reason'),
    deprecatedAt: timestamp('deprecated_at'),
    deprecatedReason: text('deprecated_reason'),
    remediationMessage: text('remediation_message'),
    remediationUrl: text('remediation_url'),
    // v5.0: version lineage
    forkedFrom: text('forked_from'),
    forkedBy: text('forked_by'),
    forkChanges: jsonb('fork_changes'),
    rootSource: text('root_source'),
    // Metadata
    readme: text('readme'),
    categories: text('categories').array().default(sql`'{}'`),
    ecosystem: text('ecosystem'),
    language: text('language'),
    license: text('license'),
    logoUrl: text('logo_url'),
    homepageUrl: text('homepage_url'),
    demoUrl: text('demo_url'),
    changelog: jsonb('changelog').default([]),
    // Agent quality signals
    avgExecutionTimeMs: real('avg_execution_time_ms'),
    p95ExecutionTimeMs: real('p95_execution_time_ms'),
    errorRate: real('error_rate'),
    agentConsumptionPattern: text('agent_consumption_pattern'),
    schemaCompatibilityScore: real('schema_compatibility_score'),
    replacementSkillId: uuid('replacement_skill_id'),
    adversarialTested: boolean('adversarial_tested').default(false),
    provenanceAttested: boolean('provenance_attested').default(false),
    // Human social counters
    humanStarCount: integer('human_star_count').default(0),
    humanForkCount: integer('human_fork_count').default(0),
    humanCopyCount: integer('human_copy_count').default(0),
    humanUseCount: integer('human_use_count').default(0),
    // Agent counters
    agentInvocationCount: bigint('agent_invocation_count', { mode: 'number' }).default(0),
    agentForkCount: integer('agent_fork_count').default(0),
    compositionInclusionCount: integer('composition_inclusion_count').default(0),
    dependentCount: integer('dependent_count').default(0),
    weeklyAgentInvocationCount: integer('weekly_agent_invocation_count').default(0),
    // Editorial
    featured: boolean('featured').default(false),
    verifiedCreator: boolean('verified_creator').default(false),
    collectionIds: uuid('collection_ids').array().default(sql`'{}'`),
    // v5.0: Cognium attestation
    verificationTier: text('verification_tier').default('unverified'),
    scanCoverage: text('scan_coverage'),
    scanFailureReason: text('scan_failure_reason'),
    cogniumFindings: jsonb('cognium_findings'),
    analyzerSummary: jsonb('analyzer_summary'),
    // v5.0: composition
    compositionSkillIds: uuid('composition_skill_ids').array(),
    // v5.0: trust provenance
    trustBadge: text('trust_badge'),
    humanDistilledBy: text('human_distilled_by'),
    humanDistilledAt: timestamp('human_distilled_at'),
    // v5.0: usage signals (version ranking)
    runCount: integer('run_count').notNull().default(0),
    lastRunAt: timestamp('last_run_at'),
    // Lifecycle
    publishedAt: timestamp('published_at'),
    lastUsedAt: timestamp('last_used_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
    // v5.2: Execution environment + visibility
    runtimeEnv: text('runtime_env').notNull().default('api'),
    visibility: text('visibility').notNull().default('public'),
    environmentVariables: text('environment_variables').array(),
    // v5.3: portable derived flag (generated column — never set manually)
    portable: boolean('portable'),
    // v5.4: DAG workflow definition for composite skills
    workflowDefinition: jsonb('workflow_definition'),
    // v6.2: Agentic sandbox profile (memory, CPU, wall-clock, budget caps, egress).
    // Only populated for runtime_env = 'agent'; enforced by chk_agent_profile_runtime.
    // NOTE: superseded by the top-level `sandbox` column below (migration 0034
    // + skill-convention v1.3 §9). Kept in place per append-only principle;
    // new writes for agent skills should populate BOTH during the transition.
    agentProfile: jsonb('agent_profile'),
    // v6.3 (migration 0034): Top-level sandbox contract per skill-convention v1.3 §9.
    // Applies to ALL runtime_env values with a sandbox surface (vm + agent + api).
    // Shape: { image, memory_mb, cpu, timeout_seconds, egress[],
    //          profile?: 'agent', budget_caps?: { max_tokens_usd, ... } }.
    // Validated at ingest by SkillSandboxSchema in @skillsregistry/contracts.
    sandbox: jsonb('sandbox'),
    // v5.4: Circle-IR extended analysis columns
    qualityScore: real('quality_score'),
    qualityTier: text('quality_tier'),
    qualityResults: jsonb('quality_results'),
    qualityAnalyzedAt: timestamp('quality_analyzed_at'),
    trustScoreV2: real('trust_score_v2'),
    trustTier: text('trust_tier'),
    trustResults: jsonb('trust_results'),
    trustAnalyzedAt: timestamp('trust_analyzed_at'),
    understandResults: jsonb('understand_results'),
    understandAnalyzedAt: timestamp('understand_analyzed_at'),
    specAlignmentScore: real('spec_alignment_score'),
    specGaps: jsonb('spec_gaps'),
    specAnalyzedAt: timestamp('spec_analyzed_at'),
    // L3 (workstream #7): per-endpoint failure records keyed by endpoint name.
    // Populated by analysis-poll-consumer when a poll path gives up without a
    // result; see migration 0028 for the shape.
    analysisFailureReasons: jsonb('analysis_failure_reasons'),
    // D2 (migration 0030): publisher Ed25519 signature columns. NULL on pre-D2
    // rows and on `source != 'publish'` (sync workers). See signature-verifier.ts.
    publisherSignature: text('publisher_signature'),
    publisherKeyId: text('publisher_key_id'),
    signedPayloadHash: text('signed_payload_hash'),
    signedAt: timestamp('signed_at'),
    signatureNonce: text('signature_nonce'),
    signatureVerifiedAt: timestamp('signature_verified_at'),
    signatureFailureReason: text('signature_failure_reason'),
    // T-2.10 (migration 0033): mothership promotion tracking. Populated only
    // when the operator explicitly promotes a local skill via
    // POST /v1/migrate/publish. Rows synced from third-party sources stay NULL.
    mothershipSkillId: text('mothership_skill_id'),
    mothershipPublishStatus: text('mothership_publish_status'),
    mothershipPublishedAt: timestamp('mothership_published_at'),
    mothershipUrl: text('mothership_url'),
  },
  (table) => ({
    trustScoreIdx: index('idx_skills_trust_score').on(table.trustScore),
    sourceIdx: index('idx_skills_source').on(table.source),
    slugIdx: index('idx_skills_slug').on(table.slug),
    executionLayerIdx: index('idx_skills_execution_layer').on(table.executionLayer),
    authorIdIdx: index('idx_skills_author_id').on(table.authorId),
    // v5.0 indexes
    skillTypeIdx: index('idx_skills_skill_type').on(table.skillType),
    statusIdx: index('idx_skills_status').on(table.status),
    verificationTierIdx: index('idx_skills_verification_tier').on(table.verificationTier),
    runCountIdx: index('idx_skills_run_count').on(table.runCount),
    // v5.2 indexes
    runtimeEnvIdx: index('idx_skills_runtime_env').on(table.runtimeEnv),
    visibilityIdx: index('idx_skills_visibility').on(table.visibility),
    slugVersionIdx: index('idx_skills_slug_version').on(table.slug, table.version),
    weeklyAgentIdx: index('idx_skills_weekly_agent').on(table.weeklyAgentInvocationCount),
    humanStarsIdx: index('idx_skills_human_stars').on(table.humanStarCount),
  })
);

// ──────────────────────────────────────────────────────────────────────────────
// Skill Embeddings Table (Search-Managed)
// ──────────────────────────────────────────────────────────────────────────────

export const skillEmbeddings = pgTable(
  'skill_embeddings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id').notNull(),
    // embedding: vector type handled by raw SQL (pgvector extension)
    source: text('source').notNull().default('agent_summary'),
    sourceText: text('source_text').notNull(),
    // tsv: tsvector type handled by raw SQL (generated column)
    // §10 A7: fingerprint of the normalized source text (see text-fingerprint.ts).
    // Paired with embed_model as the idempotent re-embed gate.
    textNormSha256: text('text_norm_sha256'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    skillIdIdx: index('idx_skill_embeddings_skill_id').on(table.skillId),
    tenantIdIdx: index('idx_skill_embeddings_tenant_id').on(table.tenantId),
    // HNSW and GIN indexes created via raw SQL migrations
  })
);

// ──────────────────────────────────────────────────────────────────────────────
// Search Logs Table (Monitoring)
// ──────────────────────────────────────────────────────────────────────────────

export const searchLogs = pgTable(
  'search_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    timestamp: timestamp('timestamp').defaultNow(),

    // Query
    query: text('query').notNull(),
    tenantId: text('tenant_id').notNull(),
    appetite: text('appetite'),

    // Routing
    tier: smallint('tier').notNull(),
    cacheHit: boolean('cache_hit').default(false),

    // Results
    topScore: real('top_score'),
    gapToSecond: real('gap_to_second'),
    clusterDensity: smallint('cluster_density'),
    keywordHits: smallint('keyword_hits'),
    resultCount: smallint('result_count'),
    matchSource: text('match_source'),
    resultSkillIds: text('result_skill_ids').array(),

    // Performance
    totalLatencyMs: real('total_latency_ms'),
    vectorSearchMs: real('vector_search_ms'),
    fullTextSearchMs: real('full_text_search_ms'),
    fusionStrategy: text('fusion_strategy'),

    // LLM usage
    llmInvoked: boolean('llm_invoked').default(false),
    llmLatencyMs: real('llm_latency_ms'),
    llmModel: text('llm_model'),
    llmTokensUsed: integer('llm_tokens_used'),

    // Cost tracking
    embeddingCost: real('embedding_cost').default(0),
    llmCost: real('llm_cost').default(0),

    // Deep search trace
    alternateQueriesUsed: text('alternate_queries_used').array(),
    compositionDetected: boolean('composition_detected').default(false),
    generationHintReturned: boolean('generation_hint_returned').default(false),
  },
  (table) => ({
    timestampIdx: index('idx_search_logs_timestamp').on(table.timestamp),
    tenantIdx: index('idx_search_logs_tenant').on(table.tenantId, table.timestamp),
    tierIdx: index('idx_search_logs_tier').on(table.tier),
    matchSourceIdx: index('idx_search_logs_match_source').on(table.matchSource),
  })
);

// ──────────────────────────────────────────────────────────────────────────────
// Quality Feedback Table (Quality Learning)
// ──────────────────────────────────────────────────────────────────────────────

export const qualityFeedback = pgTable(
  'quality_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    searchEventId: uuid('search_event_id').references(() => searchLogs.id),
    skillId: uuid('skill_id').notNull(),
    feedbackType: text('feedback_type').notNull(),
    position: smallint('position').notNull(),
    timestamp: timestamp('timestamp').defaultNow(),
  },
  (table) => ({
    eventIdx: index('idx_feedback_event').on(table.searchEventId),
    skillIdx: index('idx_feedback_skill').on(table.skillId),
    typeIdx: index('idx_feedback_type').on(table.feedbackType, table.timestamp),
  })
);

// ──────────────────────────────────────────────────────────────────────────────
// Authors Table (Composition & Social Layer)
// ──────────────────────────────────────────────────────────────────────────────

export const authors = pgTable(
  'authors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    handle: text('handle').notNull().unique(),
    displayName: text('display_name'),
    authorType: text('author_type').notNull().default('human'),
    bio: text('bio'),
    avatarUrl: text('avatar_url'),
    homepageUrl: text('homepage_url'),
    botModel: text('bot_model'),
    botOperatorId: uuid('bot_operator_id'),
    totalSkillsPublished: integer('total_skills_published').default(0),
    totalHumanStarsReceived: integer('total_human_stars_received').default(0),
    totalHumanForksReceived: integer('total_human_forks_received').default(0),
    verified: boolean('verified').default(false),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    handleIdx: index('idx_authors_handle').on(table.handle),
    typeIdx: index('idx_authors_type').on(table.authorType),
  })
);

// ──────────────────────────────────────────────────────────────────────────────
// User Stars Table (Human-Only Social Action)
// ──────────────────────────────────────────────────────────────────────────────

export const userStars = pgTable(
  'user_stars',
  {
    userId: uuid('user_id').notNull(),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    pk: uniqueIndex('idx_user_stars_pk').on(table.userId, table.skillId),
    userIdx: index('idx_user_stars_user').on(table.userId),
    skillIdx: index('idx_user_stars_skill').on(table.skillId),
  })
);

// ──────────────────────────────────────────────────────────────────────────────
// Composition Steps Table
// ──────────────────────────────────────────────────────────────────────────────

export const compositionSteps = pgTable(
  'composition_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    compositionId: uuid('composition_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    stepOrder: smallint('step_order').notNull(),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id),
    stepName: text('step_name'),
    inputMapping: jsonb('input_mapping'),
    condition: jsonb('condition'),
    onError: text('on_error').default('fail'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    compositionIdx: index('idx_composition_steps_composition').on(table.compositionId),
    skillIdx: index('idx_composition_steps_skill').on(table.skillId),
    orderUnique: uniqueIndex('idx_composition_steps_order').on(
      table.compositionId,
      table.stepOrder
    ),
  })
);

// ──────────────────────────────────────────────────────────────────────────────
// Skill Invocations Table (Agent Signal Tracking)
// ──────────────────────────────────────────────────────────────────────────────

export const skillInvocations = pgTable(
  'skill_invocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id),
    compositionId: uuid('composition_id').references(() => skills.id),
    tenantId: text('tenant_id').notNull(),
    callerType: text('caller_type').notNull().default('agent'),
    source: text('source').notNull().default('cortex'), // v5.3: 'cortex' | 'local'
    durationMs: integer('duration_ms'),
    succeeded: boolean('succeeded').notNull(),
    invokedAt: timestamp('invoked_at').defaultNow(),
  },
  (table) => ({
    skillIdx: index('idx_invocations_skill').on(table.skillId, table.invokedAt),
    compositionIdx: index('idx_invocations_composition').on(table.compositionId),
    tenantIdx: index('idx_invocations_tenant').on(table.tenantId, table.invokedAt),
  })
);

// ──────────────────────────────────────────────────────────────────────────────
// Publisher Keys Table (D2 — PKI for signed publish)
// ──────────────────────────────────────────────────────────────────────────────

export const publisherKeys = pgTable(
  'publisher_keys',
  {
    keyId: text('key_id').primaryKey(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => authors.id, { onDelete: 'restrict' }),
    algorithm: text('algorithm').notNull().default('ed25519'),
    publicKeyB64Url: text('public_key_b64url').notNull(),
    publicKeyFingerprint: text('public_key_fingerprint').notNull().unique(),
    // Chain — self-FK declared inline via raw column ref; resolved at runtime.
    signedByKeyId: text('signed_by_key_id').notNull(),
    parentSignatureB64Url: text('parent_signature_b64url').notNull(),
    root: boolean('root').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at'),
    revokedAt: timestamp('revoked_at'),
    revocationReason: text('revocation_reason'),
    supersededByKeyId: text('superseded_by_key_id'),
  },
  (table) => ({
    authorIdx: index('idx_publisher_keys_author').on(table.authorId),
    signedByIdx: index('idx_publisher_keys_signed_by').on(table.signedByKeyId),
    // Partial unique index (`WHERE root = TRUE AND revoked_at IS NULL`) is
    // enforced by raw SQL in migration 0029; Drizzle's `uniqueIndex` does
    // not yet model partial predicates, so we declare it for type safety only.
  })
);

// ──────────────────────────────────────────────────────────────────────────────
// Skill Signature Audits Table (D2 — replay defense + observability)
// ──────────────────────────────────────────────────────────────────────────────

export const skillSignatureAudits = pgTable(
  'skill_signature_audits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skillId: uuid('skill_id').references(() => skills.id, { onDelete: 'set null' }),
    keyId: text('key_id').references(() => publisherKeys.keyId, { onDelete: 'set null' }),
    nonce: text('nonce').notNull().unique(),
    verdict: text('verdict').notNull(),
    reasonDetail: text('reason_detail'),
    clientIp: text('client_ip'),
    at: timestamp('at').notNull().defaultNow(),
  },
  (table) => ({
    atIdx: index('idx_signature_audits_at').on(table.at),
    skillIdx: index('idx_signature_audits_skill').on(table.skillId),
    keyIdx: index('idx_signature_audits_key').on(table.keyId),
    verdictIdx: index('idx_signature_audits_verdict').on(table.verdict, table.at),
  })
);

// ──────────────────────────────────────────────────────────────────────────────
// Type Exports
// ──────────────────────────────────────────────────────────────────────────────

export type Skill = typeof skills.$inferSelect;
export type NewSkill = typeof skills.$inferInsert;

export type SkillEmbedding = typeof skillEmbeddings.$inferSelect;
export type NewSkillEmbedding = typeof skillEmbeddings.$inferInsert;

export type SearchLog = typeof searchLogs.$inferSelect;
export type NewSearchLog = typeof searchLogs.$inferInsert;

export type QualityFeedback = typeof qualityFeedback.$inferSelect;
export type NewQualityFeedback = typeof qualityFeedback.$inferInsert;

export type Author = typeof authors.$inferSelect;
export type NewAuthor = typeof authors.$inferInsert;

export type UserStar = typeof userStars.$inferSelect;
export type NewUserStar = typeof userStars.$inferInsert;

export type CompositionStep = typeof compositionSteps.$inferSelect;
export type NewCompositionStep = typeof compositionSteps.$inferInsert;

export type SkillInvocation = typeof skillInvocations.$inferSelect;
export type NewSkillInvocation = typeof skillInvocations.$inferInsert;

export type PublisherKey = typeof publisherKeys.$inferSelect;
export type NewPublisherKey = typeof publisherKeys.$inferInsert;

export type SkillSignatureAudit = typeof skillSignatureAudits.$inferSelect;
export type NewSkillSignatureAudit = typeof skillSignatureAudits.$inferInsert;
