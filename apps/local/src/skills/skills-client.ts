// ══════════════════════════════════════════════════════════════════════════════
// SkillsClient — local-first skill read + single-tenant publish.
// ══════════════════════════════════════════════════════════════════════════════
//
// Powers two public routes wired in T-2.11b:
//
//   GET  /v1/skills/:id  — local DB first; on miss fall back to
//                          `upstream.getSkill(id)` and write-through cache
//                          the returned row into the local `skills` table
//                          (best-effort). Air-gap mode surfaces
//                          `not_found` for local misses instead of a
//                          confusing `upstream_not_configured` — the local
//                          install *is* the world in air-gap.
//   POST /v1/skills      — publish a local single-tenant skill. Straight
//                          INSERT into `skills` from a `PublishRequest`
//                          manifest; returns the local UUID.
//
// This module owns only the local-first pipeline. Auth / route decoding /
// HTTP status mapping — `routes/public.ts`. Upstream contract + resilience
// — `UpstreamClient`.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { PublishRequest } from '@skillsregistry/contracts';
import type { Pool } from 'pg';
import { UpstreamError } from '../upstream-client/errors.js';
import type { UpstreamClient } from '../upstream-client/index.js';

/**
 * Local alias for the `SkillDetailSchema` shape from
 * `@skillsregistry/contracts`. Kept `Record<string, unknown>` because
 * `SkillDetail` is exported only as a runtime Zod schema (no companion
 * inferred type) and pulling `zod` in here just to `z.infer` it would
 * add a devDep for a single symbol. The shape is enforced by
 * construction — `formatSkillDetail` builds every field the schema
 * declares.
 */
export type SkillDetail = Record<string, unknown>;

/** Matches `PublishToMothershipLogger` — same shape for consistency. */
export interface SkillsClientLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const consoleLogger: SkillsClientLogger = {
  info: (msg, meta) => console.log(`[skills-client] ${msg}`, meta ?? ''),
  warn: (msg, meta) => console.warn(`[skills-client] ${msg}`, meta ?? ''),
  error: (msg, meta) => console.error(`[skills-client] ${msg}`, meta ?? ''),
};

export interface SkillsClientOptions {
  upstream: UpstreamClient;
  pool: Pool;
  logger?: SkillsClientLogger;
}

/**
 * Envelope returned by `getSkill`. `source` tells the handler where the
 * body came from — useful for logging + for later cache-header wiring.
 * Never leaked into the public response body directly (see `public.ts`).
 */
export interface GetSkillResult {
  source: 'local' | 'upstream';
  skill: unknown;
}

/** Shape of `POST /v1/skills` response — mirrors `PublishResultSchema`. */
export interface LocalPublishResult {
  id: string;
  slug: string;
  version: string;
  status: string;
}

/**
 * Row shape read from the local `skills` table. Projection of the
 * columns we surface to `formatSkillDetail`. Everything nullable so a
 * partially-populated write-through row still renders cleanly.
 */
interface SkillRow {
  id: string;
  name: string;
  slug: string;
  version: string;
  source: string;
  description: string | null;
  agent_summary: string | null;
  trust_score: string | null;
  verification_tier: string | null;
  trust_badge: string | null;
  status: string;
  execution_layer: string;
  mcp_url: string | null;
  skill_md: string | null;
  capabilities_required: string[] | null;
  skill_type: string;
  schema_json: unknown;
  source_url: string | null;
  tags: string[] | null;
  category: string | null;
  categories: string[] | null;
  ecosystem: string | null;
  language: string | null;
  license: string | null;
  readme: string | null;
  r2_bundle_key: string | null;
  auth_requirements: unknown;
  install_method: unknown;
  forked_from: string | null;
  run_count: number | null;
  last_run_at: Date | null;
  author_id: string | null;
  author_type: string;
  tenant_id: string | null;
  revoked_reason: string | null;
  remediation_message: string | null;
  remediation_url: string | null;
  replacement_skill_id: string | null;
  avg_execution_time_ms: number | null;
  error_rate: number | null;
  human_star_count: number | null;
  human_fork_count: number | null;
  agent_invocation_count: string | number | null;
  runtime_env: string;
  visibility: string;
  environment_variables: string[] | null;
  cognium_scanned_at: Date | null;
  scan_coverage: string | null;
  content_safety_passed: boolean | null;
  quality_score: number | null;
  quality_tier: string | null;
  quality_results: unknown;
  quality_analyzed_at: Date | null;
  trust_score_v2: number | null;
  trust_tier: string | null;
  trust_results: unknown;
  trust_analyzed_at: Date | null;
  understand_results: unknown;
  understand_analyzed_at: Date | null;
  spec_alignment_score: number | null;
  spec_gaps: unknown;
  spec_analyzed_at: Date | null;
  publisher_key_id: string | null;
  signature_verified_at: Date | null;
  signature_failure_reason: string | null;
  created_at: Date | null;
  updated_at: Date | null;
  published_at: Date | null;
  mothership_skill_id: string | null;
  mothership_url: string | null;
  sandbox: unknown;
}

const SKILL_ROW_COLUMNS = `
  id, name, slug, version, source, description, agent_summary,
  trust_score, verification_tier, trust_badge, status, execution_layer,
  mcp_url, skill_md, capabilities_required, skill_type, schema_json,
  source_url, tags, category, categories, ecosystem, language, license,
  readme, r2_bundle_key, auth_requirements, install_method, forked_from,
  run_count, last_run_at, author_id, author_type, tenant_id,
  revoked_reason, remediation_message, remediation_url, replacement_skill_id,
  avg_execution_time_ms, error_rate, human_star_count, human_fork_count,
  agent_invocation_count, runtime_env, visibility, environment_variables,
  cognium_scanned_at, scan_coverage, content_safety_passed,
  quality_score, quality_tier, quality_results, quality_analyzed_at,
  trust_score_v2, trust_tier, trust_results, trust_analyzed_at,
  understand_results, understand_analyzed_at,
  spec_alignment_score, spec_gaps, spec_analyzed_at,
  publisher_key_id, signature_verified_at, signature_failure_reason,
  created_at, updated_at, published_at,
  mothership_skill_id, mothership_url,
  sandbox
`;

export class SkillsClient {
  private readonly upstream: UpstreamClient;
  private readonly pool: Pool;
  private readonly logger: SkillsClientLogger;

  constructor(options: SkillsClientOptions) {
    this.upstream = options.upstream;
    this.pool = options.pool;
    this.logger = options.logger ?? consoleLogger;
  }

  /**
   * Local-first skill read. Order of resolution:
   *   1. Local hit (id | slug | mothership_skill_id) → format + return.
   *   2. Local miss + upstream configured → `upstream.getSkill(id)` +
   *      write-through cache. Return upstream body verbatim (it already
   *      matches `SkillDetailSchema`).
   *   3. Local miss + air-gap → mint `not_found` (the local install *is*
   *      the world; a stale `upstream_not_configured` would mislead).
   *
   * Every other upstream error propagates unchanged.
   */
  async getSkill(id: string): Promise<GetSkillResult> {
    if (id.trim() === '') {
      throw new UpstreamError('bad_request', 'skill id must be non-empty');
    }

    const row = await this.loadLocal(id);
    if (row !== null) {
      return { source: 'local', skill: formatSkillDetail(row) };
    }

    let upstreamBody: unknown;
    try {
      upstreamBody = await this.upstream.getSkill(id);
    } catch (err) {
      if (
        err instanceof UpstreamError &&
        err.code === 'upstream_not_configured'
      ) {
        throw new UpstreamError(
          'not_found',
          `no local skill with id ${id} (air-gap mode)`,
        );
      }
      throw err;
    }

    // Best-effort write-through — never blocks the response.
    await this.writeThrough(upstreamBody);

    return { source: 'upstream', skill: upstreamBody };
  }

  /**
   * Insert a locally-published single-tenant skill. Returns the local
   * UUID + slug + version + status. Slug collision → `bad_request`.
   */
  async publishLocal(request: PublishRequest): Promise<LocalPublishResult> {
    const { manifest } = request;
    try {
      const result = await this.pool.query<{
        id: string;
        slug: string;
        version: string;
        status: string;
      }>(
        `INSERT INTO skills (
           name, slug, version, source, description, agent_summary,
           tags, category, schema_json, install_method, execution_layer,
           skill_md, source_url, repository_url, mcp_url,
           publisher_key_id, publisher_signature, sandbox, status
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11,
           $12, $13, $14, $15,
           $16, $17, $18, 'published'
         )
         RETURNING id, slug, version, status`,
        [
          manifest.name,
          manifest.slug,
          manifest.version,
          manifest.source,
          manifest.description ?? null,
          manifest.agent_summary ?? null,
          manifest.tags ?? null,
          manifest.category ?? null,
          manifest.schema_json ?? null,
          manifest.install_method ?? null,
          manifest.execution_layer,
          manifest.skill_md ?? null,
          manifest.source_url ?? null,
          manifest.repository_url ?? null,
          manifest.mcp_url ?? null,
          request.publisher_key_id ?? null,
          request.signature ?? null,
          manifest.sandbox ?? null,
        ],
      );
      const row = result.rows[0];
      if (row === undefined) {
        // INSERT with no RETURNING is a pg driver contract violation;
        // treat as internal and surface as a bad_request rather than a
        // silent throw.
        throw new UpstreamError(
          'bad_request',
          'local publish returned no row',
        );
      }
      return row;
    } catch (err) {
      // pg unique_violation (23505) → slug conflict.
      if (isPgUniqueViolation(err)) {
        throw new UpstreamError(
          'bad_request',
          `slug already exists: ${manifest.slug}`,
          { detail: { slug: manifest.slug, constraint: 'unique_violation' } },
        );
      }
      // Not-null / check violations → still bad_request with the pg
      // detail for debuggability. Unknown pg errors bubble as internal.
      if (isPgViolation(err)) {
        throw new UpstreamError(
          'bad_request',
          `publish failed: ${(err as Error).message}`,
          { detail: { pg_code: (err as { code?: string }).code ?? 'unknown' } },
        );
      }
      throw err;
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async loadLocal(id: string): Promise<SkillRow | null> {
    // Match id (UUID column — cast to text so a non-UUID input doesn't
    // 22P02), slug, or a mothership id we've previously cached.
    const result = await this.pool.query<SkillRow>(
      `SELECT ${SKILL_ROW_COLUMNS}
         FROM skills
        WHERE id::text = $1
           OR slug = $1
           OR mothership_skill_id = $1
        LIMIT 1`,
      [id],
    );
    if (result.rowCount === 0) return null;
    return result.rows[0] ?? null;
  }

  private async writeThrough(upstreamBody: unknown): Promise<void> {
    if (upstreamBody === null || typeof upstreamBody !== 'object') return;
    const body = upstreamBody as Record<string, unknown>;
    const slug = typeof body.slug === 'string' ? body.slug : null;
    if (slug === null) {
      // Nothing to key on — skip cache silently.
      return;
    }
    const values: {
      slug: string;
      name: string | null;
      version: string | null;
      source: string | null;
      description: string | null;
      execution_layer: string | null;
      mothership_skill_id: string | null;
      mothership_url: string | null;
      trust_score_v2: number | null;
      trust_tier: string | null;
    } = {
      slug,
      name: typeof body.name === 'string' ? body.name : null,
      version: typeof body.version === 'string' ? body.version : null,
      source: typeof body.source === 'string' ? body.source : null,
      description:
        typeof body.description === 'string' ? body.description : null,
      execution_layer:
        typeof body.executionLayer === 'string' ? body.executionLayer : null,
      mothership_skill_id: typeof body.id === 'string' ? body.id : null,
      mothership_url:
        typeof body.shareUrl === 'string' ? body.shareUrl : null,
      trust_score_v2:
        typeof body.trustScoreV2 === 'number' ? body.trustScoreV2 : null,
      trust_tier: typeof body.trustTier === 'string' ? body.trustTier : null,
    };

    if (
      values.name === null ||
      values.version === null ||
      values.source === null ||
      values.execution_layer === null
    ) {
      // Missing required columns — can't INSERT a valid row. Skip cache.
      this.logger.warn('writeThrough: upstream body missing required fields', {
        slug,
      });
      return;
    }

    try {
      // Idempotent: existing row (by slug) → refresh mothership tracking +
      // trust columns. New row → mint with sensible defaults.
      await this.pool.query(
        `INSERT INTO skills (
           name, slug, version, source, description, execution_layer,
           mothership_skill_id, mothership_url, trust_score_v2, trust_tier,
           status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'published')
         ON CONFLICT (slug) DO UPDATE SET
           mothership_skill_id = EXCLUDED.mothership_skill_id,
           mothership_url      = EXCLUDED.mothership_url,
           trust_score_v2      = EXCLUDED.trust_score_v2,
           trust_tier          = EXCLUDED.trust_tier,
           updated_at          = NOW()`,
        [
          values.name,
          values.slug,
          values.version,
          values.source,
          values.description,
          values.execution_layer,
          values.mothership_skill_id,
          values.mothership_url,
          values.trust_score_v2,
          values.trust_tier,
        ],
      );
    } catch (err) {
      // Cache-miss persistence is not fatal — the upstream body still
      // reaches the caller.
      this.logger.error('writeThrough failed', {
        slug,
        error: (err as Error).message,
      });
    }
  }
}

/**
 * Map a local `skills` row to the mothership's `SkillDetailSchema` shape
 * so callers see one response envelope regardless of the source. Exported
 * for tests.
 */
export function formatSkillDetail(row: SkillRow): SkillDetail {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    version: row.version,
    description: row.description ?? '',
    agentSummary: row.agent_summary,
    trustScore: row.trust_score !== null ? Number(row.trust_score) : 0,
    verificationTier: row.verification_tier ?? 'unverified',
    trustBadge: row.trust_badge,
    status: row.status,
    executionLayer: row.execution_layer,
    mcpUrl: row.mcp_url,
    skillMd: row.skill_md,
    capabilitiesRequired: row.capabilities_required ?? [],
    skillType: row.skill_type,
    schemaJson: row.schema_json ?? null,
    source: row.source,
    sourceUrl: row.source_url,
    tags: row.tags ?? [],
    category: row.category,
    categories: row.categories ?? [],
    ecosystem: row.ecosystem,
    language: row.language,
    license: row.license,
    readme: row.readme,
    r2BundleKey: row.r2_bundle_key,
    authRequirements:
      typeof row.auth_requirements === 'string'
        ? row.auth_requirements
        : row.auth_requirements === null || row.auth_requirements === undefined
          ? null
          : JSON.stringify(row.auth_requirements),
    installMethod:
      typeof row.install_method === 'string'
        ? row.install_method
        : row.install_method === null || row.install_method === undefined
          ? null
          : JSON.stringify(row.install_method),
    forkedFrom: row.forked_from,
    runCount: row.run_count ?? 0,
    lastRunAt: toIso(row.last_run_at),
    authorId: row.author_id,
    authorType: row.author_type,
    tenantId: row.tenant_id,
    revokedReason: row.revoked_reason,
    remediationMessage: row.remediation_message,
    remediationUrl: row.remediation_url,
    replacementSkillId: row.replacement_skill_id,
    replacementSlug: null,
    shareUrl: row.mothership_url ?? `/skills/${row.slug}`,
    avgExecutionTimeMs: row.avg_execution_time_ms,
    errorRate: row.error_rate,
    humanStarCount: row.human_star_count ?? 0,
    humanForkCount: row.human_fork_count ?? 0,
    agentInvocationCount:
      row.agent_invocation_count === null
        ? 0
        : Number(row.agent_invocation_count),
    runtimeEnv: row.runtime_env,
    visibility: row.visibility,
    environmentVariables: row.environment_variables ?? [],
    cogniumScanned: row.cognium_scanned_at !== null,
    cogniumScannedAt: toIso(row.cognium_scanned_at),
    scanCoverage: row.scan_coverage,
    contentSafetyPassed: row.content_safety_passed,
    qualityScore: row.quality_score,
    qualityTier: row.quality_tier,
    qualityResults: row.quality_results ?? null,
    qualityAnalyzedAt: toIso(row.quality_analyzed_at),
    trustScoreV2: row.trust_score_v2,
    trustTier: row.trust_tier,
    trustResults: row.trust_results ?? null,
    trustAnalyzedAt: toIso(row.trust_analyzed_at),
    understandResults: row.understand_results ?? null,
    understandAnalyzedAt: toIso(row.understand_analyzed_at),
    specAlignmentScore: row.spec_alignment_score,
    specGaps: row.spec_gaps ?? null,
    specAnalyzedAt: toIso(row.spec_analyzed_at),
    publisherKeyId: row.publisher_key_id,
    signatureVerifiedAt: toIso(row.signature_verified_at),
    signatureFailureReason: row.signature_failure_reason,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    publishedAt: toIso(row.published_at),
    sandbox: row.sandbox ?? null,
  };
}

function toIso(value: Date | null): string | null {
  if (value === null) return null;
  return value.toISOString();
}

function isPgUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === '23505';
}

function isPgViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  // 23xxx = integrity constraint violations (not_null, check, foreign_key,
  // unique). We already special-cased 23505 above.
  return typeof code === 'string' && code.startsWith('23');
}
