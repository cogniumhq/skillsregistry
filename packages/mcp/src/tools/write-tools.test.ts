// ══════════════════════════════════════════════════════════════════════════════
// Write tools — B0.5 gating + dispatch
// ══════════════════════════════════════════════════════════════════════════════
//
// Proves the backward-compat invariant: with writeEnabled off (default) OR no
// writes port, the surface is the five read tools and a write-tool call is
// METHOD_NOT_FOUND (existence never leaks). With both present, the three tools
// list and dispatch to the port.
// ══════════════════════════════════════════════════════════════════════════════

import { describe, expect, it, vi } from 'vitest';
import type {
  CompositionLookupPort,
  GetCompositionResult,
  GetSkillResult,
  LeaderboardEntry,
  LeaderboardKind,
  LeaderboardPort,
  McpAdapters,
  McpConfig,
  SearchGatewayPort,
  SkillLookupPort,
  WritePort,
} from '../types.js';
import { handleMcpRequest, type DispatchContext } from '../dispatch.js';
import { resolveConfig } from '../protocol.js';

function baseAdapters(overrides: Partial<McpAdapters> = {}): McpAdapters {
  const search = { findSkill: vi.fn(async () => ({ results: [], confidence: 'no_match', enriched: false })) } as unknown as { findSkill: SearchGatewayPort['findSkill'] };
  const skills: SkillLookupPort = { getSkillBySlug: vi.fn(async (): Promise<GetSkillResult> => ({ found: false })) };
  const compositions: CompositionLookupPort = { getCompositionBySlug: vi.fn(async (): Promise<GetCompositionResult> => ({ found: false })) };
  const leaderboards: LeaderboardPort = { getLeaderboard: vi.fn(async (_k: LeaderboardKind): Promise<LeaderboardEntry[]> => []) };
  return { search: search as SearchGatewayPort, skills, compositions, leaderboards, ...overrides };
}

function makeCtx(config: McpConfig | undefined, adapters: McpAdapters): DispatchContext {
  return { tenantId: 'default', adapters, config: resolveConfig(config) };
}

const spyWrites = (): WritePort => ({
  publishSkill: vi.fn(async () => ({ ok: true, data: { slug: 'x', status: 'published', version: '1.0.0' } })),
  reviseSkill: vi.fn(async () => ({ ok: true, data: { slug: 'x', version: '1.1.0' } })),
  listByAuthor: vi.fn(async () => ({ ok: true, data: { count: 1, skills: [{ slug: 'x' }] } })),
});

const listReq = { jsonrpc: '2.0' as const, id: 1, method: 'tools/list', params: {} };
const names = async (ctx: DispatchContext): Promise<string[]> => {
  const out = await handleMcpRequest(listReq, ctx);
  const body = (out as any).body ?? out;
  return ((body as any).result.tools as Array<{ name: string }>).map((t) => t.name);
};
const call = (name: string, args: Record<string, unknown>) =>
  ({ jsonrpc: '2.0' as const, id: 2, method: 'tools/call', params: { name, arguments: args } });

describe('write tools — gating', () => {
  it('default (writeEnabled off): only the five read tools; no write tools', async () => {
    const ctx = makeCtx(undefined, baseAdapters({ writes: spyWrites() }));
    const n = await names(ctx);
    expect(n).toEqual(['search_skills', 'get_skill', 'list_leaderboard', 'get_trust_breakdown', 'resolve_composition']);
    expect(n).not.toContain('publish_skill');
  });

  it('writeEnabled=true but NO writes port: still read-only (needs both)', async () => {
    const ctx = makeCtx({ writeEnabled: true }, baseAdapters());
    expect(await names(ctx)).not.toContain('publish_skill');
  });

  it('writeEnabled=true + writes port: adds exactly the three write tools', async () => {
    const ctx = makeCtx({ writeEnabled: true }, baseAdapters({ writes: spyWrites() }));
    const n = await names(ctx);
    expect(n).toHaveLength(8);
    expect(n).toEqual(expect.arrayContaining(['publish_skill', 'revise_skill', 'list_my_skills']));
  });

  it('read-only instance: publish_skill call is METHOD_NOT_FOUND (existence hidden)', async () => {
    const ctx = makeCtx(undefined, baseAdapters({ writes: spyWrites() }));
    const out: any = await handleMcpRequest(call('publish_skill', { name: 'x', slug: 'x', description: 'x' }), ctx);
    const body = out.body ?? out;
    expect(body.error?.code).toBe(-32601); // JSONRPC_METHOD_NOT_FOUND
  });
});

describe('write tools — dispatch (enabled)', () => {
  it('publish_skill delegates to the writes port', async () => {
    const writes = spyWrites();
    const ctx = makeCtx({ writeEnabled: true }, baseAdapters({ writes }));
    const out: any = await handleMcpRequest(call('publish_skill', { name: 'My', slug: 'my', description: 'does a thing' }), ctx);
    const body = out.body ?? out;
    expect(writes.publishSkill).toHaveBeenCalledTimes(1);
    expect(body.result.content?.[0] ?? body.result).toBeTruthy();
    expect(body.result.isError).toBeFalsy();
  });

  it('revise_skill passes slug + bump to the port', async () => {
    const writes = spyWrites();
    const ctx = makeCtx({ writeEnabled: true }, baseAdapters({ writes }));
    await handleMcpRequest(call('revise_skill', { slug: 'my', bump: 'major', authorId: 'a1' }), ctx);
    expect(writes.reviseSkill).toHaveBeenCalledWith('my', expect.objectContaining({ bump: 'major', authorId: 'a1' }), 'default');
  });

  it('list_my_skills passes authorId + clamped limit', async () => {
    const writes = spyWrites();
    const ctx = makeCtx({ writeEnabled: true }, baseAdapters({ writes }));
    await handleMcpRequest(call('list_my_skills', { authorId: 'a1', limit: 9999 }), ctx);
    expect(writes.listByAuthor).toHaveBeenCalledWith('a1', 200, 'default'); // clamped to max
  });

  it('port failure surfaces as isError, not a thrown RPC error', async () => {
    const writes: WritePort = { ...spyWrites(), publishSkill: vi.fn(async () => ({ ok: false, error: 'slug taken' })) };
    const ctx = makeCtx({ writeEnabled: true }, baseAdapters({ writes }));
    const out: any = await handleMcpRequest(call('publish_skill', { name: 'x', slug: 'x', description: 'x' }), ctx);
    const body = out.body ?? out;
    expect(body.result.isError).toBe(true);
  });
});
