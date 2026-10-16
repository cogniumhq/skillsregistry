// ══════════════════════════════════════════════════════════════════════════════
// list_leaderboard — trust and agent leaderboard projections
// ══════════════════════════════════════════════════════════════════════════════

import type {
  LeaderboardFilters,
  LeaderboardKind,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from '../types.js';
import { JSONRPC_INVALID_PARAMS, McpError } from '../errors.js';
import { asRecord, clampLimit, optString, reqString } from '../args.js';

const VALID_KINDS: readonly LeaderboardKind[] = ['trust', 'agents'];

async function handler(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const rec = asRecord(args);
  const kind = reqString(rec, 'kind') as LeaderboardKind;
  if (!VALID_KINDS.includes(kind)) {
    throw new McpError(
      JSONRPC_INVALID_PARAMS,
      `Unknown leaderboard kind: '${kind}'. Expected one of: ${VALID_KINDS.join(', ')}.`,
    );
  }

  const limit = clampLimit(
    rec,
    ctx.config.leaderboardDefaultLimit,
    ctx.config.leaderboardMaxLimit,
  );

  const filters: LeaderboardFilters = {
    limit,
    offset: 0,
    skillType: optString(rec, 'skillType'),
    category: optString(rec, 'category'),
    ecosystem: optString(rec, 'ecosystem'),
  };

  const value = await ctx.adapters.leaderboards.getLeaderboard(kind, filters);
  // Leaderboards are discovery, not skill resolution — do not stamp resolvedSkillId.
  return { value };
}

export const listLeaderboardTool: ToolDefinition = {
  name: 'list_leaderboard',
  description:
    'List the top-N skills for a given leaderboard kind. Human and agent signal channels stay separate.',
  inputSchema: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        enum: ['trust', 'agents'],
        description:
          'Which leaderboard to read. trust = ranked by trust score; agents = ranked by MCP agent invocations. trending, composed, and forked are not available via MCP (no usage signal collected yet).',
      },
      limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Result cap.' },
      skillType: { type: 'string', description: 'Filter to a single skill_type.' },
      category: { type: 'string', description: 'Filter to a single category.' },
      ecosystem: { type: 'string', description: 'Filter to a single ecosystem.' },
    },
    required: ['kind'],
  },
  handler,
};
