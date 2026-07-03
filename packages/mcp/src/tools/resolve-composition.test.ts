// ══════════════════════════════════════════════════════════════════════════════
// resolve_composition — expand composition slug into its step graph
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import { resolveCompositionTool } from './resolve-composition.js';
import { McpError } from '../errors.js';
import type {
  CompositionLookupPort,
  GetCompositionResult,
  McpAdapters,
  ResolvedMcpConfig,
  ToolContext,
} from '../types.js';

interface Call {
  slug: string;
  tenantId: string;
}

function stubLookup(result: GetCompositionResult) {
  const calls: Call[] = [];
  const compositions: CompositionLookupPort = {
    getCompositionBySlug: vi.fn(async (slug: string, tenantId: string) => {
      calls.push({ slug, tenantId });
      return result;
    }),
  };
  return { compositions, calls };
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

function makeCtx(
  compositions: CompositionLookupPort,
  tenantId = 'tenant_a',
): ToolContext {
  const adapters: Partial<McpAdapters> = { compositions };
  return {
    adapters: adapters as McpAdapters,
    config: CONFIG,
    tenantId,
  };
}

// ──────────────────────────────────────────────────────────────────────────────

describe('resolve_composition — arg validation', () => {
  it('throws when slug missing', async () => {
    const { compositions } = stubLookup({ found: false });
    await expect(
      resolveCompositionTool.handler({}, makeCtx(compositions)),
    ).rejects.toThrow(/Missing required string 'slug'/);
  });

  it('throws when args is not an object', async () => {
    const { compositions } = stubLookup({ found: false });
    await expect(
      resolveCompositionTool.handler([], makeCtx(compositions)),
    ).rejects.toThrow(McpError);
  });
});

describe('resolve_composition — envelope', () => {
  it('returns not-found envelope with isError: true', async () => {
    const { compositions } = stubLookup({ found: false });
    const out = await resolveCompositionTool.handler(
      { slug: 'missing' },
      makeCtx(compositions),
    );
    expect(out.isError).toBe(true);
    expect(out.value).toEqual({
      error: 'Composition not found',
      slug: 'missing',
    });
    expect(out.resolvedSkillId).toBeUndefined();
  });

  it('stamps resolvedSkillId from data.id on success', async () => {
    const data = { id: 'comp_1', slug: 'my-comp', steps: [{ n: 1 }] };
    const { compositions, calls } = stubLookup({ found: true, data });
    const out = await resolveCompositionTool.handler(
      { slug: 'my-comp' },
      makeCtx(compositions, 'tenant_z'),
    );
    expect(out.value).toBe(data);
    expect(out.resolvedSkillId).toBe('comp_1');
    expect(out.isError).toBeUndefined();
    expect(calls[0]!.slug).toBe('my-comp');
    expect(calls[0]!.tenantId).toBe('tenant_z');
  });

  it('omits resolvedSkillId when data.id is non-string', async () => {
    const { compositions } = stubLookup({
      found: true,
      data: { id: 99 as unknown as string, other: 'x' },
    });
    const out = await resolveCompositionTool.handler(
      { slug: 'x' },
      makeCtx(compositions),
    );
    expect(out.resolvedSkillId).toBeUndefined();
  });
});

describe('resolve_composition — metadata', () => {
  it('advertises required slug', () => {
    expect(resolveCompositionTool.name).toBe('resolve_composition');
    const schema = resolveCompositionTool.inputSchema as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.required).toEqual(['slug']);
    expect(schema.properties.slug).toBeDefined();
  });
});
