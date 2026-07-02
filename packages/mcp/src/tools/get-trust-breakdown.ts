// ══════════════════════════════════════════════════════════════════════════════
// get_trust_breakdown — trust slice of a skill (7 dims, tier, findings)
// ══════════════════════════════════════════════════════════════════════════════
//
// Keeps the human + agent signal channels *separate* per design.md §4 —
// surfaces both as adjacent fields, never fused into a composite.
// ══════════════════════════════════════════════════════════════════════════════

import type { ToolContext, ToolDefinition, ToolResult } from '../types.js';
import { asRecord, reqString } from '../args.js';

async function handler(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const rec = asRecord(args);
  const slug = reqString(rec, 'slug');

  const result = await ctx.adapters.skills.getSkillBySlug(slug, ctx.tenantId);
  if (!result.found) {
    return { value: { error: 'Skill not found', slug }, isError: true };
  }
  const d = result.data;
  const skillId = typeof d.id === 'string' ? d.id : undefined;
  const value = {
    id: d.id,
    slug: d.slug,
    version: d.version,
    trustScore: d.trustScore,
    verificationTier: d.verificationTier,
    trustBadge: d.trustBadge,
    trustScoreV2: d.trustScoreV2,
    trustTier: d.trustTier,
    trustResults: d.trustResults,
    trustAnalyzedAt: d.trustAnalyzedAt,
    qualityScore: d.qualityScore,
    qualityTier: d.qualityTier,
    qualityAnalyzedAt: d.qualityAnalyzedAt,
    cogniumScanned: d.cogniumScanned,
    cogniumScannedAt: d.cogniumScannedAt,
    scanCoverage: d.scanCoverage,
    contentSafetyPassed: d.contentSafetyPassed,
    specAlignmentScore: d.specAlignmentScore,
    specGaps: d.specGaps,
    // Human + agent signals — surfaced as separate fields, never fused.
    humanStarCount: d.humanStarCount,
    humanForkCount: d.humanForkCount,
    agentInvocationCount: d.agentInvocationCount,
    status: d.status,
    revokedReason: d.revokedReason,
    remediationMessage: d.remediationMessage,
    remediationUrl: d.remediationUrl,
    replacementSlug: d.replacementSlug,
  };
  return { value, resolvedSkillId: skillId };
}

export const getTrustBreakdownTool: ToolDefinition = {
  name: 'get_trust_breakdown',
  description:
    'Return the trust slice of a skill: 7-dimension scores, A/B/C/D/F tier, findings count, content-safety verdict.',
  inputSchema: {
    type: 'object',
    properties: {
      slug: { type: 'string', description: 'Skill slug.' },
    },
    required: ['slug'],
  },
  handler,
};
