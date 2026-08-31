// ══════════════════════════════════════════════════════════════════════════════
// MCP tools registry — v1 read-only surface per mothership design.md §12.
// ══════════════════════════════════════════════════════════════════════════════

import type { ToolDefinition } from '../types.js';
import { searchSkillsTool } from './search-skills.js';
import { getSkillTool } from './get-skill.js';
import { listLeaderboardTool } from './list-leaderboard.js';
import { getTrustBreakdownTool } from './get-trust-breakdown.js';
import { resolveCompositionTool } from './resolve-composition.js';
import { WRITE_TOOLS } from './write-tools.js';

// Read-only base surface — the default. Unchanged when writes are disabled.
export const TOOLS: readonly ToolDefinition[] = [
  searchSkillsTool,
  getSkillTool,
  listLeaderboardTool,
  getTrustBreakdownTool,
  resolveCompositionTool,
];

export const TOOL_BY_NAME: Map<string, ToolDefinition> = new Map(
  TOOLS.map((t) => [t.name, t]),
);

// B0.5 write tools — surfaced by dispatch only when config.writeEnabled. Kept
// in their own map so the read-only lookup path (TOOL_BY_NAME) is untouched.
export { WRITE_TOOLS };
export const WRITE_TOOL_BY_NAME: Map<string, ToolDefinition> = new Map(
  WRITE_TOOLS.map((t) => [t.name, t]),
);

// Tools that resolve to a single specific skill. Only these participate in the
// agent_invocation_count aggregator — search / leaderboard tools are discovery
// and would inflate rankings if rolled in.
export const SKILL_RESOLVING_TOOLS: ReadonlySet<string> = new Set<string>([
  'get_skill',
  'get_trust_breakdown',
  'resolve_composition',
]);

export {
  searchSkillsTool,
  getSkillTool,
  listLeaderboardTool,
  getTrustBreakdownTool,
  resolveCompositionTool,
};
