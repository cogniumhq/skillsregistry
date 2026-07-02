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
    embedder: {
      kind: 'ollama',
      url: 'http://localhost:11434',
      model: 'nomic-embed-text',
    },
    upstream: null,
    log: { level: 'info' },
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
    it('mounts GET /v1/search as a 501 stub', async () => {
      const app = createApp(buildConfig(), fakePool(), NULL_SERVICES);
      const res = await app.request('/v1/search?q=hello');
      expect(res.status).toBe(501);
      const body = (await res.json()) as {
        error: { code: string; task: string };
      };
      expect(body.error.code).toBe('not_implemented');
      expect(body.error.task).toBe('T-2.11');
    });

    it('mounts GET /v1/skills/:id as a 501 stub', async () => {
      const app = createApp(buildConfig(), fakePool(), NULL_SERVICES);
      const res = await app.request('/v1/skills/abc');
      expect(res.status).toBe(501);
    });

    it('mounts POST /v1/skills as a 501 stub', async () => {
      const app = createApp(buildConfig(), fakePool(), NULL_SERVICES);
      const res = await app.request('/v1/skills', { method: 'POST' });
      expect(res.status).toBe(501);
    });

    it('mounts GET /v1/leaderboards/:kind as a 501 stub', async () => {
      const app = createApp(buildConfig(), fakePool(), NULL_SERVICES);
      const res = await app.request('/v1/leaderboards/trust');
      expect(res.status).toBe(501);
    });

    it('mounts POST /v1/trust/score as a 501 stub', async () => {
      const app = createApp(buildConfig(), fakePool(), NULL_SERVICES);
      const res = await app.request('/v1/trust/score', { method: 'POST' });
      expect(res.status).toBe(501);
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

    it('serves /v1/admin/budget as a 501 stub with a valid token', async () => {
      const app = createApp(buildConfig(), fakePool(), NULL_SERVICES);
      const res = await app.request('/v1/admin/budget', {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.status).toBe(501);
      const body = (await res.json()) as { error: { task: string } };
      expect(body.error.task).toBe('T-2.12');
    });

    it('serves POST /v1/admin/budget/refresh as a 501 stub', async () => {
      const app = createApp(buildConfig(), fakePool(), NULL_SERVICES);
      const res = await app.request('/v1/admin/budget/refresh', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.status).toBe(501);
    });

    it('serves GET /v1/admin/health as a 501 stub', async () => {
      const app = createApp(buildConfig(), fakePool(), NULL_SERVICES);
      const res = await app.request('/v1/admin/health', {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.status).toBe(501);
    });

    it('serves POST /v1/migrate/publish as a 501 stub with the T-2.10 marker', async () => {
      const app = createApp(buildConfig(), fakePool(), NULL_SERVICES);
      const res = await app.request('/v1/migrate/publish?skill_id=x', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.status).toBe(501);
      const body = (await res.json()) as { error: { task: string } };
      expect(body.error.task).toBe('T-2.10');
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
    it('mounts POST /mcp as a 501 stub', async () => {
      const app = createApp(buildConfig(), fakePool(), NULL_SERVICES);
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(501);
      const body = (await res.json()) as { error: { task: string } };
      expect(body.error.task).toBe('T-2.13');
    });

    it('mounts GET /mcp.json as a 501 stub', async () => {
      const app = createApp(buildConfig(), fakePool(), NULL_SERVICES);
      const res = await app.request('/mcp.json');
      expect(res.status).toBe(501);
      const body = (await res.json()) as { error: { task: string } };
      expect(body.error.task).toBe('T-2.14');
    });

    it('mounts GET /.well-known/mcp.json as a 501 stub', async () => {
      const app = createApp(buildConfig(), fakePool(), NULL_SERVICES);
      const res = await app.request('/.well-known/mcp.json');
      expect(res.status).toBe(501);
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
