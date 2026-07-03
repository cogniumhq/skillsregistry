import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../config.js';
import { createApp } from '../index.js';
import type { AppServices } from '../services.js';

const ADMIN_TOKEN = 'test-admin-token';

function buildConfig(overrides: Partial<AppConfig> = {}): AppConfig {
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
    ...overrides,
  };
}

function fakePool(reachable = true): Pool {
  return {
    query: async () => {
      if (!reachable) throw new Error('unreachable');
      return { rows: [{ '?column?': 1 }] };
    },
  } as unknown as Pool;
}

/**
 * Handlers only reference `services` via `void services;` — a bare cast is
 * safe for wiring smoke tests. Real per-endpoint tests land alongside
 * T-2.11 / T-2.12 / T-2.13.
 */
const NULL_SERVICES = {} as AppServices;

/**
 * Minimal `AppServices` that lights up the T-2.13 MCP dispatcher for the
 * initialize / notifications paths — no adapter methods are invoked because
 * those cases never enter `tools/call`. `mcpConfig` mirrors the McpConfig
 * defaults so `serverInfo` in the response is deterministic.
 */
function mcpServices(): AppServices {
  return {
    mcpAdapters: {
      search: {} as never,
      skills: {} as never,
      compositions: {} as never,
      leaderboards: {} as never,
    },
    mcpConfig: {
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
    },
  } as unknown as AppServices;
}

describe('createApp route surface', () => {
  describe('GET /v1/health', () => {
    it('returns 200 + ok when the DB is reachable', async () => {
      const app = createApp(buildConfig(), fakePool(true), NULL_SERVICES);
      const res = await app.request('/v1/health');
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        status: string;
        upstreamConfigured: boolean;
        embedder: string;
        dbReachable: boolean;
      };
      expect(body.status).toBe('ok');
      expect(body.dbReachable).toBe(true);
      expect(body.upstreamConfigured).toBe(false);
      expect(body.embedder).toBe('ollama');
    });

    it('returns 503 + degraded when the DB is unreachable', async () => {
      const app = createApp(buildConfig(), fakePool(false), NULL_SERVICES);
      const res = await app.request('/v1/health');
      expect(res.status).toBe(503);
      const body = (await res.json()) as {
        status: string;
        dbReachable: boolean;
      };
      expect(body.status).toBe('degraded');
      expect(body.dbReachable).toBe(false);
    });

    it('reports upstreamConfigured=true when upstream is set', async () => {
      const app = createApp(
        buildConfig({
          upstream: {
            baseUrl: 'https://api.skillsregistry.net',
            apiKey: 'sk_test',
            tenantId: 'tenant',
            searchFallback: true,
          },
        }),
        fakePool(true),
        NULL_SERVICES,
      );
      const res = await app.request('/v1/health');
      const body = (await res.json()) as { upstreamConfigured: boolean };
      expect(body.upstreamConfigured).toBe(true);
    });
  });

  describe('public routes (T-2.11)', () => {
    it('serves GET /v1/search through the wired T-2.11c handler', async () => {
      const services = {
        searchService: {
          search: async () => ({
            skills: [
              {
                id: 'skill-1',
                name: 'demo',
                slug: 'demo',
                description: 'a demo skill',
                score: 0.9,
                source: 'local',
                category: null,
                publisherKeyId: null,
                signatureVerifiedAt: null,
                signatureFailureReason: null,
              },
            ],
            meta: {
              tier: 1,
              confidence: 0.9,
              signals: [],
              latencyMs: 12,
              source: 'local',
              cached: false,
              deepSearchUsed: false,
            },
          }),
        },
      } as unknown as AppServices;
      const app = createApp(buildConfig(), fakePool(), services);
      const res = await app.request('/v1/search?q=hello');
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        skills: Array<{ slug: string; score: number }>;
        meta: { tier: number; source: string };
      };
      expect(body.skills).toHaveLength(1);
      expect(body.skills[0]!.slug).toBe('demo');
      expect(body.meta.tier).toBe(1);
      expect(body.meta.source).toBe('local');
    });

    it('rejects GET /v1/search with missing q as 400', async () => {
      const app = createApp(buildConfig(), fakePool(), NULL_SERVICES);
      const res = await app.request('/v1/search');
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('bad_request');
    });

    it('serves GET /v1/skills/:id through the wired T-2.11b handler', async () => {
      // Air-gap posture — SkillsClient collapses the local-miss +
      // upstream_not_configured combo to `not_found` so callers see a
      // truthful 404 instead of a misleading 503.
      const services = {
        skillsClient: {
          getSkill: async () => {
            const { UpstreamError } = await import(
              '../upstream-client/errors.js'
            );
            throw new UpstreamError('not_found', 'no local skill with id abc');
          },
        },
      } as unknown as AppServices;
      const app = createApp(buildConfig(), fakePool(), services);
      const res = await app.request('/v1/skills/abc');
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('not_found');
    });

    it('serves POST /v1/skills through the wired T-2.11b handler', async () => {
      const services = {
        skillsClient: {
          publishLocal: async () => ({
            id: 'local-uuid-1',
            slug: 'demo-skill',
            version: '1.0.0',
            status: 'published',
          }),
        },
      } as unknown as AppServices;
      const app = createApp(buildConfig(), fakePool(), services);
      const res = await app.request('/v1/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manifest: {
            name: 'demo-skill',
            slug: 'demo-skill',
            version: '1.0.0',
            source: 'publish',
            execution_layer: 'api',
          },
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string; slug: string };
      expect(body.id).toBe('local-uuid-1');
      expect(body.slug).toBe('demo-skill');
    });

    it('rejects POST /v1/skills with an invalid body', async () => {
      const app = createApp(buildConfig(), fakePool(), NULL_SERVICES);
      const res = await app.request('/v1/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest: {} }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('bad_request');
    });

    it('rejects POST /v1/skills with non-JSON body', async () => {
      const app = createApp(buildConfig(), fakePool(), NULL_SERVICES);
      const res = await app.request('/v1/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('bad_request');
    });

    it('serves GET /v1/leaderboards/:kind through the wired T-2.11a proxy', async () => {
      // Air-gap posture — UpstreamClient throws `upstream_not_configured`
      // → 503. Confirms the handler is wired end-to-end (not the 501 stub)
      // and the code taxonomy reaches the response body.
      const services = {
        upstream: {
          getLeaderboard: async () => {
            const { UpstreamError } = await import(
              '../upstream-client/errors.js'
            );
            throw new UpstreamError(
              'upstream_not_configured',
              'Mothership is not configured (air-gap mode)',
            );
          },
        },
      } as unknown as AppServices;
      const app = createApp(buildConfig(), fakePool(), services);
      const res = await app.request('/v1/leaderboards/trust');
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('upstream_not_configured');
    });

    it('rejects GET /v1/leaderboards/:kind with a non-integer limit', async () => {
      const app = createApp(buildConfig(), fakePool(), NULL_SERVICES);
      const res = await app.request('/v1/leaderboards/trust?limit=abc');
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('bad_request');
    });

    it('serves POST /v1/trust/score through the wired T-2.11a handler', async () => {
      // Air-gap posture — TrustClient re-throws UpstreamError from the
      // underlying UpstreamClient. Confirms wiring + body validation +
      // error mapping.
      const services = {
        trustClient: {
          score: async () => {
            const { UpstreamError } = await import(
              '../upstream-client/errors.js'
            );
            throw new UpstreamError(
              'upstream_not_configured',
              'Mothership is not configured (air-gap mode)',
            );
          },
        },
      } as unknown as AppServices;
      const app = createApp(buildConfig(), fakePool(), services);
      const res = await app.request('/v1/trust/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill_id: 'skill-1' }),
      });
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('upstream_not_configured');
    });

    it('rejects POST /v1/trust/score with an invalid body', async () => {
      const app = createApp(buildConfig(), fakePool(), NULL_SERVICES);
      const res = await app.request('/v1/trust/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('bad_request');
    });

    it('rejects POST /v1/trust/score with non-JSON body', async () => {
      const app = createApp(buildConfig(), fakePool(), NULL_SERVICES);
      const res = await app.request('/v1/trust/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('bad_request');
    });
  });

  describe('admin routes (T-2.9 / T-2.10 / T-2.12)', () => {
    it('rejects /v1/admin/budget without a token', async () => {
      const app = createApp(buildConfig(), fakePool(), NULL_SERVICES);
      const res = await app.request('/v1/admin/budget');
      expect(res.status).toBe(401);
    });

    it('rejects /v1/admin/budget with a wrong token', async () => {
      const app = createApp(buildConfig(), fakePool(), NULL_SERVICES);
      const res = await app.request('/v1/admin/budget', {
        headers: { Authorization: 'Bearer nope' },
      });
      expect(res.status).toBe(401);
    });

    it('serves /v1/admin/budget through the wired T-2.12 handler', async () => {
      // Air-gap posture — BudgetMeter.getCached() returns null; the handler
      // still returns 200 with `mode: 'air_gapped'` so operators can tell a
      // cold cache from air-gap. Confirms the handler is wired end-to-end
      // (not the 501 stub) and threads through the meter.
      const services = {
        budgetMeter: { getCached: async () => null },
        upstream: { isAirGapped: true },
      } as unknown as AppServices;
      const app = createApp(buildConfig(), fakePool(), services);
      const res = await app.request('/v1/admin/budget', {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        budget: unknown;
        mode: string;
      };
      expect(body.budget).toBeNull();
      expect(body.mode).toBe('air_gapped');
    });

    it('serves POST /v1/admin/budget/refresh through the wired T-2.12 handler', async () => {
      // Air-gap posture — the handler short-circuits with 503 without
      // touching the meter. Confirms the wire-up (not the 501 stub).
      const services = {
        budgetMeter: {
          refresh: async () => {
            throw new Error('should not be called in air-gap');
          },
        },
        upstream: { isAirGapped: true },
      } as unknown as AppServices;
      const app = createApp(buildConfig(), fakePool(), services);
      const res = await app.request('/v1/admin/budget/refresh', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('upstream_not_configured');
    });

    it('serves GET /v1/admin/health through the wired T-2.12 handler', async () => {
      // All probes should return `ok` when DB, embedder are reachable and
      // migrations are at HEAD. Air-gap → mothership.status = 'unknown'
      // but does not gate aggregate `ok`.
      const { SCHEMA_VERSION } = await import('@skillsregistry/schema');
      const pool = {
        query: async (sql: string) => {
          if (sql.includes('schema_migrations')) {
            return { rows: [{ v: SCHEMA_VERSION }] };
          }
          return { rows: [{ '?column?': 1 }] };
        },
      } as unknown as Pool;
      const services = {
        embedder: {
          embed: async () => new Float32Array(4),
          identity: { id: 'test-embedder@ollama-4', dim: 4 },
        },
        upstream: { isAirGapped: true, circuitState: 'closed' },
      } as unknown as AppServices;
      const app = createApp(buildConfig(), pool, services);
      const res = await app.request('/v1/admin/health', {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        status: string;
        checks: {
          db: { status: string };
          embedder: { status: string; identity: string };
          mothership: { status: string; mode: string };
          migrations: { status: string; current: number; required: number };
        };
      };
      expect(body.status).toBe('ok');
      expect(body.checks.db.status).toBe('ok');
      expect(body.checks.embedder.status).toBe('ok');
      expect(body.checks.embedder.identity).toBe('test-embedder@ollama-4');
      expect(body.checks.mothership.status).toBe('unknown');
      expect(body.checks.mothership.mode).toBe('air_gapped');
      expect(body.checks.migrations.status).toBe('ok');
      expect(body.checks.migrations.current).toBe(SCHEMA_VERSION);
      expect(body.checks.migrations.required).toBe(SCHEMA_VERSION);
    });

    it('serves POST /v1/migrate/publish through the wired T-2.10 handler', async () => {
      // Air-gap posture — no upstream configured — so the wired handler
      // reaches `UpstreamClient.publish` which throws
      // `UpstreamError('upstream_not_configured')` → 503. Confirms the
      // handler is wired end-to-end (not the 501 stub) and the code taxonomy
      // reaches the response body.
      const services = {
        migrationClient: {
          publish: async () => {
            const { UpstreamError } = await import(
              '../upstream-client/errors.js'
            );
            throw new UpstreamError(
              'upstream_not_configured',
              'Mothership is not configured (air-gap mode)',
            );
          },
        },
      } as unknown as AppServices;
      const app = createApp(buildConfig(), fakePool(), services);
      const res = await app.request('/v1/migrate/publish?skill_id=x', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.status).toBe(503);
      const body = (await res.json()) as {
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe('upstream_not_configured');
    });

    it('rejects POST /v1/migrate/publish without a skill_id', async () => {
      const app = createApp(buildConfig(), fakePool(), NULL_SERVICES);
      const res = await app.request('/v1/migrate/publish', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('bad_request');
    });

    it('rejects /v1/migrate/publish without a token', async () => {
      const app = createApp(buildConfig(), fakePool(), NULL_SERVICES);
      const res = await app.request('/v1/migrate/publish?skill_id=x', {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('MCP routes (T-2.13 / T-2.14)', () => {
    it('serves POST /mcp through the wired T-2.13 dispatcher (initialize)', async () => {
      const services = mcpServices();
      const app = createApp(buildConfig(), fakePool(), services);
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-03-26' },
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        jsonrpc: string;
        id: number;
        result: {
          protocolVersion: string;
          capabilities: { tools: { listChanged: boolean } };
          serverInfo: { name: string; version: string };
        };
      };
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe(1);
      expect(body.result.protocolVersion).toBe('2025-03-26');
      expect(body.result.serverInfo.name).toBe('skillsregistry-local');
      expect(body.result.serverInfo.version).toBe('0.1.0');
    });

    it('POST /mcp returns a JSON-RPC parse error on malformed JSON', async () => {
      const services = mcpServices();
      const app = createApp(buildConfig(), fakePool(), services);
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        jsonrpc: string;
        id: unknown;
        error: { code: number; message: string };
      };
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBeNull();
      expect(body.error.code).toBe(-32700);
    });

    it('POST /mcp returns 202 on a notification (no id)', async () => {
      const services = mcpServices();
      const app = createApp(buildConfig(), fakePool(), services);
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      });
      expect(res.status).toBe(202);
    });

    it('serves GET /mcp.json as the T-2.14 discovery descriptor', async () => {
      const services = mcpServices();
      const app = createApp(buildConfig(), fakePool(), services);
      const res = await app.request('/mcp.json');
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        schemaVersion: string;
        protocolVersion: string;
        serverInfo: { name: string; version: string };
        transport: { type: string; endpoint: string; methods: string[] };
        tools: Array<{ name: string }>;
      };
      expect(body.schemaVersion).toBe('1');
      expect(body.protocolVersion).toBe('2025-03-26');
      expect(body.serverInfo.name).toBe('skillsregistry-local');
      expect(body.transport.type).toBe('streamable-http');
      expect(body.transport.methods).toEqual(['POST']);
      expect(body.transport.endpoint.endsWith('/mcp')).toBe(true);
      const toolNames = body.tools.map((t) => t.name).sort();
      expect(toolNames).toEqual([
        'get_skill',
        'get_trust_breakdown',
        'list_leaderboard',
        'resolve_composition',
        'search_skills',
      ]);
    });

    it('serves GET /.well-known/mcp.json with the same descriptor', async () => {
      const services = mcpServices();
      const app = createApp(buildConfig(), fakePool(), services);
      const res = await app.request('/.well-known/mcp.json');
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        schemaVersion: string;
        transport: { endpoint: string };
      };
      expect(body.schemaVersion).toBe('1');
      expect(body.transport.endpoint.endsWith('/mcp')).toBe(true);
    });
  });

  describe('unknown paths', () => {
    it('returns 404 for unmounted routes', async () => {
      const app = createApp(buildConfig(), fakePool(), NULL_SERVICES);
      const res = await app.request('/does-not-exist');
      expect(res.status).toBe(404);
    });
  });
});
