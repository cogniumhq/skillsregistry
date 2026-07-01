// ══════════════════════════════════════════════════════════════════════════════
// Upstream (mothership) API contract types
// ══════════════════════════════════════════════════════════════════════════════
//
// These schemas describe the metered public HTTP API exposed by the mothership
// at `api.skillsregistry.net`. The local node uses them to type its
// `upstream-client.ts`. Every field name is a public contract — bumping any
// of these is a MAJOR version of `@skillsregistry/contracts`.
//
// Schemas here are plain Zod (no `@hono/zod-openapi`) because the local node
// consumes them for validation, not for OpenAPI-doc generation. Mothership
// wraps them where OpenAPI meta is needed.
//
// ══════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';

// ──────────────────────────────────────────────────────────────────────────────
// Trust scoring — POST /v1/trust/score
// ──────────────────────────────────────────────────────────────────────────────

export const TrustScoreRequestSchema = z.object({
  /** Skill identifier — either the mothership UUID or the local node's slug. */
  skill_id: z.string().min(1),
  /**
   * Optional pinned skill manifest. When present, the mothership scores
   * against this snapshot instead of the version it may have indexed.
   */
  manifest: z
    .object({
      name: z.string(),
      version: z.string(),
      source: z.string(),
      description: z.string().optional(),
      skill_md: z.string().optional(),
    })
    .optional(),
  /** Tenant scope hint (advisory in v1; enforced when write tools land). */
  tenant_id: z.string().optional(),
});
export type TrustScoreRequest = z.infer<typeof TrustScoreRequestSchema>;

export const TrustScoreResponseSchema = z.object({
  skill_id: z.string(),
  trust_score: z.number().min(0).max(1),
  trust_tier: z.enum(['A', 'B', 'C', 'D', 'F']),
  trust_breakdown: z.record(z.string(), z.number()),
  scored_at: z.string().datetime(),
  /** Tokens consumed by this call, deducted from the tenant's budget. */
  tokens_consumed: z.number().int().nonnegative(),
});
export type TrustScoreResponse = z.infer<typeof TrustScoreResponseSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// Tenant budget — GET /v1/tenant/budget
// ──────────────────────────────────────────────────────────────────────────────

export const BudgetResponseSchema = z.object({
  tenant_id: z.string(),
  plan: z.enum(['free', 'starter', 'growth', 'enterprise']),
  tokens_total: z.number().int().nonnegative(),
  tokens_remaining: z.number().int().nonnegative(),
  tokens_reset_at: z.string().datetime(),
  /** True when `tokens_remaining` is below 10% of `tokens_total`. */
  low_balance: z.boolean(),
});
export type BudgetResponse = z.infer<typeof BudgetResponseSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// Migration door — POST /v1/publish (local → mothership)
// ──────────────────────────────────────────────────────────────────────────────

export const PublishRequestSchema = z.object({
  /** Skill manifest to promote from local to global registry. */
  manifest: z.object({
    name: z.string().min(1),
    slug: z.string().min(1),
    version: z.string().min(1),
    source: z.string().min(1),
    description: z.string().optional(),
    agent_summary: z.string().optional(),
    tags: z.array(z.string()).optional(),
    category: z.string().optional(),
    schema_json: z.record(z.string(), z.unknown()).optional(),
    install_method: z.record(z.string(), z.unknown()).optional(),
    execution_layer: z.string(),
    skill_md: z.string().optional(),
    source_url: z.string().url().optional(),
    repository_url: z.string().url().optional(),
    mcp_url: z.string().url().optional(),
  }),
  /** Publisher key ID that signs the manifest. Required for A/B tier. */
  publisher_key_id: z.string().optional(),
  /** Detached signature over the canonical manifest bytes. */
  signature: z.string().optional(),
});
export type PublishRequest = z.infer<typeof PublishRequestSchema>;

export const PublishResponseSchema = z.object({
  skill_id: z.string(),
  slug: z.string(),
  version: z.string(),
  status: z.enum(['published', 'pending_review', 'rejected']),
  published_at: z.string().datetime(),
  /** URL of the skill on the mothership. */
  url: z.string().url(),
});
export type PublishResponse = z.infer<typeof PublishResponseSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// Delta sync — GET /v1/sync/trust-scores?since=<ISO>
// ──────────────────────────────────────────────────────────────────────────────

export const TrustScoreDeltaSchema = z.object({
  skill_id: z.string(),
  trust_score: z.number().min(0).max(1),
  trust_tier: z.enum(['A', 'B', 'C', 'D', 'F']),
  scored_at: z.string().datetime(),
});
export type TrustScoreDelta = z.infer<typeof TrustScoreDeltaSchema>;

export const TrustScoreSyncResponseSchema = z.object({
  since: z.string().datetime(),
  until: z.string().datetime(),
  count: z.number().int().nonnegative(),
  deltas: z.array(TrustScoreDeltaSchema),
  /**
   * Cursor for pagination. When present, the client should re-request with
   * `since=<next_cursor>` to continue.
   */
  next_cursor: z.string().datetime().optional(),
});
export type TrustScoreSyncResponse = z.infer<
  typeof TrustScoreSyncResponseSchema
>;

// ──────────────────────────────────────────────────────────────────────────────
// Error taxonomy — every non-2xx upstream response
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Every upstream failure maps to one of these codes. Consumers can pattern-
 * match without parsing HTTP status codes directly.
 *
 * - `upstream_not_configured`  — local node is in air-gap mode
 *   (`MOTHERSHIP_URL` unset).
 * - `budget_exhausted`         — tenant token bucket is empty; retry after
 *                                `retry_after` seconds or upgrade plan.
 * - `unauthenticated`          — API key missing / rejected.
 * - `forbidden`                — API key valid, action not permitted for
 *                                this tenant/plan.
 * - `not_found`                — resource absent on mothership.
 * - `rate_limited`             — per-tenant rate limit hit; `retry_after`
 *                                populated.
 * - `bad_request`              — schema validation failed at mothership.
 * - `upstream_unavailable`     — network / 5xx / circuit-breaker open.
 * - `upstream_timeout`         — request exceeded configured timeout.
 */
export type UpstreamErrorCode =
  | 'upstream_not_configured'
  | 'budget_exhausted'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'bad_request'
  | 'upstream_unavailable'
  | 'upstream_timeout';

export const UpstreamErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      'upstream_not_configured',
      'budget_exhausted',
      'unauthenticated',
      'forbidden',
      'not_found',
      'rate_limited',
      'bad_request',
      'upstream_unavailable',
      'upstream_timeout',
    ]),
    message: z.string(),
    /** Seconds until the caller may safely retry. Absent for permanent errors. */
    retry_after: z.number().int().positive().optional(),
    /** Optional structured detail (upstream field errors, etc.). */
    detail: z.record(z.string(), z.unknown()).optional(),
  }),
  /** Request ID for cross-referencing with mothership logs. */
  request_id: z.string().optional(),
});
export type UpstreamErrorEnvelope = z.infer<typeof UpstreamErrorSchema>;
