// ══════════════════════════════════════════════════════════════════════════════
// dispatch — smoke coverage for the JSON-RPC surface
// ══════════════════════════════════════════════════════════════════════════════

import { describe, expect, it, vi } from 'vitest';

import type {
  CompositionLookupPort,
  FindSkillResponse,
  GetCompositionResult,
  GetSkillResult,
  InvocationRecorderPort,
  LeaderboardEntry,
  LeaderboardKind,
  LeaderboardPort,
  McpAdapters,
  SearchGatewayPort,
  SkillDetail,
  SkillLookupPort,
} from './types.js';
import { handleMcpRequest, type DispatchContext } from './dispatch.js';
import { resolveConfig } from './protocol.js';
import { JSONRPC_INVALID_PARAMS, JSONRPC_METHOD_NOT_FOUND } from './errors.js';

function makeSkill(slug: string): SkillDetail {
  return {
    id: `id-${slug}`,
    name: slug,
    slug,
    version: '1.0.0',
    description: null,
    agentSummary: null,
    trustScore: 0.9,
    verificationTier: 'verified',
    trustBadge: null,
    status: 'published',
    executionLayer: null,
    mcpUrl: null,
    skillMd: null,
    capabilitiesRequired: [],
    skillType: 'atomic',
    schemaJson: null,
    source: 'test',
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
    shareUrl: `https://skillsregistry.net/skills/${slug}`,
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
}

function makeCtx(overrides: Partial<McpAdapters> = {}): DispatchContext {
  const search: SearchGatewayPort = {
    findSkill: vi.fn(async () => ({
      results: [],
      confidence: 'no_match',
      enriched: false,
    })) as unknown as SearchGatewayPort['findSkill'],
  };
  const skills: SkillLookupPort = {
    getSkillBySlug: vi.fn(async (slug: string): Promise<GetSkillResult> => {
      if (slug === 'missing') return { found: false };
      return { found: true, data: makeSkill(slug) };
    }),
  };
  const compositions: CompositionLookupPort = {
    getCompositionBySlug: vi.fn(
      async (slug: string): Promise<GetCompositionResult> => {
        if (slug === 'missing') return { found: false };
        return { found: true, data: { id: `comp-${slug}`, slug } };
      },
    ),
  };
  const leaderboards: LeaderboardPort = {
    getLeaderboard: vi.fn(
      async (_kind: LeaderboardKind): Promise<LeaderboardEntry[]> => [],
    ),
  };
  return {
    tenantId: 'default',
    adapters: { search, skills, compositions, leaderboards, ...overrides },
    config: resolveConfig(undefined),
  };
}

describe('handleMcpRequest — initialize', () => {
  it('echoes the requested protocol version if supported', async () => {
    const out = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05' },
      },
      makeCtx(),
    );
    expect(out.kind).toBe('json');
    if (out.kind !== 'json') throw new Error('unreachable');
    const body = out.body as { result: { protocolVersion: string; serverInfo: unknown } };
    expect(body.result.protocolVersion).toBe('2024-11-05');
    expect(body.result.serverInfo).toEqual({
      name: 'skillsregistry',
      version: '6.2.0',
    });
  });

  it('falls back to the preferred version when the client asks for an unknown one', async () => {
    const out = await handleMcpRequest(
      { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1.0' } },
      makeCtx(),
    );
    if (out.kind !== 'json') throw new Error('expected json');
    const body = out.body as { result: { protocolVersion: string } };
    expect(body.result.protocolVersion).toBe('2025-03-26');
  });
});

describe('handleMcpRequest — tools/list', () => {
  it('advertises all five v1 tools', async () => {
    const out = await handleMcpRequest(
      { jsonrpc: '2.0', id: 3, method: 'tools/list' },
      makeCtx(),
    );
    if (out.kind !== 'json') throw new Error('expected json');
    const body = out.body as { result: { tools: { name: string }[] } };
    const names = body.result.tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'get_skill',
        'get_trust_breakdown',
        'list_leaderboard',
        'resolve_composition',
        'search_skills',
      ].sort(),
    );
  });
});

describe('handleMcpRequest — tools/call', () => {
  it('resolves get_skill for a known slug and stamps the recorder skill id', async () => {
    const recorder: InvocationRecorderPort = {
      record: vi.fn(async () => {}),
    };
    const ctx = makeCtx({ recorder });
    const out = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: { name: 'get_skill', arguments: { slug: 'hello' } },
      },
      ctx,
    );
    if (out.kind !== 'json') throw new Error('expected json');
    const body = out.body as {
      result: { content: { type: string; text: string }[]; isError: boolean };
    };
    expect(body.result.isError).toBe(false);
    const parsed = JSON.parse(body.result.content[0]!.text) as { slug: string; id: string };
    expect(parsed.slug).toBe('hello');
    // recorder was invoked with the resolved skill id
    await new Promise((r) => setImmediate(r));
    expect(recorder.record).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'get_skill',
        skillId: 'id-hello',
        succeeded: true,
      }),
    );
  });

  it('returns tool-level error (isError=true) when the slug is missing', async () => {
    const ctx = makeCtx();
    const out = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: { name: 'get_skill', arguments: { slug: 'missing' } },
      },
      ctx,
    );
    if (out.kind !== 'json') throw new Error('expected json');
    const body = out.body as {
      result: { content: { text: string }[]; isError: boolean };
    };
    expect(body.result.isError).toBe(true);
    expect(JSON.parse(body.result.content[0]!.text)).toEqual({
      error: 'Skill not found',
      slug: 'missing',
    });
  });

  it('rejects unknown tool names with JSON-RPC method-not-found', async () => {
    const out = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: { name: 'not_a_tool', arguments: {} },
      },
      makeCtx(),
    );
    if (out.kind !== 'json') throw new Error('expected json');
    const body = out.body as { error: { code: number; message: string } };
    expect(body.error.code).toBe(JSONRPC_METHOD_NOT_FOUND);
  });

  it('rejects bad params with JSON-RPC invalid-params', async () => {
    const out = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/call',
        params: { name: 'search_skills', arguments: { query: '' } },
      },
      makeCtx(),
    );
    if (out.kind !== 'json') throw new Error('expected json');
    const body = out.body as { error: { code: number; message: string } };
    expect(body.error.code).toBe(JSONRPC_INVALID_PARAMS);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Policy hook — cortex.md §16.4 two enforcement points
// ──────────────────────────────────────────────────────────────────────────────

describe('handleMcpRequest — McpPolicyPort', () => {
  it('tools/list: filters out tools the policy disallows', async () => {
    const isToolAllowed = vi.fn(
      async (name: string, _tenantId: string) =>
        name !== 'get_trust_breakdown' && name !== 'resolve_composition',
    );
    const out = await handleMcpRequest(
      { jsonrpc: '2.0', id: 100, method: 'tools/list' },
      makeCtx({ policy: { isToolAllowed } }),
    );
    if (out.kind !== 'json') throw new Error('expected json');
    const body = out.body as {
      result: { tools: Array<{ name: string }> };
    };
    const names = body.result.tools.map((t) => t.name);
    expect(names).not.toContain('get_trust_breakdown');
    expect(names).not.toContain('resolve_composition');
    expect(names).toContain('search_skills');
    // Called once per candidate tool with the ctx tenantId.
    expect(isToolAllowed).toHaveBeenCalledWith(
      'search_skills',
      'default',
    );
  });

  it('tools/list: omitted policy = allow-all (v1 posture)', async () => {
    const out = await handleMcpRequest(
      { jsonrpc: '2.0', id: 101, method: 'tools/list' },
      makeCtx(), // no policy
    );
    if (out.kind !== 'json') throw new Error('expected json');
    const body = out.body as {
      result: { tools: Array<{ name: string }> };
    };
    expect(body.result.tools).toHaveLength(5);
  });

  it('tools/call: rejects disallowed tool with method-not-found', async () => {
    const isToolAllowed = vi.fn(async (name: string) => name !== 'search_skills');
    const out = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 102,
        method: 'tools/call',
        params: { name: 'search_skills', arguments: { query: 'x' } },
      },
      makeCtx({ policy: { isToolAllowed } }),
    );
    if (out.kind !== 'json') throw new Error('expected json');
    const body = out.body as { error: { code: number; message: string } };
    // Same shape as unknown-tool — caller can't distinguish "doesn't exist"
    // from "not for you". Matches mothership posture.
    expect(body.error.code).toBe(JSONRPC_METHOD_NOT_FOUND);
    expect(isToolAllowed).toHaveBeenCalledWith('search_skills', 'default');
  });

  it('tools/call: allowed tool dispatches normally', async () => {
    const isToolAllowed = vi.fn(async () => true);
    const out = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 103,
        method: 'tools/call',
        params: { name: 'get_skill', arguments: { slug: 'hello' } },
      },
      makeCtx({ policy: { isToolAllowed } }),
    );
    if (out.kind !== 'json') throw new Error('expected json');
    const body = out.body as {
      result: { content: Array<{ text: string }>; isError: boolean };
    };
    expect(body.result.isError).toBe(false);
    expect(isToolAllowed).toHaveBeenCalledWith('get_skill', 'default');
  });
});

describe('handleMcpRequest — batches + notifications', () => {
  it('collapses notification-only batches to 202 accepted', async () => {
    const out = await handleMcpRequest(
      [{ jsonrpc: '2.0', method: 'notifications/initialized' }],
      makeCtx(),
    );
    expect(out.kind).toBe('accepted');
  });

  it('rejects empty batches with JSON-RPC invalid-request', async () => {
    const out = await handleMcpRequest([], makeCtx());
    expect(out.kind).toBe('error');
    if (out.kind !== 'error') throw new Error('unreachable');
    expect(out.status).toBe(400);
  });

  it('rejects oversize batches per config.batchMax', async () => {
    const ctx = makeCtx();
    const oversize = Array.from({ length: ctx.config.batchMax + 1 }, (_, i) => ({
      jsonrpc: '2.0' as const,
      id: i,
      method: 'ping',
    }));
    const out = await handleMcpRequest(oversize, ctx);
    expect(out.kind).toBe('error');
  });
});
