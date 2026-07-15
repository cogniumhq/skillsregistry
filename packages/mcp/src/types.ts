// ══════════════════════════════════════════════════════════════════════════════
// @skillsregistry/mcp — public types
// ══════════════════════════════════════════════════════════════════════════════
//
// This package ships the framework-agnostic MCP (Model Context Protocol) tool
// surface: JSON-RPC 2.0 dispatch, tool schemas, discovery descriptor, and an
// invocation-observability writer. Consumers (mothership Worker, local Node
// app) bind their concrete data-access via the `McpAdapters` bundle at boot;
// the dispatch layer stays runtime-agnostic.
//
// Provenance: verbatim port of mothership `src/mcp/server.ts` +
// `src/mcp/invocation-writer.ts`, refactored to take an adapter bundle
// instead of an `Env` binding.
// ══════════════════════════════════════════════════════════════════════════════

import type {
  Appetite,
  FindSkillResponse,
  SqlPool,
  AfterResponse,
} from '@skillsregistry/domain';
import type { FindSkillOptions } from '@skillsregistry/domain/intelligence';

// ──────────────────────────────────────────────────────────────────────────────
// JSON-RPC 2.0 wire types
// ──────────────────────────────────────────────────────────────────────────────

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcError {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

// ──────────────────────────────────────────────────────────────────────────────
// Tool result envelope
// ──────────────────────────────────────────────────────────────────────────────
//
// Tool handlers may surface a resolved skill id alongside the payload so the
// invocation writer can roll the call into `agent_invocation_count` for skill-
// targeted tools. Tools that don't resolve a single skill omit it.
//
// `isError: true` signals a *tool-level* failure (e.g. slug not found) that
// per MCP 2025-03-26 §tools/call must be reported inside the result envelope
// (`content[]` + `isError: true`), NOT as a JSON-RPC error. Protocol-level
// errors (bad params, unknown tool, parse errors) throw `McpError`.
// ──────────────────────────────────────────────────────────────────────────────

export interface ToolResult {
  value: unknown;
  resolvedSkillId?: string;
  isError?: boolean;
}

export interface ToolContext {
  adapters: McpAdapters;
  config: ResolvedMcpConfig;
  tenantId: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: unknown, ctx: ToolContext) => Promise<ToolResult>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Skill / Composition detail shapes surfaced by lookup adapters.
//
// These match the mothership `getSkillBySlug` / `getCompositionBySlug` result
// envelopes 1:1. Consumers implementing the adapters return this shape; the
// dispatch layer forwards it directly to the tool result payload.
// ──────────────────────────────────────────────────────────────────────────────

export interface SkillDetail {
  id: string;
  name: string;
  slug: string;
  version: string;
  description: string | null;
  agentSummary: string | null;
  trustScore: number;
  verificationTier: string;
  trustBadge: string | null;
  status: string;
  executionLayer: string | null;
  mcpUrl: string | null;
  skillMd: string | null;
  capabilitiesRequired: string[];
  skillType: string;
  schemaJson: unknown;
  source: string;
  sourceUrl: string | null;
  tags: string[];
  category: string | null;
  categories: string[];
  ecosystem: string | null;
  language: string | null;
  license: string | null;
  readme: string | null;
  r2BundleKey: string | null;
  authRequirements: unknown;
  installMethod: string | null;
  forkedFrom: string | null;
  runCount: number;
  lastRunAt: string | null;
  authorId: string | null;
  authorType: string;
  tenantId: string | null;
  revokedReason: string | null;
  remediationMessage: string | null;
  remediationUrl: string | null;
  replacementSkillId: string | null;
  replacementSlug: string | null;
  shareUrl: string;
  avgExecutionTimeMs: number | null;
  errorRate: number | null;
  humanStarCount: number;
  humanForkCount: number;
  agentInvocationCount: number;
  runtimeEnv: string;
  visibility: string;
  environmentVariables: unknown[];
  cogniumScanned: boolean;
  cogniumScannedAt: string | null;
  scanCoverage: unknown;
  contentSafetyPassed: boolean | null;
  qualityScore: number | null;
  qualityTier: string | null;
  qualityResults: unknown;
  qualityAnalyzedAt: string | null;
  trustScoreV2: number | null;
  trustTier: string | null;
  trustResults: unknown;
  trustAnalyzedAt: string | null;
  understandResults: unknown;
  understandAnalyzedAt: string | null;
  specAlignmentScore: number | null;
  specGaps: unknown;
  specAnalyzedAt: string | null;
  publisherKeyId: string | null;
  signatureVerifiedAt: string | null;
  signatureFailureReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  publishedAt: string | null;
}

export type GetSkillResult =
  | { found: true; data: SkillDetail }
  | { found: false };

// Loose composition detail — the tool passes the payload through untouched;
// we only need to observe the `id` field for the invocation writer.
export interface CompositionDetail {
  id: string;
  [key: string]: unknown;
}

export type GetCompositionResult =
  | { found: true; data: CompositionDetail }
  | { found: false };

// ──────────────────────────────────────────────────────────────────────────────
// Leaderboard shapes
// ──────────────────────────────────────────────────────────────────────────────

export type LeaderboardKind = 'trust' | 'trending' | 'agents' | 'composed' | 'forked';

export interface LeaderboardFilters {
  limit: number;
  offset: number;
  skillType?: string;
  category?: string;
  ecosystem?: string;
}

export interface LeaderboardEntry {
  id: string;
  slug: string;
  name: string;
  skillType: string;
  authorHandle: string | null;
  authorType: string;
  score: number;
  trustScore: number;
  humanStarCount?: number;
  humanForkCount?: number;
  agentInvocationCount?: number;
  weeklyAgentInvocationCount?: number;
  compositionInclusionCount?: number;
  avgExecutionTimeMs?: number | null;
  errorRate?: number | null;
  publisherKeyId: string | null;
  signatureVerifiedAt: string | null;
  signatureFailureReason: string | null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Adapter bundle wired by consumers
// ──────────────────────────────────────────────────────────────────────────────
//
// - `search` — findSkill(query, tenantId, options) — the confidence-gated
//   search entry point (mothership routes this through its ConfidenceGate;
//   the local node routes through its equivalent).
// - `getSkillBySlug` — allow-listed skill-detail read. Tenant visibility
//   handled inside the adapter (fail-closed).
// - `getCompositionBySlug` — allow-listed composition-detail read with tenant
//   visibility filter.
// - `getLeaderboard` — single entry point dispatching to the five leaderboard
//   projections keyed by `kind`.
// - `recorder` — optional. Non-blocking observability. When absent the
//   dispatch skips the write.
// - `afterResponse` — `waitUntil`-style post-response scheduler so recorder
//   writes never sit on the request critical path.
// ──────────────────────────────────────────────────────────────────────────────

export interface SearchGatewayPort {
  findSkill(
    query: string,
    tenantId: string,
    options: FindSkillOptions,
  ): Promise<FindSkillResponse>;
}

export interface SkillLookupPort {
  getSkillBySlug(slug: string, tenantId: string): Promise<GetSkillResult>;
}

export interface CompositionLookupPort {
  getCompositionBySlug(
    slug: string,
    tenantId: string,
  ): Promise<GetCompositionResult>;
}

export interface LeaderboardPort {
  getLeaderboard(
    kind: LeaderboardKind,
    filters: LeaderboardFilters,
  ): Promise<LeaderboardEntry[]>;
}

export interface RecordMcpInvocationInput {
  toolName: string;
  tenantId: string;
  skillId: string | null;
  succeeded: boolean;
  durationMs: number;
  errorCode: number | null;
  args: unknown;
}

export interface InvocationRecorderPort {
  record(input: RecordMcpInvocationInput): Promise<void>;
}

/**
 * Optional per-tenant policy gate per cortex.md §16.4 ("two enforcement points,
 * same policy"). Called by dispatch at BOTH edges:
 *
 *   1. `tools/list` — filter the advertised tool set. A tool the caller can't
 *      invoke shouldn't appear in discovery.
 *   2. `tools/call` — re-check before dispatch. LLMs hallucinate tool names;
 *      relying on the list-time filter is not enough.
 *
 * Returning `false` from either call point yields the same behavior the caller
 * would see for an unknown tool: absent from the list, `-32601` on invoke.
 *
 * The v1 single-tenant local install adapter returns `true` for every
 * (tenant, tool) pair — nothing changes. Tenant-scoped registries plug in a
 * real check without dispatcher surgery.
 */
export interface McpPolicyPort {
  /**
   * @param toolName  One of the tool names advertised by `TOOLS`.
   * @param tenantId  From `DispatchContext.tenantId` (advisory `X-Tenant-Id`
   *                  in v1; hard scope once tenant-scoped registries land).
   */
  isToolAllowed(toolName: string, tenantId: string): Promise<boolean>;
}

export interface McpAdapters {
  search: SearchGatewayPort;
  skills: SkillLookupPort;
  compositions: CompositionLookupPort;
  leaderboards: LeaderboardPort;
  recorder?: InvocationRecorderPort;
  afterResponse?: AfterResponse;
  /**
   * Optional. Omit → allow-all (v1 posture). See `McpPolicyPort` for the
   * two enforcement points the dispatcher wires it into.
   */
  policy?: McpPolicyPort;
}

// ──────────────────────────────────────────────────────────────────────────────
// Config bag — every env-configurable knob in mothership becomes a typed
// option here. Consumers pass their env-parsed values in at boot; the dispatch
// layer applies documented defaults for absent fields.
// ──────────────────────────────────────────────────────────────────────────────

export interface McpConfig {
  /** Server name emitted in `initialize` and the discovery descriptor. */
  serverName?: string;
  /** Server version emitted in `initialize` and the discovery descriptor. */
  serverVersion?: string;
  /** Canonical origin for discovery descriptor URLs (env: MCP_CANONICAL_ORIGIN). */
  canonicalOrigin?: string;
  /** Documentation URL surfaced in the discovery descriptor. Defaults to `${origin}/docs`. */
  documentationUrl?: string;
  /** OpenAPI URL surfaced in the discovery descriptor. Defaults to `${origin}/openapi.json`. */
  openapiUrl?: string;

  /** MCP_SEARCH_DEFAULT_LIMIT (default 10). */
  searchDefaultLimit?: number;
  /** MCP_SEARCH_MAX_LIMIT (default 50). */
  searchMaxLimit?: number;
  /** MCP_SEARCH_QUERY_MAX (default 500). */
  searchQueryMax?: number;

  /** MCP_LEADERBOARD_DEFAULT_LIMIT (default 20). */
  leaderboardDefaultLimit?: number;
  /** MCP_LEADERBOARD_MAX_LIMIT (default 100). */
  leaderboardMaxLimit?: number;

  /** MCP_BATCH_MAX (default 20). */
  batchMax?: number;
}

export interface ResolvedMcpConfig {
  serverName: string;
  serverVersion: string;
  canonicalOrigin: string | undefined;
  documentationUrl: string | undefined;
  openapiUrl: string | undefined;
  searchDefaultLimit: number;
  searchMaxLimit: number;
  searchQueryMax: number;
  leaderboardDefaultLimit: number;
  leaderboardMaxLimit: number;
  batchMax: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Re-exports for consumer convenience
// ──────────────────────────────────────────────────────────────────────────────

export type { Appetite, FindSkillOptions, FindSkillResponse, SqlPool, AfterResponse };
