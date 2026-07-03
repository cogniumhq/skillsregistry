// ══════════════════════════════════════════════════════════════════════════════
// T-2.13 — dedicated in-process tests for POST /mcp against the wired dispatcher.
// ══════════════════════════════════════════════════════════════════════════════
//
// The generic wire-up already gets a smoke test in `routing.test.ts` (initialize
// + parse-error + notification). This suite exercises each of the five tools
// through the dispatch loop with hand-rolled adapter fakes so we prove:
//
//   - tools/list surfaces all five tools with the expected schemas.
//   - Each tool's happy path passes through the port and reports the tool's
//     wire shape (`content[0].text = JSON.stringify(value)`, `isError` false).
//   - Tool-level failures (slug not found, composition missing) come back with
//     `isError: true` inside the JSON-RPC success envelope, not as JSON-RPC
//     errors (per MCP 2025-03-26 §tools/call).
//   - The recorder + afterResponse hooks fire for tools/call — succeeded
//     mirrors `isError` and `resolvedSkillId` only lands when the underlying
//     tool won.
//   - Batch dispatch fans out and preserves ids.
//   - `list_leaderboard` under air-gap collapses to an empty array via
//     `McpLeaderboardProxy`, not a JSON-RPC error (mirrors the /v1 proxy
//     posture — we don't leak the air-gap as a tool-level failure).
//   - Unknown methods return JSON-RPC METHOD_NOT_FOUND (-32601).
//
// The adapter surface is faked here rather than reaching into `UpstreamClient`
// / `ConfidenceGate` — those have their own tests. The intent is proving the
// Hono handler → `handleMcpRequest` → tool ports contract, not re-testing the
// upstream branches.
// ══════════════════════════════════════════════════════════════════════════════

import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import type {
  CompositionLookupPort,
  InvocationRecorder,
  LeaderboardEntry,
  LeaderboardPort,
  ResolvedMcpConfig,
  SearchGatewayPort,
  SkillDetail,
  SkillLookupPort,
} from '@skillsregistry/mcp';
import type { AfterResponse } from '@skillsregistry/domain/adapters';
import type { AppConfig } from '../config.js';
import { createApp } from '../index.js';
import type { AppServices } from '../services.js';

const ADMIN_TOKEN = 'test-admin-token';

// ─── config + helpers ───────────────────────────────────────────────────────

function buildConfig(): AppConfig {
  return {
    nodeEnv: 'test',
    http: { host: '0.0.0.0', port: 3000 },
    postgres: {
      connectionString: 'postgres://x',
      poolMax: 10,
      statementTimeoutMs: 30000,
    },
    admin: { token: ADMIN_TOKEN },
    artifact: { baseDir: '/tmp/artifacts' },
    budget: { refreshCron: '0 3 * * *', ttlSeconds: 93600 },
    embedder: {
      kind: 'ollama',
      url: 'http://localhost:11434',
      model: 'nomic-embed-text',
    },
    upstream: null,
    search: {
      fusionMode: 'linear',
      tier1Threshold: undefined,
      tier2Threshold: undefined,
      deepSearchEnabled: false,
      rerankerEnabled: false,
      defaultAppetite: 'balanced',
      circuitBreakerThreshold: 3,
      circuitBreakerCooldownMs: 30000,
      cacheTtlTier1: 3600,
      cacheTtlTier2: 1800,
      cacheTtlTier3: 600,
    },
    log: { level: 'info' },
    mcp: {
      serverName: 'skillsregistry-local',
      serverVersion: '0.1.0',
      canonicalOrigin: undefined,
      documentationUrl: undefined,
      openapiUrl: undefined,
      searchDefaultLimit: 10,
      searchMaxLimit: 50,
      searchQueryMax: 500,
      leaderboardDefaultLimit: 20,
      leaderboardMaxLimit: 100,
      batchMax: 20,
      invocationArgsMaxChars: 4096,
    },
  };
}

function fakePool(): Pool {
  return {
    query: async () => ({ rows: [{ '?column?': 1 }] }),
  } as unknown as Pool;
}

const MCP_CONFIG: ResolvedMcpConfig = {
  serverName: 'skillsregistry-local',
  serverVersion: '0.1.0',
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

/** Inline `afterResponse` that runs tasks synchronously so recorder writes are
 *  observable at assertion time without a wait loop. */
function inlineAfterResponse(): AfterResponse {
  return {
    run: (task) => {
      void task();
    },
  };
}

interface RecorderCall {
  toolName: string;
  tenantId: string;
  skillId: string | null;
  succeeded: boolean;
  errorCode: number | null;
  args: unknown;
}

function collectingRecorder(): {
  recorder: InvocationRecorder;
  calls: RecorderCall[];
} {
  const calls: RecorderCall[] = [];
  return {
    calls,
    recorder: {
      record: async (input) => {
        calls.push({
          toolName: input.toolName,
          tenantId: input.tenantId,
          skillId: input.skillId,
          succeeded: input.succeeded,
          errorCode: input.errorCode,
          args: input.args,
        });
      },
    },
  };
}

// ─── adapter fakes (per-test overrides via factory) ─────────────────────────

interface AdapterOverrides {
  search?: Partial<SearchGatewayPort>;
  skills?: Partial<SkillLookupPort>;
  compositions?: Partial<CompositionLookupPort>;
  leaderboards?: Partial<LeaderboardPort>;
  mcpConfig?: Partial<ResolvedMcpConfig>;
}

function buildServices(overrides: AdapterOverrides = {}): {
  services: AppServices;
  recorderCalls: RecorderCall[];
} {
  const { recorder, calls } = collectingRecorder();
  const services = {
    mcpAdapters: {
      search: {
        findSkill: async () => ({ skills: [], meta: {} }),
        ...overrides.search,
      } as SearchGatewayPort,
      skills: {
        getSkillBySlug: async () => ({ found: false }),
        ...overrides.skills,
      } as SkillLookupPort,
      compositions: {
        getCompositionBySlug: async () => ({ found: false }),
        ...overrides.compositions,
      } as CompositionLookupPort,
      leaderboards: {
        getLeaderboard: async () => [],
        ...overrides.leaderboards,
      } as LeaderboardPort,
      recorder,
      afterResponse: inlineAfterResponse(),
    },
    mcpConfig: { ...MCP_CONFIG, ...overrides.mcpConfig },
  } as unknown as AppServices;
  return { services, recorderCalls: calls };
}

// ─── canned data ────────────────────────────────────────────────────────────

function skillDetail(id: string, slug: string): SkillDetail {
  return {
    id,
    slug,
    version: '1.0.0',
    name: slug,
    description: 'demo skill',
    trustScore: 0.9,
    verificationTier: 'A',
    trustBadge: 'A',
    trustScoreV2: 0.9,
    trustTier: 'A',
    trustResults: [],
    trustAnalyzedAt: '2026-06-01T00:00:00Z',
    qualityScore: 0.95,
    qualityTier: 'A',
    qualityAnalyzedAt: '2026-06-01T00:00:00Z',
    cogniumScanned: true,
    cogniumScannedAt: '2026-06-01T00:00:00Z',
    scanCoverage: 1,
    contentSafetyPassed: true,
    specAlignmentScore: 0.9,
    specGaps: [],
    humanStarCount: 12,
    humanForkCount: 3,
    agentInvocationCount: 100,
    status: 'published',
    revokedReason: null,
    remediationMessage: null,
    remediationUrl: null,
    replacementSlug: null,
  } as unknown as SkillDetail;
}

// ─── helpers ────────────────────────────────────────────────────────────────

interface JsonRpcOk {
  jsonrpc: '2.0';
  id: number | string | null;
  result: {
    content: Array<{ type: 'text'; text: string }>;
    isError: boolean;
  };
}

interface JsonRpcErr {
  jsonrpc: '2.0';
  id: number | string | null;
  error: { code: number; message: string };
}

async function post(services: AppServices, body: unknown): Promise<Response> {
  const app = createApp(buildConfig(), fakePool(), services);
  return app.request('/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function decodeText<T>(res: JsonRpcOk): T {
  return JSON.parse(res.result.content[0]!.text) as T;
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('POST /mcp — dispatch fan-out (T-2.13)', () => {
  describe('tools/list', () => {
    it('advertises the five read-only tools', async () => {
      const { services } = buildServices();
      const res = await post(services, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        result: { tools: Array<{ name: string; description: string }> };
      };
      const names = body.result.tools.map((t) => t.name).sort();
      expect(names).toEqual([
        'get_skill',
        'get_trust_breakdown',
        'list_leaderboard',
        'resolve_composition',
        'search_skills',
      ]);
    });
  });

  describe('tools/call search_skills', () => {
    it('threads the query through the search gateway', async () => {
      const captured: { query?: string; tenantId?: string } = {};
      const { services, recorderCalls } = buildServices({
        search: {
          findSkill: async (query, tenantId) => {
            captured.query = query;
            captured.tenantId = tenantId;
            return { skills: [{ id: 's1', slug: 'demo' }], meta: { tier: 1 } };
          },
        },
      });
      const res = await post(services, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'search_skills', arguments: { query: 'hello world' } },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as JsonRpcOk;
      expect(body.result.isError).toBe(false);
      const decoded = decodeText<{ skills: Array<{ slug: string }> }>(body);
      expect(decoded.skills[0]!.slug).toBe('demo');
      expect(captured.query).toBe('hello world');
      expect(captured.tenantId).toBe('local');
      // Discovery — no resolvedSkillId, but the recorder still logs.
      expect(recorderCalls).toHaveLength(1);
      expect(recorderCalls[0]!.toolName).toBe('search_skills');
      expect(recorderCalls[0]!.skillId).toBeNull();
      expect(recorderCalls[0]!.succeeded).toBe(true);
    });

    it('honors X-Tenant-Id as the dispatch tenant', async () => {
      const captured: { tenantId?: string } = {};
      const { services } = buildServices({
        search: {
          findSkill: async (_query, tenantId) => {
            captured.tenantId = tenantId;
            return { skills: [], meta: {} };
          },
        },
      });
      const app = createApp(buildConfig(), fakePool(), services);
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': 'tenant-42',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'search_skills', arguments: { query: 'x' } },
        }),
      });
      expect(res.status).toBe(200);
      expect(captured.tenantId).toBe('tenant-42');
    });
  });

  describe('tools/call get_skill', () => {
    it('stamps resolvedSkillId on a hit and reports the tool succeeded', async () => {
      const { services, recorderCalls } = buildServices({
        skills: {
          getSkillBySlug: async (slug) => ({
            found: true,
            data: skillDetail('skill-uuid-1', slug),
          }),
        },
      });
      const res = await post(services, {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: { name: 'get_skill', arguments: { slug: 'demo-skill' } },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as JsonRpcOk;
      expect(body.result.isError).toBe(false);
      const decoded = decodeText<{ id: string; slug: string }>(body);
      expect(decoded.id).toBe('skill-uuid-1');
      expect(decoded.slug).toBe('demo-skill');
      expect(recorderCalls).toHaveLength(1);
      expect(recorderCalls[0]!.toolName).toBe('get_skill');
      expect(recorderCalls[0]!.skillId).toBe('skill-uuid-1');
      expect(recorderCalls[0]!.succeeded).toBe(true);
    });

    it('surfaces a miss as isError=true and does not stamp resolvedSkillId', async () => {
      const { services, recorderCalls } = buildServices({
        skills: { getSkillBySlug: async () => ({ found: false }) },
      });
      const res = await post(services, {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: { name: 'get_skill', arguments: { slug: 'nope' } },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as JsonRpcOk;
      expect(body.result.isError).toBe(true);
      const decoded = decodeText<{ error: string; slug: string }>(body);
      expect(decoded.error).toBe('Skill not found');
      expect(decoded.slug).toBe('nope');
      expect(recorderCalls).toHaveLength(1);
      // Tool-domain failure — recorder logs succeeded=false, no skill id.
      expect(recorderCalls[0]!.succeeded).toBe(false);
      expect(recorderCalls[0]!.skillId).toBeNull();
    });
  });

  describe('tools/call get_trust_breakdown', () => {
    it('projects the trust slice + resolves the skill id', async () => {
      const { services, recorderCalls } = buildServices({
        skills: {
          getSkillBySlug: async (slug) => ({
            found: true,
            data: skillDetail('trust-uuid-1', slug),
          }),
        },
      });
      const res = await post(services, {
        jsonrpc: '2.0',
        id: 20,
        method: 'tools/call',
        params: { name: 'get_trust_breakdown', arguments: { slug: 'demo' } },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as JsonRpcOk;
      expect(body.result.isError).toBe(false);
      const decoded = decodeText<{
        id: string;
        trustTier: string;
        humanStarCount: number;
        agentInvocationCount: number;
      }>(body);
      expect(decoded.id).toBe('trust-uuid-1');
      expect(decoded.trustTier).toBe('A');
      // Human + agent signals surfaced as adjacent fields, never fused.
      expect(decoded.humanStarCount).toBe(12);
      expect(decoded.agentInvocationCount).toBe(100);
      expect(recorderCalls[0]!.toolName).toBe('get_trust_breakdown');
      expect(recorderCalls[0]!.skillId).toBe('trust-uuid-1');
    });
  });

  describe('tools/call list_leaderboard', () => {
    it('proxies to the leaderboard port and returns the entries', async () => {
      const entries: LeaderboardEntry[] = [
        { rank: 1, skillId: 'lb-1', slug: 'top-1', score: 100 } as LeaderboardEntry,
      ];
      const captured: { kind?: string; limit?: number } = {};
      const { services, recorderCalls } = buildServices({
        leaderboards: {
          getLeaderboard: async (kind, filters) => {
            captured.kind = kind;
            captured.limit = filters.limit;
            return entries;
          },
        },
      });
      const res = await post(services, {
        jsonrpc: '2.0',
        id: 30,
        method: 'tools/call',
        params: {
          name: 'list_leaderboard',
          arguments: { kind: 'trust', limit: 5 },
        },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as JsonRpcOk;
      expect(body.result.isError).toBe(false);
      const decoded = decodeText<LeaderboardEntry[]>(body);
      expect(decoded).toHaveLength(1);
      expect(decoded[0]!.slug).toBe('top-1');
      expect(captured.kind).toBe('trust');
      expect(captured.limit).toBe(5);
      expect(recorderCalls[0]!.toolName).toBe('list_leaderboard');
      // Discovery — never stamps a resolved skill id.
      expect(recorderCalls[0]!.skillId).toBeNull();
    });

    it('collapses air-gap to an empty array (proxy port already unwrapped)', async () => {
      // McpLeaderboardProxy is the one that catches upstream_not_configured;
      // by the time the dispatcher runs, the port has already returned [].
      // This test just proves the dispatcher hands `[]` through untouched.
      const { services } = buildServices({
        leaderboards: { getLeaderboard: async () => [] },
      });
      const res = await post(services, {
        jsonrpc: '2.0',
        id: 31,
        method: 'tools/call',
        params: { name: 'list_leaderboard', arguments: { kind: 'trust' } },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as JsonRpcOk;
      expect(body.result.isError).toBe(false);
      const decoded = decodeText<LeaderboardEntry[]>(body);
      expect(decoded).toEqual([]);
    });
  });

  describe('tools/call resolve_composition', () => {
    it('reports Composition not found via isError (MVP always false)', async () => {
      const { services, recorderCalls } = buildServices();
      const res = await post(services, {
        jsonrpc: '2.0',
        id: 40,
        method: 'tools/call',
        params: {
          name: 'resolve_composition',
          arguments: { slug: 'my-composition' },
        },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as JsonRpcOk;
      expect(body.result.isError).toBe(true);
      const decoded = decodeText<{ error: string; slug: string }>(body);
      expect(decoded.error).toBe('Composition not found');
      expect(decoded.slug).toBe('my-composition');
      expect(recorderCalls[0]!.succeeded).toBe(false);
      expect(recorderCalls[0]!.skillId).toBeNull();
    });
  });

  describe('dispatch envelope', () => {
    it('returns JSON-RPC METHOD_NOT_FOUND for unknown methods', async () => {
      const { services } = buildServices();
      const res = await post(services, {
        jsonrpc: '2.0',
        id: 50,
        method: 'does/not/exist',
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as JsonRpcErr;
      expect(body.error.code).toBe(-32601);
    });

    it('returns JSON-RPC METHOD_NOT_FOUND for unknown tool names', async () => {
      const { services } = buildServices();
      const res = await post(services, {
        jsonrpc: '2.0',
        id: 51,
        method: 'tools/call',
        params: { name: 'made_up_tool', arguments: {} },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as JsonRpcErr;
      expect(body.error.code).toBe(-32601);
    });

    it('fans a batch out and preserves ids', async () => {
      const { services } = buildServices({
        search: { findSkill: async () => ({ skills: [], meta: {} }) },
        skills: {
          getSkillBySlug: async (slug) => ({
            found: true,
            data: skillDetail('batch-uuid', slug),
          }),
        },
      });
      const res = await post(services, [
        { jsonrpc: '2.0', id: 60, method: 'tools/list' },
        {
          jsonrpc: '2.0',
          id: 61,
          method: 'tools/call',
          params: { name: 'search_skills', arguments: { query: 'x' } },
        },
        {
          jsonrpc: '2.0',
          id: 62,
          method: 'tools/call',
          params: { name: 'get_skill', arguments: { slug: 'demo' } },
        },
      ]);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ id: number }>;
      expect(body).toHaveLength(3);
      const ids = body.map((r) => r.id).sort();
      expect(ids).toEqual([60, 61, 62]);
    });

    it('returns 400 with an INVALID_REQUEST envelope on an empty batch', async () => {
      const { services } = buildServices();
      const res = await post(services, []);
      expect(res.status).toBe(400);
      const body = (await res.json()) as JsonRpcErr;
      expect(body.error.code).toBe(-32600);
    });
  });
});

describe('GET /mcp.json + GET /.well-known/mcp.json — discovery (T-2.14)', () => {
  interface DiscoveryDescriptor {
    schemaVersion: string;
    protocolVersion: string;
    serverInfo: { name: string; version: string };
    transport: { type: string; endpoint: string; methods: string[] };
    capabilities: { tools: { listChanged: boolean } };
    auth: { model: string; tenantHeader: string; notes: string };
    tools: Array<{ name: string; description: string; inputSchema: unknown }>;
    documentation: string;
    openapi: string;
  }

  async function getDiscovery(
    services: AppServices,
    path: '/mcp.json' | '/.well-known/mcp.json',
    reqUrl = `http://localhost:3000${path}`,
  ): Promise<{ res: Response; body: DiscoveryDescriptor }> {
    const app = createApp(buildConfig(), fakePool(), services);
    const res = await app.request(reqUrl);
    const body = (await res.json()) as DiscoveryDescriptor;
    return { res, body };
  }

  it('emits the schemaVersion + protocolVersion + serverInfo from ResolvedMcpConfig', async () => {
    const { services } = buildServices();
    const { res, body } = await getDiscovery(services, '/mcp.json');
    expect(res.status).toBe(200);
    expect(body.schemaVersion).toBe('1');
    expect(body.protocolVersion).toBe('2025-03-26');
    expect(body.serverInfo).toEqual({
      name: 'skillsregistry-local',
      version: '0.1.0',
    });
  });

  it('advertises the streamable-http transport pointing at /mcp with the request origin as the fallback', async () => {
    const { services } = buildServices();
    const { body } = await getDiscovery(
      services,
      '/mcp.json',
      'http://mcp.example.test:8080/mcp.json',
    );
    expect(body.transport.type).toBe('streamable-http');
    expect(body.transport.methods).toEqual(['POST']);
    // No canonical origin set → request URL wins.
    expect(body.transport.endpoint).toBe('http://mcp.example.test:8080/mcp');
    expect(body.documentation).toBe('http://mcp.example.test:8080/docs');
    expect(body.openapi).toBe('http://mcp.example.test:8080/openapi.json');
  });

  it('prefers canonicalOrigin over the request URL when configured', async () => {
    const { services } = buildServices({
      mcpConfig: { canonicalOrigin: 'https://mcp.skillsregistry.net' },
    });
    const { body } = await getDiscovery(
      services,
      '/mcp.json',
      'http://workers.dev/mcp.json',
    );
    expect(body.transport.endpoint).toBe('https://mcp.skillsregistry.net/mcp');
    expect(body.documentation).toBe('https://mcp.skillsregistry.net/docs');
    expect(body.openapi).toBe('https://mcp.skillsregistry.net/openapi.json');
  });

  it('honors overridden documentationUrl + openapiUrl', async () => {
    const { services } = buildServices({
      mcpConfig: {
        canonicalOrigin: 'https://mcp.skillsregistry.net',
        documentationUrl: 'https://docs.skillsregistry.net/mcp',
        openapiUrl: 'https://api.skillsregistry.net/openapi.json',
      },
    });
    const { body } = await getDiscovery(services, '/mcp.json');
    expect(body.documentation).toBe('https://docs.skillsregistry.net/mcp');
    expect(body.openapi).toBe('https://api.skillsregistry.net/openapi.json');
  });

  it('advertises the auth posture as v1 read-only + tenant hint', async () => {
    const { services } = buildServices();
    const { body } = await getDiscovery(services, '/mcp.json');
    expect(body.auth.model).toBe('none');
    expect(body.auth.tenantHeader).toBe('X-Tenant-Id');
    expect(body.capabilities.tools.listChanged).toBe(false);
  });

  it('advertises all five tools with their schemas', async () => {
    const { services } = buildServices();
    const { body } = await getDiscovery(services, '/mcp.json');
    const names = body.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'get_skill',
      'get_trust_breakdown',
      'list_leaderboard',
      'resolve_composition',
      'search_skills',
    ]);
    // Each tool ships an inputSchema so clients can validate before /mcp.
    for (const tool of body.tools) {
      expect(tool.inputSchema).toBeTruthy();
      expect(typeof tool.description).toBe('string');
    }
  });

  it('serves the same descriptor at /.well-known/mcp.json (RFC 8615 alias)', async () => {
    const { services } = buildServices({
      mcpConfig: { canonicalOrigin: 'https://mcp.skillsregistry.net' },
    });
    const { res: rootRes, body: rootBody } = await getDiscovery(
      services,
      '/mcp.json',
    );
    const { res: wkRes, body: wkBody } = await getDiscovery(
      services,
      '/.well-known/mcp.json',
    );
    expect(rootRes.status).toBe(200);
    expect(wkRes.status).toBe(200);
    // Canonical origin freezes the endpoint URL — the two paths should be
    // byte-for-byte identical.
    expect(wkBody).toEqual(rootBody);
    expect(wkBody.transport.endpoint).toBe('https://mcp.skillsregistry.net/mcp');
  });
});
