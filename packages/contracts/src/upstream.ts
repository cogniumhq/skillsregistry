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
// Search — POST /v1/search  (per cortex.md §6.2 SkillsRegistry service binding)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Risk appetite. Domain layer maps to a numeric trust threshold + an
 * allowVulnerable flag; when the caller sets `min_trust` / `allow_vulnerable`
 * explicitly, those override the appetite-derived values.
 */
export const AppetiteSchema = z.enum([
  'strict',
  'cautious',
  'balanced',
  'adventurous',
]);
export type Appetite = z.infer<typeof AppetiteSchema>;

/**
 * Visibility bands per cortex.md §16.6. Four-band tenant-scope model
 * (schema migration 0035). `private` is a legacy alias kept for pre-v6.3
 * consumers — new writes should prefer `tenant_private`.
 */
export const SkillVisibilitySchema = z.enum([
  'public',
  'private',
  'tenant_private',
  'tenant_internal',
  'unlisted',
]);
export type SkillVisibility = z.infer<typeof SkillVisibilitySchema>;

/**
 * Search request per cortex.md §6.2:
 *
 *   POST /v1/search  { query, appetite, minTrust, allowVulnerable, tenantId, limit }
 *
 * Fields beyond the cortex minimum (`tags`, `category`, `runtime_env`,
 * `visibility`, `portable`) are the local node's search superset — the
 * mothership treats them as optional filters when set.
 *
 * Wire naming is snake_case for parity with the rest of the upstream API
 * (TrustScoreRequest, BudgetResponse, PublishRequest). Consumers using the
 * domain `FindSkillRequest` (camelCase) map at the route boundary.
 */
export const SearchRequestSchema = z.object({
  /** Free-text query. Required, non-empty. */
  query: z.string().min(1),
  /** Advisory tenant scope. */
  tenant_id: z.string().optional(),
  /** Risk appetite → default trust floor + allowVulnerable default. */
  appetite: AppetiteSchema.optional(),
  /**
   * Hard trust-score floor (0..1). Overrides `appetite` when set.
   * Cortex sends this to gate before the confidence tier is even assessed.
   */
  min_trust: z.number().min(0).max(1).optional(),
  /**
   * Allow skills tagged vulnerable / contains-vulnerable through the filter.
   * Overrides the appetite-derived default when set.
   */
  allow_vulnerable: z.boolean().optional(),
  /** Result cap (1..50). Default 10 at the domain layer. */
  limit: z.number().int().positive().max(50).optional(),
  /** Local-superset filters — mothership treats as optional. */
  tags: z.array(z.string()).optional(),
  category: z.string().optional(),
  runtime_env: z.array(z.string()).optional(),
  visibility: SkillVisibilitySchema.optional(),
  portable: z.boolean().optional(),
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;

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

/**
 * Sandbox contract per `skill-convention.md` v1.3 §9. The runtime (Cortex L3,
 * on any Sandbox-seam adapter — Daytona / Novita / E2B) reads these fields
 * verbatim to provision the execution environment. Applies to any skill with
 * a sandbox surface (`runtime_env` ∈ {vm, agent} today; `api` may declare
 * one if it spawns a subprocess).
 *
 * `image` is the OCI ref — the portability anchor (§9.1). The image family
 * (`skill-base`, `skill-java`, `cognium-scan-base`, `agent-base`) is derived
 * by prefix-matching the ref; not enforced here so the Lane 0 rollout can
 * ship unbuilt images without tripping ingest.
 *
 * `egress` is a default-deny allow-list of hostnames (§9.3). Every host the
 * skill contacts — clone targets, package mirrors, MCP endpoints — must be
 * listed or the sandbox will block the connection.
 *
 * `profile: 'agent'` + `budget_caps` are the agent-runtime extension
 * (§14.2). `budget_caps` are hard caps enforced in-band by the agent skill's
 * wrapper script through llmproxy session metering — the caller cannot rely
 * on Cortex enforcing them at the outer boundary.
 */
export const SkillSandboxSchema = z.object({
  /** OCI ref, e.g. `ghcr.io/cognium-labs/skill-base:1.0.0`. */
  image: z.string().min(1),
  /** Memory allocation in MB. Base default 512 (vm) / 2048 (agent). */
  memory_mb: z.number().int().positive(),
  /** vCPU count. Base default 2 (vm) / 4 (agent). */
  cpu: z.number().int().positive(),
  /** Wall-clock ceiling in seconds. Base default 300 (vm) / 7200 (agent). */
  timeout_seconds: z.number().int().positive(),
  /**
   * Default-deny egress allow-list of hostnames. Empty array = no outbound
   * network from the sandbox. Wildcards are NOT interpreted here — the
   * runtime treats each entry as an exact host match.
   */
  egress: z.array(z.string().min(1)),
  /** Present when `runtime_env: agent`. Signals the agent-runtime shape. */
  profile: z.literal('agent').optional(),
  /**
   * Agent-only hard caps. Enforced in-band by the wrapper script via
   * llmproxy metering (Cortex only enforces the outer wall-clock via
   * provider timeout).
   */
  budget_caps: z
    .object({
      /** Max spend in USD across all LLM calls this run. */
      max_tokens_usd: z.number().positive().optional(),
      /** Max sub-tool invocations from inside the agent sandbox. */
      max_internal_tool_calls: z.number().int().positive().optional(),
      /** Wall-clock ceiling; usually mirrors top-level `timeout_seconds`. */
      max_wall_seconds: z.number().int().positive().optional(),
    })
    .optional(),
});
export type SkillSandbox = z.infer<typeof SkillSandboxSchema>;

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
    /**
     * Sandbox contract per skill-convention v1.3 §9. Required in practice
     * for runtime_env ∈ {vm, agent} (Cortex L3 dispatch reads it directly);
     * kept optional at the schema level so pre-v1.3 rows / api+llm skills
     * don't need to carry it.
     */
    sandbox: SkillSandboxSchema.optional(),
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
 * - `sandbox_contract_violated` — L3 sandbox exited with code 90
 *                                (skill-convention §9.2) — wrong image /
 *                                wrong provider default / preflight failed
 *                                (`git`/`bash`/`ca-certificates` missing).
 *                                Distinct from generic exec failure so
 *                                operators see a named actionable cause.
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
  | 'upstream_timeout'
  | 'sandbox_contract_violated';

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
      'sandbox_contract_violated',
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
