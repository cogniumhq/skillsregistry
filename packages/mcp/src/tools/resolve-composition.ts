// ══════════════════════════════════════════════════════════════════════════════
// resolve_composition — expand a composition slug into its step graph
// ══════════════════════════════════════════════════════════════════════════════

import type { ToolContext, ToolDefinition, ToolResult } from '../types.js';
import { asRecord, reqString } from '../args.js';

async function handler(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const rec = asRecord(args);
  const slug = reqString(rec, 'slug');

  const result = await ctx.adapters.compositions.getCompositionBySlug(slug, ctx.tenantId);
  if (!result.found) {
    return { value: { error: 'Composition not found', slug }, isError: true };
  }
  const skillId = typeof result.data.id === 'string' ? result.data.id : undefined;
  return { value: result.data, resolvedSkillId: skillId };
}

export const resolveCompositionTool: ToolDefinition = {
  name: 'resolve_composition',
  description:
    'Resolve a composition slug into its constituent skills with lineage + cascade trust impact.',
  inputSchema: {
    type: 'object',
    properties: {
      slug: { type: 'string', description: 'Composition slug.' },
    },
    required: ['slug'],
  },
  handler,
};
