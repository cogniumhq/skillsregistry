// ══════════════════════════════════════════════════════════════════════════════
// get_skill — single skill lookup by slug
// ══════════════════════════════════════════════════════════════════════════════

import type { ToolContext, ToolDefinition, ToolResult } from '../types.js';
import { asRecord, optString, reqString } from '../args.js';

async function handler(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const rec = asRecord(args);
  const slug = reqString(rec, 'slug');
  // `version` is reserved for future version-pinned lookups; current
  // getSkillBySlug returns the latest. Validate the shape now so the tool
  // surface stays stable.
  optString(rec, 'version');

  const result = await ctx.adapters.skills.getSkillBySlug(slug, ctx.tenantId);
  if (!result.found) {
    return { value: { error: 'Skill not found', slug }, isError: true };
  }
  const skillId = typeof result.data.id === 'string' ? result.data.id : undefined;
  return { value: result.data, resolvedSkillId: skillId };
}

export const getSkillTool: ToolDefinition = {
  name: 'get_skill',
  description: 'Fetch a single skill record by slug, including manifest + trust breakdown.',
  inputSchema: {
    type: 'object',
    properties: {
      slug: { type: 'string', description: 'Skill slug, e.g. "anthropic-claude-code".' },
      version: { type: 'string', description: 'Optional version pin. Defaults to latest.' },
    },
    required: ['slug'],
  },
  handler,
};
