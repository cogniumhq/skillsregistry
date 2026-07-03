// ══════════════════════════════════════════════════════════════════════════════
// search_skills — natural-language skill discovery
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import { searchSkillsTool } from './search-skills.js';
import { McpError, JSONRPC_INVALID_PARAMS } from '../errors.js';
import type {
  McpAdapters,
  ResolvedMcpConfig,
  SearchGatewayPort,
  ToolContext,
} from '../types.js';

// ──────────────────────────────────────────────────────────────────────────────
// Doubles
// ──────────────────────────────────────────────────────────────────────────────

interface FindCall {
  query: string;
  tenantId: string;
  options: unknown;
}

function stubSearch(response: unknown = { results: [] }) {
  const calls: FindCall[] = [];
  const search: SearchGatewayPort = {
    findSkill: vi.fn(async (query: string, tenantId: string, options: unknown) => {
      calls.push({ query, tenantId, options });
      return response as never;
    }),
  };
  return { search, calls };
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
  search: SearchGatewayPort,
  configOverrides: Partial<ResolvedMcpConfig> = {},
  tenantId = 'tenant_a',
): ToolContext {
  const adapters: Partial<McpAdapters> = { search };
  return {
    adapters: adapters as McpAdapters,
    config: baseConfig(configOverrides),
    tenantId,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Arg-validation guards
// ──────────────────────────────────────────────────────────────────────────────

describe('search_skills — arg validation', () => {
  it('throws INVALID_PARAMS when args is not an object', async () => {
    const { search } = stubSearch();
    await expect(searchSkillsTool.handler('nope', makeCtx(search))).rejects.toThrow(
      McpError,
    );
  });

  it('throws INVALID_PARAMS when query is missing', async () => {
    const { search } = stubSearch();
    await expect(searchSkillsTool.handler({}, makeCtx(search))).rejects.toThrow(
      /Missing required string 'query'/,
    );
  });

  it('throws INVALID_PARAMS when query is empty/whitespace', async () => {
    const { search } = stubSearch();
    await expect(
      searchSkillsTool.handler({ query: '   ' }, makeCtx(search)),
    ).rejects.toThrow(McpError);
  });

  it('throws INVALID_PARAMS when query exceeds searchQueryMax', async () => {
    const { search } = stubSearch();
    const ctx = makeCtx(search, { searchQueryMax: 5 });
    let caught: unknown;
    try {
      await searchSkillsTool.handler({ query: 'abcdef' }, ctx);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(McpError);
    expect((caught as McpError).code).toBe(JSONRPC_INVALID_PARAMS);
    expect((caught as Error).message).toMatch(/maximum length of 5/);
  });

  it('throws when tags is not an array of strings', async () => {
    const { search } = stubSearch();
    await expect(
      searchSkillsTool.handler({ query: 'x', tags: [1, 2] }, makeCtx(search)),
    ).rejects.toThrow(/'tags' must be an array of strings/);
  });

  it('throws when portable is not a boolean', async () => {
    const { search } = stubSearch();
    await expect(
      searchSkillsTool.handler(
        { query: 'x', portable: 'yes' },
        makeCtx(search),
      ),
    ).rejects.toThrow(/'portable' must be a boolean/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Options passthrough
// ──────────────────────────────────────────────────────────────────────────────

describe('search_skills — options passthrough', () => {
  it('applies searchDefaultLimit when limit is absent', async () => {
    const { search, calls } = stubSearch();
    const ctx = makeCtx(search, { searchDefaultLimit: 7 });
    await searchSkillsTool.handler({ query: 'rust lint' }, ctx);
    expect((calls[0]!.options as { limit: number }).limit).toBe(7);
  });

  it('clamps limit to searchMaxLimit', async () => {
    const { search, calls } = stubSearch();
    const ctx = makeCtx(search, { searchMaxLimit: 30 });
    await searchSkillsTool.handler({ query: 'x', limit: 200 }, ctx);
    expect((calls[0]!.options as { limit: number }).limit).toBe(30);
  });

  it('clamps limit floor to 1', async () => {
    const { search, calls } = stubSearch();
    await searchSkillsTool.handler({ query: 'x', limit: 0 }, makeCtx(search));
    expect((calls[0]!.options as { limit: number }).limit).toBe(1);
  });

  it('wraps runtimeEnv scalar into a single-element array', async () => {
    const { search, calls } = stubSearch();
    await searchSkillsTool.handler(
      { query: 'x', runtimeEnv: 'llm' },
      makeCtx(search),
    );
    expect((calls[0]!.options as { runtimeEnv?: string[] }).runtimeEnv).toEqual([
      'llm',
    ]);
  });

  it('omits runtimeEnv when absent', async () => {
    const { search, calls } = stubSearch();
    await searchSkillsTool.handler({ query: 'x' }, makeCtx(search));
    expect(
      (calls[0]!.options as { runtimeEnv?: string[] }).runtimeEnv,
    ).toBeUndefined();
  });

  it('forwards appetite / tags / category / visibility / portable', async () => {
    const { search, calls } = stubSearch();
    await searchSkillsTool.handler(
      {
        query: 'lint',
        appetite: 'quick',
        tags: ['rust', 'ci'],
        category: 'dev-tools',
        visibility: 'public',
        portable: true,
      },
      makeCtx(search),
    );
    const opts = calls[0]!.options as {
      appetite?: string;
      tags?: string[];
      category?: string;
      visibility?: string;
      portable?: boolean;
    };
    expect(opts.appetite).toBe('quick');
    expect(opts.tags).toEqual(['rust', 'ci']);
    expect(opts.category).toBe('dev-tools');
    expect(opts.visibility).toBe('public');
    expect(opts.portable).toBe(true);
  });

  it('passes tenantId + trimmed query to findSkill', async () => {
    const { search, calls } = stubSearch();
    await searchSkillsTool.handler(
      { query: '  hello world  ' },
      makeCtx(search, {}, 'tenant_x'),
    );
    expect(calls[0]!.query).toBe('hello world');
    expect(calls[0]!.tenantId).toBe('tenant_x');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Result envelope
// ──────────────────────────────────────────────────────────────────────────────

describe('search_skills — result envelope', () => {
  it('returns provider response verbatim (no resolvedSkillId)', async () => {
    const response = { results: [{ slug: 'a' }] };
    const { search } = stubSearch(response);
    const out = await searchSkillsTool.handler({ query: 'x' }, makeCtx(search));
    expect(out.value).toBe(response);
    expect(out.resolvedSkillId).toBeUndefined();
    expect(out.isError).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Tool metadata
// ──────────────────────────────────────────────────────────────────────────────

describe('search_skills — metadata', () => {
  it('exposes name / description / required query', () => {
    expect(searchSkillsTool.name).toBe('search_skills');
    expect(searchSkillsTool.description).toMatch(/skill/i);
    const schema = searchSkillsTool.inputSchema as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.required).toEqual(['query']);
    expect(schema.properties.query).toBeDefined();
  });
});
