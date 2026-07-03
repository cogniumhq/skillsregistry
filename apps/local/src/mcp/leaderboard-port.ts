// ══════════════════════════════════════════════════════════════════════════════
// McpLeaderboardPort — adapter binding `@skillsregistry/mcp` leaderboard port
// to the mothership proxy.
// ══════════════════════════════════════════════════════════════════════════════
//
// Leaderboards live on the mothership — human-signal and agent-signal ranks
// are aggregated across every tenant that touches the public catalog. There
// is no local index today, so the port delegates every call through
// `UpstreamClient.getLeaderboard(kind, params)`.
//
// Air-gap handling: `upstream_not_configured` errors are collapsed into an
// empty `[]` so MCP clients get a truthful "no rankings available" instead
// of a confusing JSON-RPC error. Every other UpstreamError propagates —
// budget-exhausted, rate-limited, network — so agents can react.
//
// Mothership response shape: `{ leaderboard: LeaderboardEntry[] }`
// (`LeaderboardResponseSchema` in `@skillsregistry/contracts`). The port
// unwraps the outer envelope; the tool passes the array through to the
// JSON-RPC result verbatim.
//
// ══════════════════════════════════════════════════════════════════════════════

import type {
  LeaderboardEntry,
  LeaderboardFilters,
  LeaderboardKind,
  LeaderboardPort,
} from '@skillsregistry/mcp';
import { UpstreamError } from '../upstream-client/errors.js';
import type { UpstreamClient } from '../upstream-client/index.js';

export interface McpLeaderboardPortOptions {
  upstream: UpstreamClient;
}

export class McpLeaderboardProxy implements LeaderboardPort {
  private readonly upstream: UpstreamClient;

  constructor(opts: McpLeaderboardPortOptions) {
    this.upstream = opts.upstream;
  }

  async getLeaderboard(
    kind: LeaderboardKind,
    filters: LeaderboardFilters,
  ): Promise<LeaderboardEntry[]> {
    const params: Record<string, string | number | undefined> = {
      limit: filters.limit,
    };
    if (filters.offset > 0) params.offset = filters.offset;
    if (filters.skillType !== undefined) params.skill_type = filters.skillType;
    if (filters.category !== undefined) params.category = filters.category;
    if (filters.ecosystem !== undefined) params.ecosystem = filters.ecosystem;

    let body: unknown;
    try {
      body = await this.upstream.getLeaderboard(kind, params);
    } catch (err) {
      if (err instanceof UpstreamError && err.code === 'upstream_not_configured') {
        // Air-gap: no local leaderboard index in MVP — return empty rather
        // than leaking the air-gap posture as an MCP tool error.
        return [];
      }
      throw err;
    }

    return unwrapEntries(body);
  }
}

function unwrapEntries(body: unknown): LeaderboardEntry[] {
  if (body === null || typeof body !== 'object') return [];
  const envelope = body as { leaderboard?: unknown };
  if (!Array.isArray(envelope.leaderboard)) return [];
  // Row shape is enforced by mothership Zod validation on the upstream
  // side. Cast is a runtime no-op; downstream consumers treat this as
  // the mothership's declared LeaderboardEntry.
  return envelope.leaderboard as LeaderboardEntry[];
}
