// ══════════════════════════════════════════════════════════════════════════════
// get_skill — single skill lookup by slug
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import { getSkillTool } from './get-skill.js';
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

interface LookupCall {
  slug: string;
  tenantId: string;
}

function stubLookup(result: GetSkillResult) {
  const calls: LookupCall[] = [];
  const skills: SkillLookupPort = {
    getSkillBySlug: vi.fn(async (slug: string, tenantId: string) => {
      calls.push({ slug, tenantId });
      return result;
    }),
  };
  return { skills, calls };
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

function makeCtx(skills: SkillLookupPort, tenantId = 'tenant_a'): ToolContext {
  const adapters: Partial<McpAdapters> = { skills };
  return {
    adapters: adapters as McpAdapters,
    config: CONFIG,
    tenantId,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Arg validation
// ──────────────────────────────────────────────────────────────────────────────

describe('get_skill — arg validation', () => {
  it('throws when args is not an object', async () => {
    const { skills } = stubLookup({ found: false });
    await expect(getSkillTool.handler('nope', makeCtx(skills))).rejects.toThrow(
      McpError,
    );
  });

  it('throws when slug missing', async () => {
    const { skills } = stubLookup({ found: false });
    await expect(getSkillTool.handler({}, makeCtx(skills))).rejects.toThrow(
      /Missing required string 'slug'/,
    );
  });

  it('tolerates optional version (validated but unused)', async () => {
    const { skills, calls } = stubLookup({ found: false });
    await getSkillTool.handler(
      { slug: 'x', version: '1.0.0' },
      makeCtx(skills),
    );
    expect(calls[0]!.slug).toBe('x');
  });

  it('throws when version is provided as non-string', async () => {
    const { skills } = stubLookup({ found: false });
    await expect(
      getSkillTool.handler({ slug: 'x', version: 1 }, makeCtx(skills)),
    ).rejects.toThrow(/'version' must be a string/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Result envelope
// ──────────────────────────────────────────────────────────────────────────────

const SKILL_DATA = {
  id: 'sk_1',
  name: 'A',
  slug: 'a',
  version: '1.0.0',
  description: null,
  agentSummary: null,
  trustScore: 0.5,
  verificationTier: 'verified',
  trustBadge: null,
  status: 'published',
  executionLayer: null,
  mcpUrl: null,
  skillMd: null,
  capabilitiesRequired: [],
  skillType: 'atomic',
  schemaJson: null,
  source: 'manual',
  sourceUrl: null,
  tags: [],
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
  runCount: 0,
  lastRunAt: null,
  authorId: null,
  authorType: 'human',
  tenantId: null,
  revokedReason: null,
  remediationMessage: null,
  remediationUrl: null,
  replacementSkillId: null,
  replacementSlug: null,
  shareUrl: 'https://x/skills/a',
  avgExecutionTimeMs: null,
  errorRate: null,
  humanStarCount: 0,
  humanForkCount: 0,
  agentInvocationCount: 0,
  runtimeEnv: 'api',
  visibility: 'public',
  environmentVariables: [],
  cogniumScanned: false,
  cogniumScannedAt: null,
  scanCoverage: null,
  contentSafetyPassed: null,
  qualityScore: null,
  qualityTier: null,
  qualityResults: null,
  qualityAnalyzedAt: null,
  trustScoreV2: null,
  trustTier: null,
  trustResults: null,
  trustAnalyzedAt: null,
  understandResults: null,
  understandAnalyzedAt: null,
  specAlignmentScore: null,
  specGaps: null,
  specAnalyzedAt: null,
  publisherKeyId: null,
  signatureVerifiedAt: null,
  signatureFailureReason: null,
  createdAt: null,
  updatedAt: null,
  publishedAt: null,
};

describe('get_skill — envelope', () => {
  it('returns not-found envelope with isError: true', async () => {
    const { skills } = stubLookup({ found: false });
    const out = await getSkillTool.handler({ slug: 'missing' }, makeCtx(skills));
    expect(out.isError).toBe(true);
    expect(out.value).toEqual({ error: 'Skill not found', slug: 'missing' });
    expect(out.resolvedSkillId).toBeUndefined();
  });

  it('returns data + stamps resolvedSkillId on success', async () => {
    const { skills, calls } = stubLookup({ found: true, data: SKILL_DATA });
    const out = await getSkillTool.handler(
      { slug: 'a' },
      makeCtx(skills, 'tenant_b'),
    );
    expect(out.value).toBe(SKILL_DATA);
    expect(out.resolvedSkillId).toBe('sk_1');
    expect(out.isError).toBeUndefined();
    expect(calls[0]!.tenantId).toBe('tenant_b');
  });

  it('omits resolvedSkillId when data.id is non-string', async () => {
    const { skills } = stubLookup({
      found: true,
      data: { ...SKILL_DATA, id: 42 as unknown as string },
    });
    const out = await getSkillTool.handler({ slug: 'a' }, makeCtx(skills));
    expect(out.resolvedSkillId).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Metadata
// ──────────────────────────────────────────────────────────────────────────────

describe('get_skill — metadata', () => {
  it('advertises required slug', () => {
    expect(getSkillTool.name).toBe('get_skill');
    const schema = getSkillTool.inputSchema as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.required).toEqual(['slug']);
    expect(schema.properties.slug).toBeDefined();
    expect(schema.properties.version).toBeDefined();
  });
});
