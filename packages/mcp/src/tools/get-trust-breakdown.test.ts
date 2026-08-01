// ══════════════════════════════════════════════════════════════════════════════
// get_trust_breakdown — trust slice of a skill
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import { getTrustBreakdownTool } from './get-trust-breakdown.js';
import { McpError } from '../errors.js';
import type {
  GetSkillResult,
  McpAdapters,
  ResolvedMcpConfig,
  SkillLookupPort,
  ToolContext,
} from '../types.js';

// ──────────────────────────────────────────────────────────────────────────────
// Doubles
// ──────────────────────────────────────────────────────────────────────────────

function stubLookup(result: GetSkillResult) {
  const skills: SkillLookupPort = {
    getSkillBySlug: vi.fn(async () => result),
  };
  return { skills };
}

const CONFIG: ResolvedMcpConfig = {
  serverName: 'sr',
  serverVersion: '1.0.0',
  canonicalOrigin: undefined,
  documentationUrl: undefined,
  openapiUrl: undefined,
  searchDefaultLimit: 10,
  searchMaxLimit: 50,
  searchQueryMax: 500,
  leaderboardDefaultLimit: 20,
  leaderboardMaxLimit: 100,
  batchMax: 20,
};

function makeCtx(skills: SkillLookupPort): ToolContext {
  const adapters: Partial<McpAdapters> = { skills };
  return {
    adapters: adapters as McpAdapters,
    config: CONFIG,
    tenantId: 'tenant_a',
  };
}

// A skill row with distinctly-valued trust fields + noise fields we expect
// to be stripped by the trust-only allowlist.
const FULL_SKILL = {
  id: 'sk_trust',
  name: 'Trust Skill',
  slug: 'trust-skill',
  version: '2.0.0',
  description: 'ignored',
  agentSummary: 'ignored',
  trustScore: 0.87,
  verificationTier: 'verified',
  trustBadge: 'green',
  status: 'published',
  executionLayer: 'api',
  mcpUrl: 'ignored',
  skillMd: 'ignored',
  capabilitiesRequired: ['ignored'],
  skillType: 'atomic',
  schemaJson: {},
  source: 'manual',
  sourceUrl: null,
  tags: ['x'],
  category: null,
  categories: [],
  ecosystem: null,
  language: null,
  license: null,
  readme: null,
  r2BundleKey: null,
  authRequirements: null,
  installMethod: null,
  forkedFrom: null,
  runCount: 5,
  lastRunAt: null,
  authorId: null,
  authorType: 'human',
  tenantId: null,
  revokedReason: 'stale',
  remediationMessage: 'update to v3',
  remediationUrl: 'https://example.com/rem',
  replacementSkillId: 'sk_new',
  replacementSlug: 'trust-skill-v3',
  shareUrl: 'https://x/skills/trust-skill',
  avgExecutionTimeMs: 42,
  errorRate: 0.01,
  humanStarCount: 3,
  humanForkCount: 1,
  agentInvocationCount: 100,
  runtimeEnv: 'api',
  visibility: 'public',
  environmentVariables: [],
  cogniumScanned: true,
  cogniumScannedAt: '2026-01-01T00:00:00Z',
  scanCoverage: { a: 1 },
  contentSafetyPassed: true,
  qualityScore: 0.9,
  qualityTier: 'A',
  qualityResults: { pass: true },
  qualityAnalyzedAt: '2026-01-02T00:00:00Z',
  trustScoreV2: 0.88,
  trustTier: 'A',
  trustResults: { findings: [] },
  trustBreakdown: {
    overall: 84,
    tier: 'BLOCKED',
    dims: { security: 63, supply: 96, quality: 95, reliability: 74, compliance: 87, provenance: 100 },
    passCount: 27,
  },
  trustAnalyzedAt: '2026-01-03T00:00:00Z',
  understandResults: 'ignored',
  understandAnalyzedAt: 'ignored',
  specAlignmentScore: 0.75,
  specGaps: [{ path: 'y' }],
  specAnalyzedAt: 'ignored',
  publisherKeyId: 'ignored',
  signatureVerifiedAt: 'ignored',
  signatureFailureReason: 'ignored',
  createdAt: 'ignored',
  updatedAt: 'ignored',
  publishedAt: 'ignored',
};

// ──────────────────────────────────────────────────────────────────────────────

describe('get_trust_breakdown — arg validation', () => {
  it('throws when slug missing', async () => {
    const { skills } = stubLookup({ found: false });
    await expect(
      getTrustBreakdownTool.handler({}, makeCtx(skills)),
    ).rejects.toThrow(McpError);
  });

  it('throws when args is not an object', async () => {
    const { skills } = stubLookup({ found: false });
    await expect(
      getTrustBreakdownTool.handler(null, makeCtx(skills)),
    ).rejects.toThrow(McpError);
  });
});

describe('get_trust_breakdown — envelope', () => {
  it('returns not-found envelope with isError: true', async () => {
    const { skills } = stubLookup({ found: false });
    const out = await getTrustBreakdownTool.handler(
      { slug: 'missing' },
      makeCtx(skills),
    );
    expect(out.isError).toBe(true);
    expect(out.value).toEqual({
      error: 'Skill not found',
      slug: 'missing',
    });
  });

  it('projects trust-only allowlist (~28 fields) + stamps resolvedSkillId', async () => {
    const { skills } = stubLookup({ found: true, data: FULL_SKILL });
    const out = await getTrustBreakdownTool.handler(
      { slug: 'trust-skill' },
      makeCtx(skills),
    );
    expect(out.resolvedSkillId).toBe('sk_trust');
    const v = out.value as Record<string, unknown>;
    // Identifiers (kept)
    expect(v.id).toBe('sk_trust');
    expect(v.slug).toBe('trust-skill');
    expect(v.version).toBe('2.0.0');
    // Trust dims (kept)
    expect(v.trustScore).toBe(0.87);
    expect(v.trustScoreV2).toBe(0.88);
    expect(v.trustTier).toBe('A');
    expect(v.trustBadge).toBe('green');
    expect(v.verificationTier).toBe('verified');
    expect(v.trustResults).toEqual({ findings: [] });
    expect(v.trustAnalyzedAt).toBe('2026-01-03T00:00:00Z');
    // Quality (kept)
    expect(v.qualityScore).toBe(0.9);
    expect(v.qualityTier).toBe('A');
    expect(v.qualityAnalyzedAt).toBe('2026-01-02T00:00:00Z');
    // Scan (kept)
    expect(v.cogniumScanned).toBe(true);
    expect(v.cogniumScannedAt).toBe('2026-01-01T00:00:00Z');
    expect(v.scanCoverage).toEqual({ a: 1 });
    expect(v.contentSafetyPassed).toBe(true);
    // Spec (kept)
    expect(v.specAlignmentScore).toBe(0.75);
    expect(v.specGaps).toEqual([{ path: 'y' }]);
    // Human + agent signals (kept, separate)
    expect(v.humanStarCount).toBe(3);
    expect(v.humanForkCount).toBe(1);
    expect(v.agentInvocationCount).toBe(100);
    // Lifecycle + remediation (kept)
    expect(v.status).toBe('published');
    expect(v.revokedReason).toBe('stale');
    expect(v.remediationMessage).toBe('update to v3');
    expect(v.remediationUrl).toBe('https://example.com/rem');
    expect(v.replacementSlug).toBe('trust-skill-v3');
  });

  it('strips non-trust fields from SkillDetail', async () => {
    const { skills } = stubLookup({ found: true, data: FULL_SKILL });
    const out = await getTrustBreakdownTool.handler(
      { slug: 'trust-skill' },
      makeCtx(skills),
    );
    const v = out.value as Record<string, unknown>;
    // The following are all present on SkillDetail but should NOT leak through
    // the trust-only projection.
    expect(v.description).toBeUndefined();
    expect(v.agentSummary).toBeUndefined();
    expect(v.skillMd).toBeUndefined();
    expect(v.readme).toBeUndefined();
    expect(v.tags).toBeUndefined();
    expect(v.capabilitiesRequired).toBeUndefined();
    expect(v.executionLayer).toBeUndefined();
    expect(v.mcpUrl).toBeUndefined();
    expect(v.avgExecutionTimeMs).toBeUndefined();
    expect(v.errorRate).toBeUndefined();
    expect(v.shareUrl).toBeUndefined();
    expect(v.runCount).toBeUndefined();
    expect(v.publisherKeyId).toBeUndefined();
    expect(v.signatureVerifiedAt).toBeUndefined();
    expect(v.understandResults).toBeUndefined();
  });

  it('omits resolvedSkillId when data.id is non-string', async () => {
    const { skills } = stubLookup({
      found: true,
      data: { ...FULL_SKILL, id: null as unknown as string },
    });
    const out = await getTrustBreakdownTool.handler(
      { slug: 'x' },
      makeCtx(skills),
    );
    expect(out.resolvedSkillId).toBeUndefined();
  });
});

describe('get_trust_breakdown — metadata', () => {
  it('advertises required slug and known name', () => {
    expect(getTrustBreakdownTool.name).toBe('get_trust_breakdown');
    const schema = getTrustBreakdownTool.inputSchema as { required: string[] };
    expect(schema.required).toEqual(['slug']);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// D3a — the tool's description used to promise "7-dimension scores, A/B/C/D/F
// tier" while the handler returned neither. These pin the corrected contract:
// the derived breakdown is passed through, and the description describes it.
// ──────────────────────────────────────────────────────────────────────────────

describe('get_trust_breakdown — derived breakdown (D3a)', () => {
  it('passes trustBreakdown through from the adapter', async () => {
    const { skills } = stubLookup({ found: true, data: FULL_SKILL });
    const out = await getTrustBreakdownTool.handler(
      { slug: 'trust-skill' },
      makeCtx(skills),
    );
    const v = out.value as Record<string, unknown>;
    expect(v.trustBreakdown).toEqual({
      overall: 84,
      tier: 'BLOCKED',
      dims: {
        security: 63,
        supply: 96,
        quality: 95,
        reliability: 74,
        compliance: 87,
        provenance: 100,
      },
      passCount: 27,
    });
    // Additive — the raw blob a caller needs to audit a specific finding stays.
    expect(v.trustResults).toEqual({ findings: [] });
  });

  it('normalizes a missing breakdown to null for pre-D3 adapters', async () => {
    // Older adapter implementations predate the field entirely. An agent
    // should branch on one value, not on undefined-vs-null.
    const { trustBreakdown: _omitted, ...legacy } = FULL_SKILL;
    const { skills } = stubLookup({ found: true, data: legacy as typeof FULL_SKILL });
    const out = await getTrustBreakdownTool.handler(
      { slug: 'trust-skill' },
      makeCtx(skills),
    );
    const v = out.value as Record<string, unknown>;
    expect(v.trustBreakdown).toBeNull();
  });

  it('describes what it actually returns — six dims, no letter grade', async () => {
    const d = getTrustBreakdownTool.description;
    expect(d).toContain('six');
    expect(d).toContain('trustBreakdown');
    // The regression this whole task exists for.
    expect(d).not.toContain('7-dimension');
    expect(d).not.toContain('A/B/C/D/F');
    for (const dim of ['security', 'supply', 'quality', 'reliability', 'compliance', 'provenance']) {
      expect(d).toContain(dim);
    }
  });
});
