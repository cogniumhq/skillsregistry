// ══════════════════════════════════════════════════════════════════════════════
// search_skills — natural-language skill discovery
// ══════════════════════════════════════════════════════════════════════════════

import type {
  Appetite,
  FindSkillOptions,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from '../types.js';
import { JSONRPC_INVALID_PARAMS, McpError } from '../errors.js';
import {
  asRecord,
  clampLimit,
  optBool,
  optString,
  optStringArray,
  reqString,
} from '../args.js';

async function handler(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const rec = asRecord(args);
  const query = reqString(rec, 'query');

  if (query.length > ctx.config.searchQueryMax) {
    throw new McpError(
      JSONRPC_INVALID_PARAMS,
      `query exceeds maximum length of ${ctx.config.searchQueryMax} characters`,
    );
  }

  const limit = clampLimit(rec, ctx.config.searchDefaultLimit, ctx.config.searchMaxLimit);

  const runtimeEnv = optString(rec, 'runtimeEnv');

  const findOptions: FindSkillOptions = {
    limit,
    appetite: optString(rec, 'appetite') as Appetite | undefined,
    tags: optStringArray(rec, 'tags'),
    category: optString(rec, 'category'),
    runtimeEnv: runtimeEnv ? [runtimeEnv] : undefined,
    visibility: optString(rec, 'visibility') as FindSkillOptions['visibility'],
    portable: optBool(rec, 'portable'),
  };

  const value = await ctx.adapters.search.findSkill(query, ctx.tenantId, findOptions);
  // Search is discovery — don't roll into agent_invocation_count.
  return { value };
}

export const searchSkillsTool: ToolDefinition = {
  name: 'search_skills',
  description:
    'Search the registry for skills matching a natural-language query. Returns confidence-tiered results (T1/T2/T3) with trust signals.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural-language search query.' },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        description: 'Maximum results to return. Defaults to env MCP_SEARCH_DEFAULT_LIMIT.',
      },
      appetite: {
        type: 'string',
        description: 'Optional appetite filter (e.g. "quick", "standard", "deep").',
      },
      tags: { type: 'array', items: { type: 'string' } },
      category: { type: 'string' },
      runtimeEnv: {
        type: 'string',
        description: 'Runtime: "api" | "vm" | "llm" | "agent".',
      },
      visibility: { type: 'string' },
      portable: { type: 'boolean' },
    },
    required: ['query'],
  },
  handler,
};
