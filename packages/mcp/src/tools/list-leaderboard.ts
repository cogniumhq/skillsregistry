// ══════════════════════════════════════════════════════════════════════════════
// list_leaderboard — five leaderboard projections behind one tool
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

const VALID_KINDS: readonly LeaderboardKind[] = [
  'trust',
  'trending',
  'agents',
  'composed',
  'forked',
];

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
        enum: ['trust', 'trending', 'agents', 'composed', 'forked'],
        description:
          'Which leaderboard to read. trust = human-signal trust ranking; trending = weekly agent invocations; agents = all-time agent invocations; composed = inclusion-in-composition count; forked = human fork count.',
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
