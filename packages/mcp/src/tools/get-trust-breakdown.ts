// ══════════════════════════════════════════════════════════════════════════════
// get_trust_breakdown — trust slice of a skill (6 dims, tier, verdicts)
// ══════════════════════════════════════════════════════════════════════════════
//
// Keeps the human + agent signal channels *separate* per design.md §4 —
// surfaces both as adjacent fields, never fused into a composite.
//
// The tool description previously advertised "7-dimension scores, A/B/C/D/F
// tier" and the handler returned neither — only the raw `trustResults` blob.
// An agent reading that description had no way to reconcile what it got back.
// Both are corrected here: the grouping is SIX dimensions (security / supply /
// quality / reliability / compliance / provenance) and `tier` is the Circle-IR
// enum (VERIFIED / PASSING / ADVISORY / FAILING / BLOCKED). No letter grade
// exists anywhere in this system.
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
    // The derived per-dimension view. Adapters that predate the field return
    // undefined; normalize to null so the wire shape is stable and an agent
    // can branch on one value rather than two.
    trustBreakdown: d.trustBreakdown ?? null,
    // Raw pass-level results retained alongside — the breakdown is additive,
    // and a caller auditing a specific finding still needs the detail.
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
    'Return the trust slice of a skill: `trustBreakdown` groups Circle-IR analyzer ' +
    'passes into six 0-100 dimensions (security, supply, quality, reliability, ' +
    'compliance, provenance) with an overall score and the Circle-IR tier ' +
    '(VERIFIED / PASSING / ADVISORY / FAILING / BLOCKED). Null when the skill has ' +
    'no pass-level scan results, which is most of the catalog. Also returns the raw ' +
    'trustResults, content-safety verdict, quality + spec-alignment scores, and the ' +
    'human and agent signal counts as separate fields (never fused).',
  inputSchema: {
    type: 'object',
    properties: {
      slug: { type: 'string', description: 'Skill slug.' },
    },
    required: ['slug'],
  },
  handler,
};
