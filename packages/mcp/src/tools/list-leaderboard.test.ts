// ══════════════════════════════════════════════════════════════════════════════
// list_leaderboard — five leaderboard projections behind one tool
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import { listLeaderboardTool } from './list-leaderboard.js';
import { McpError, JSONRPC_INVALID_PARAMS } from '../errors.js';
import type {
  LeaderboardEntry,
  LeaderboardFilters,
  LeaderboardKind,
  LeaderboardPort,
  McpAdapters,
  ResolvedMcpConfig,
  ToolContext,
} from '../types.js';

interface Call {
  kind: LeaderboardKind;
  filters: LeaderboardFilters;
}

function stubLeaderboards(rows: LeaderboardEntry[] = []) {
  const calls: Call[] = [];
  const leaderboards: LeaderboardPort = {
    getLeaderboard: vi.fn(
      async (kind: LeaderboardKind, filters: LeaderboardFilters) => {
        calls.push({ kind, filters });
        return rows;
      },
    ),
  };
  return { leaderboards, calls };
}

function baseConfig(overrides: Partial<ResolvedMcpConfig> = {}): ResolvedMcpConfig {
  return {
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
    ...overrides,
  };
}

function makeCtx(
  leaderboards: LeaderboardPort,
  configOverrides: Partial<ResolvedMcpConfig> = {},
): ToolContext {
  const adapters: Partial<McpAdapters> = { leaderboards };
  return {
    adapters: adapters as McpAdapters,
    config: baseConfig(configOverrides),
    tenantId: 'tenant_a',
  };
}

// ──────────────────────────────────────────────────────────────────────────────

describe('list_leaderboard — arg validation', () => {
  it('throws when kind missing', async () => {
    const { leaderboards } = stubLeaderboards();
    await expect(
      listLeaderboardTool.handler({}, makeCtx(leaderboards)),
    ).rejects.toThrow(/Missing required string 'kind'/);
  });

  it('throws INVALID_PARAMS for an unknown kind', async () => {
    const { leaderboards } = stubLeaderboards();
    let caught: unknown;
    try {
      await listLeaderboardTool.handler(
        { kind: 'nonsense' },
        makeCtx(leaderboards),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(McpError);
    expect((caught as McpError).code).toBe(JSONRPC_INVALID_PARAMS);
    expect((caught as Error).message).toMatch(/Unknown leaderboard kind/);
    // Message must include the allowed set for discoverability
    expect((caught as Error).message).toMatch(
      /trust.*trending.*agents.*composed.*forked/,
    );
  });

  it.each(['trust', 'trending', 'agents', 'composed', 'forked'] as const)(
    'accepts valid kind %s',
    async (kind) => {
      const { leaderboards, calls } = stubLeaderboards();
      await listLeaderboardTool.handler({ kind }, makeCtx(leaderboards));
      expect(calls[0]!.kind).toBe(kind);
    },
  );
});

describe('list_leaderboard — limit clamping', () => {
  it('applies leaderboardDefaultLimit when limit is absent', async () => {
    const { leaderboards, calls } = stubLeaderboards();
    const ctx = makeCtx(leaderboards, { leaderboardDefaultLimit: 42 });
    await listLeaderboardTool.handler({ kind: 'trust' }, ctx);
    expect(calls[0]!.filters.limit).toBe(42);
  });

  it('clamps limit to leaderboardMaxLimit', async () => {
    const { leaderboards, calls } = stubLeaderboards();
    const ctx = makeCtx(leaderboards, { leaderboardMaxLimit: 50 });
    await listLeaderboardTool.handler(
      { kind: 'trust', limit: 10_000 },
      ctx,
    );
    expect(calls[0]!.filters.limit).toBe(50);
  });

  it('floors limit at 1 for zero/negative input', async () => {
    const { leaderboards, calls } = stubLeaderboards();
    await listLeaderboardTool.handler(
      { kind: 'trust', limit: -5 },
      makeCtx(leaderboards),
    );
    expect(calls[0]!.filters.limit).toBe(1);
  });
});

describe('list_leaderboard — filter passthrough', () => {
  it('always sets offset = 0', async () => {
    const { leaderboards, calls } = stubLeaderboards();
    await listLeaderboardTool.handler(
      { kind: 'trust' },
      makeCtx(leaderboards),
    );
    expect(calls[0]!.filters.offset).toBe(0);
  });

  it('forwards skillType / category / ecosystem when provided', async () => {
    const { leaderboards, calls } = stubLeaderboards();
    await listLeaderboardTool.handler(
      {
        kind: 'agents',
        skillType: 'atomic',
        category: 'dev-tools',
        ecosystem: 'rust',
      },
      makeCtx(leaderboards),
    );
    const f = calls[0]!.filters;
    expect(f.skillType).toBe('atomic');
    expect(f.category).toBe('dev-tools');
    expect(f.ecosystem).toBe('rust');
  });

  it('omits filters when absent', async () => {
    const { leaderboards, calls } = stubLeaderboards();
    await listLeaderboardTool.handler(
      { kind: 'trust' },
      makeCtx(leaderboards),
    );
    const f = calls[0]!.filters;
    expect(f.skillType).toBeUndefined();
    expect(f.category).toBeUndefined();
    expect(f.ecosystem).toBeUndefined();
  });
});

describe('list_leaderboard — envelope', () => {
  it('returns provider rows verbatim; no resolvedSkillId (discovery-only)', async () => {
    const rows = [
      {
        id: 'sk_1',
        slug: 'a',
        name: 'A',
        skillType: 'atomic',
        authorHandle: null,
        authorType: 'human',
        score: 1,
        trustScore: 0.5,
        publisherKeyId: null,
        signatureVerifiedAt: null,
        signatureFailureReason: null,
      },
    ] as LeaderboardEntry[];
    const { leaderboards } = stubLeaderboards(rows);
    const out = await listLeaderboardTool.handler(
      { kind: 'trust' },
      makeCtx(leaderboards),
    );
    expect(out.value).toBe(rows);
    expect(out.resolvedSkillId).toBeUndefined();
    expect(out.isError).toBeUndefined();
  });
});

describe('list_leaderboard — metadata', () => {
  it('advertises kind enum and required kind', () => {
    expect(listLeaderboardTool.name).toBe('list_leaderboard');
    const schema = listLeaderboardTool.inputSchema as {
      required: string[];
      properties: { kind: { enum: string[] } };
    };
    expect(schema.required).toEqual(['kind']);
    expect(schema.properties.kind.enum).toEqual([
      'trust',
      'trending',
      'agents',
      'composed',
      'forked',
    ]);
  });
});
