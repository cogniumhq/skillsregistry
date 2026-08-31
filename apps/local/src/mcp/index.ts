// ══════════════════════════════════════════════════════════════════════════════
// MCP adapter bundle — wiring `@skillsregistry/mcp` ports to local services.
// ══════════════════════════════════════════════════════════════════════════════
//
// `@skillsregistry/mcp` ships a framework-agnostic JSON-RPC 2.0 dispatch
// core over an `McpAdapters` bundle. Every consumer (mothership, local
// node) plugs their own data-access implementations in at boot. This
// module builds the bundle for the local node:
//
//   - search        → McpSearchGateway (wraps ConfidenceGate)
//   - skills        → McpSkillLookup (wraps SkillsClient)
//   - compositions  → McpCompositionLookup (always { found: false } in MVP)
//   - leaderboards  → McpLeaderboardProxy (delegates to mothership)
//   - recorder      → createSqlPoolInvocationRecorder({ pool })
//   - afterResponse → NodeAfterResponse (shared with T-2.11c search)
//
// The recorder writes to `mcp_invocations` (migration 0025) + bumps
// `agent_invocation_count` on `skills` for skill-resolving tools; the
// dispatch layer wraps every write in `afterResponse.run(...)` so the
// observability path never sits on the request critical path.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { Pool } from 'pg';
import {
  createSqlPoolInvocationRecorder,
  type McpAdapters,
} from '@skillsregistry/mcp';
import type { NodeAfterResponse } from '../adapters/index.js';
import type { ConfidenceGate } from '@skillsregistry/domain/intelligence';
import type { SkillsClient } from '../skills/index.js';
import type { UpstreamClient } from '../upstream-client/index.js';
import { McpCompositionLookup } from './composition-lookup.js';
import { McpLeaderboardProxy } from './leaderboard-port.js';
import { McpSearchGateway } from './search-gateway.js';
import { McpSkillLookup } from './skill-lookup.js';
import { McpWritePort } from './write-port.js';

export { McpSearchGateway } from './search-gateway.js';
export { McpSkillLookup } from './skill-lookup.js';
export { McpCompositionLookup } from './composition-lookup.js';
export { McpLeaderboardProxy } from './leaderboard-port.js';
export { McpWritePort } from './write-port.js';

export interface BuildMcpAdaptersOptions {
  gate: ConfidenceGate;
  skillsClient: SkillsClient;
  upstream: UpstreamClient;
  afterResponse: NodeAfterResponse;
  pool: Pool;
  /**
   * Max serialized-args length (chars) written to `mcp_invocations.args`.
   * Env: `MCP_INVOCATION_ARGS_MAX`. Default 4096 inside the writer.
   */
  invocationArgsMaxChars?: number;
  /**
   * B0.5 — when true, wire the WritePort so publish_skill/revise_skill/
   * list_my_skills dispatch. Env: `MCP_WRITE_ENABLED` (default false).
   * Must be paired with config.writeEnabled on the resolved MCP config.
   */
  writeEnabled?: boolean;
}

/**
 * Build the McpAdapters bundle. Called once at boot by `buildAppServices`.
 * Pure — no side effects beyond constructing the adapter instances.
 */
export function buildMcpAdapters(opts: BuildMcpAdaptersOptions): McpAdapters {
  const recorder = createSqlPoolInvocationRecorder({
    pool: opts.pool,
    ...(opts.invocationArgsMaxChars !== undefined && {
      argsMaxChars: opts.invocationArgsMaxChars,
    }),
  });
  return {
    search: new McpSearchGateway({
      gate: opts.gate,
      afterResponse: opts.afterResponse,
    }),
    skills: new McpSkillLookup({ skillsClient: opts.skillsClient }),
    compositions: new McpCompositionLookup(),
    leaderboards: new McpLeaderboardProxy({ upstream: opts.upstream }),
    recorder,
    afterResponse: opts.afterResponse,
    // B0.5 — WritePort only when writes are enabled; omitted → read-only.
    ...(opts.writeEnabled
      ? { writes: new McpWritePort({ skillsClient: opts.skillsClient, pool: opts.pool }) }
      : {}),
  };
}
