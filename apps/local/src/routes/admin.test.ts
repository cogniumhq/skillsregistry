// ══════════════════════════════════════════════════════════════════════════════
// admin.test — T-2.12 admin route handlers.
// ══════════════════════════════════════════════════════════════════════════════
//
// The routing.test.ts suite covers wire-up + air-gap posture. This suite
// covers the "configured mothership" branches, refresh success/failure,
// and degraded /admin/health probes.
//
// ══════════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '@skillsregistry/schema';
import type { AppServices } from '../services.js';
import type { BudgetSnapshot } from '../trust-client.js';
import { UpstreamError } from '../upstream-client/errors.js';
import { createAdminRoutes } from './admin.js';

const ADMIN_TOKEN = 'test-admin-token';
const BEARER = { Authorization: `Bearer ${ADMIN_TOKEN}` };

function mount(services: AppServices, pool: Pool): Hono {
  const app = new Hono();
  app.route('/v1', createAdminRoutes(services, ADMIN_TOKEN, pool));
  return app;
}

function reachablePool(currentVersion: number = SCHEMA_VERSION): Pool {
  return {
    query: async (sql: string) => {
      if (sql.includes('schema_migrations')) {
        return { rows: [{ v: currentVersion }] };
      }
      return { rows: [{ '?column?': 1 }] };
    },
  } as unknown as Pool;
}

function unreachablePool(): Pool {
  return {
    query: async () => {
      throw new Error('db unreachable');
    },
  } as unknown as Pool;
}

function healthyServices(): AppServices {
  return {
    embedder: {
      embed: async () => new Float32Array(4),
      identity: { id: 'nomic-embed@ollama-4', dim: 4 },
    },
    upstream: { isAirGapped: false, circuitState: 'closed' },
    budgetMeter: { getCached: async () => null, refresh: async () => null },
  } as unknown as AppServices;
}

function snapshot(overrides: Partial<BudgetSnapshot> = {}): BudgetSnapshot {
  return {
    tenantId: 'tenant-1',
    plan: 'basic',
    tokensTotal: 10000,
    tokensRemaining: 8500,
    tokensResetAt: '2026-07-01T00:00:00.000Z',
    lowBalance: false,
    cachedAt: '2026-06-28T00:00:00.000Z',
    ...overrides,
  };
}

// ── GET /v1/admin/budget ──────────────────────────────────────────────────

describe('GET /v1/admin/budget', () => {
  it('returns the cached snapshot with mode=configured when upstream is set', async () => {
    const snap = snapshot();
    const services = {
      budgetMeter: { getCached: async () => snap },
      upstream: { isAirGapped: false },
    } as unknown as AppServices;
    const app = mount(services, reachablePool());
    const res = await app.request('/v1/admin/budget', { headers: BEARER });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      budget: BudgetSnapshot;
      mode: string;
    };
    expect(body.mode).toBe('configured');
    expect(body.budget.tenantId).toBe('tenant-1');
    expect(body.budget.tokensRemaining).toBe(8500);
  });

  it('returns budget=null with mode=configured on cold cache (configured but empty)', async () => {
    const services = {
      budgetMeter: { getCached: async () => null },
      upstream: { isAirGapped: false },
    } as unknown as AppServices;
    const app = mount(services, reachablePool());
    const res = await app.request('/v1/admin/budget', { headers: BEARER });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { budget: unknown; mode: string };
    expect(body.budget).toBeNull();
    expect(body.mode).toBe('configured');
  });

  it('returns budget=null with mode=air_gapped in air-gap', async () => {
    const services = {
      budgetMeter: { getCached: async () => null },
      upstream: { isAirGapped: true },
    } as unknown as AppServices;
    const app = mount(services, reachablePool());
    const res = await app.request('/v1/admin/budget', { headers: BEARER });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { budget: unknown; mode: string };
    expect(body.budget).toBeNull();
    expect(body.mode).toBe('air_gapped');
  });
});

// ── POST /v1/admin/budget/refresh ─────────────────────────────────────────

describe('POST /v1/admin/budget/refresh', () => {
  it('returns 503 upstream_not_configured in air-gap without calling meter', async () => {
    let called = false;
    const services = {
      budgetMeter: {
        refresh: async () => {
          called = true;
          return null;
        },
      },
      upstream: { isAirGapped: true },
    } as unknown as AppServices;
    const app = mount(services, reachablePool());
    const res = await app.request('/v1/admin/budget/refresh', {
      method: 'POST',
      headers: BEARER,
    });
    expect(res.status).toBe(503);
    expect(called).toBe(false);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('upstream_not_configured');
  });

  it('returns 200 with the refreshed snapshot on success', async () => {
    const snap = snapshot({ tokensRemaining: 12345 });
    const services = {
      budgetMeter: { refresh: async () => snap },
      upstream: { isAirGapped: false },
    } as unknown as AppServices;
    const app = mount(services, reachablePool());
    const res = await app.request('/v1/admin/budget/refresh', {
      method: 'POST',
      headers: BEARER,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      budget: BudgetSnapshot;
      mode: string;
    };
    expect(body.mode).toBe('configured');
    expect(body.budget.tokensRemaining).toBe(12345);
  });

  it('surfaces UpstreamError from meter.refresh() via the shared mapper', async () => {
    const services = {
      budgetMeter: {
        refresh: async () => {
          throw new UpstreamError(
            'budget_exhausted',
            'no tokens left',
          );
        },
      },
      upstream: { isAirGapped: false },
    } as unknown as AppServices;
    const app = mount(services, reachablePool());
    const res = await app.request('/v1/admin/budget/refresh', {
      method: 'POST',
      headers: BEARER,
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('budget_exhausted');
  });

  it('surfaces an unexpected Error as 500 internal_error', async () => {
    const services = {
      budgetMeter: {
        refresh: async () => {
          throw new Error('boom');
        },
      },
      upstream: { isAirGapped: false },
    } as unknown as AppServices;
    const app = mount(services, reachablePool());
    const res = await app.request('/v1/admin/budget/refresh', {
      method: 'POST',
      headers: BEARER,
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe('internal_error');
    expect(body.error.message).toContain('boom');
  });
});

// ── GET /v1/admin/health ──────────────────────────────────────────────────

describe('GET /v1/admin/health', () => {
  it('returns 200 ok when db + embedder + migrations are healthy (upstream configured, circuit closed)', async () => {
    const services = healthyServices();
    const app = mount(services, reachablePool());
    const res = await app.request('/v1/admin/health', { headers: BEARER });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      checks: {
        db: { status: string };
        embedder: { status: string };
        mothership: { status: string; mode: string; circuitState?: string };
        migrations: { status: string; current: number; required: number };
      };
    };
    expect(body.status).toBe('ok');
    expect(body.checks.db.status).toBe('ok');
    expect(body.checks.embedder.status).toBe('ok');
    expect(body.checks.mothership.status).toBe('ok');
    expect(body.checks.mothership.mode).toBe('configured');
    expect(body.checks.mothership.circuitState).toBe('closed');
    expect(body.checks.migrations.status).toBe('ok');
  });

  it('returns 503 degraded when the DB probe fails', async () => {
    const services = healthyServices();
    const app = mount(services, unreachablePool());
    const res = await app.request('/v1/admin/health', { headers: BEARER });
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      status: string;
      checks: {
        db: { status: string; message?: string };
        migrations: { status: string; message?: string };
      };
    };
    expect(body.status).toBe('degraded');
    expect(body.checks.db.status).toBe('degraded');
    expect(body.checks.db.message).toContain('unreachable');
    // migrations also fails since it reads from the same pool
    expect(body.checks.migrations.status).toBe('degraded');
  });

  it('returns 503 degraded when the embedder probe fails', async () => {
    const services = {
      embedder: {
        embed: async () => {
          throw new Error('ollama down');
        },
        identity: { id: 'nomic-embed@ollama-4', dim: 4 },
      },
      upstream: { isAirGapped: false, circuitState: 'closed' },
      budgetMeter: { getCached: async () => null },
    } as unknown as AppServices;
    const app = mount(services, reachablePool());
    const res = await app.request('/v1/admin/health', { headers: BEARER });
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      status: string;
      checks: {
        embedder: { status: string; identity: string; message?: string };
      };
    };
    expect(body.status).toBe('degraded');
    expect(body.checks.embedder.status).toBe('degraded');
    // identity is still reported so operators know which model was probed
    expect(body.checks.embedder.identity).toBe('nomic-embed@ollama-4');
    expect(body.checks.embedder.message).toContain('ollama down');
  });

  it('returns 503 degraded when the schema is behind SCHEMA_VERSION', async () => {
    const services = healthyServices();
    // Pool returns current = SCHEMA_VERSION - 1
    const app = mount(services, reachablePool(SCHEMA_VERSION - 1));
    const res = await app.request('/v1/admin/health', { headers: BEARER });
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      status: string;
      schemaVersion: { current: number; required: number };
      checks: {
        migrations: { status: string; current: number; required: number };
      };
    };
    expect(body.status).toBe('degraded');
    expect(body.checks.migrations.status).toBe('degraded');
    expect(body.checks.migrations.current).toBe(SCHEMA_VERSION - 1);
    expect(body.checks.migrations.required).toBe(SCHEMA_VERSION);
    expect(body.schemaVersion.current).toBe(SCHEMA_VERSION - 1);
  });

  it('surfaces mothership.status=degraded when the circuit breaker is open (aggregate stays ok)', async () => {
    // Circuit-open is a mothership-side signal; aggregate stays `ok`
    // because the local node is still serving traffic. Operators see the
    // sub-check for the alert.
    const services = {
      embedder: {
        embed: async () => new Float32Array(4),
        identity: { id: 'nomic-embed@ollama-4', dim: 4 },
      },
      upstream: { isAirGapped: false, circuitState: 'open' },
      budgetMeter: { getCached: async () => null },
    } as unknown as AppServices;
    const app = mount(services, reachablePool());
    const res = await app.request('/v1/admin/health', { headers: BEARER });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      checks: {
        mothership: { status: string; circuitState?: string };
      };
    };
    expect(body.status).toBe('ok');
    expect(body.checks.mothership.status).toBe('degraded');
    expect(body.checks.mothership.circuitState).toBe('open');
  });

  it('reports mothership.status=unknown + mode=air_gapped in air-gap', async () => {
    const services = healthyServices();
    // Override the upstream stub to air-gap
    (services as { upstream: { isAirGapped: boolean } }).upstream = {
      isAirGapped: true,
    };
    const app = mount(services, reachablePool());
    const res = await app.request('/v1/admin/health', { headers: BEARER });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      checks: { mothership: { status: string; mode: string } };
    };
    expect(body.status).toBe('ok');
    expect(body.checks.mothership.status).toBe('unknown');
    expect(body.checks.mothership.mode).toBe('air_gapped');
  });
});

// ── Auth guard sanity ──────────────────────────────────────────────────────

describe('auth guard', () => {
  it('rejects /admin/health without a token', async () => {
    const app = mount(healthyServices(), reachablePool());
    const res = await app.request('/v1/admin/health');
    expect(res.status).toBe(401);
  });

  it('rejects /admin/budget/refresh with a wrong token', async () => {
    const app = mount(healthyServices(), reachablePool());
    const res = await app.request('/v1/admin/budget/refresh', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong' },
    });
    expect(res.status).toBe(401);
  });
});

// ── GET /v1/admin/skills (T-3.4) ──────────────────────────────────────────

interface SkillsRow {
  id: string;
  slug: string;
  name: string;
  source: string;
  version: string;
  mothership_publish_status: string | null;
  mothership_url: string | null;
  mothership_published_at: string | null;
  created_at: string | null;
}

function skillsRow(overrides: Partial<SkillsRow> = {}): SkillsRow {
  return {
    id: 'sk_a',
    slug: 'a',
    name: 'A',
    source: 'manual',
    version: '1.0.0',
    mothership_publish_status: null,
    mothership_url: null,
    mothership_published_at: null,
    created_at: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

interface SkillsPoolCall {
  sql: string;
  params: unknown[];
}

/**
 * Pool that returns `rows` for `SELECT ... FROM skills LIMIT`, `[{c: count}]`
 * for the count query, and captures every call for assertion.
 */
function skillsPool(rows: SkillsRow[], count: number): {
  pool: Pool;
  calls: SkillsPoolCall[];
} {
  const calls: SkillsPoolCall[] = [];
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ c: String(count) }] };
      }
      if (sql.includes('FROM skills')) {
        return { rows };
      }
      // schema_migrations fallback for the health probe wire-in (not used here).
      return { rows: [{ v: SCHEMA_VERSION }] };
    },
  } as unknown as Pool;
  return { pool, calls };
}

describe('GET /v1/admin/skills', () => {
  it('returns an empty page with default limit/offset when the table is empty', async () => {
    const { pool } = skillsPool([], 0);
    const app = mount(healthyServices(), pool);
    const res = await app.request('/v1/admin/skills', { headers: BEARER });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      skills: unknown[];
      total: number;
      limit: number;
      offset: number;
    };
    expect(body).toEqual({ skills: [], total: 0, limit: 100, offset: 0 });
  });

  it('projects DB rows to camelCase items with mothership metadata preserved', async () => {
    const rows = [
      skillsRow({
        id: 'sk_a',
        slug: 'a',
        name: 'A',
        mothership_publish_status: 'published',
        mothership_url: 'https://api.skillsregistry.net/v1/skills/sk_a',
        mothership_published_at: '2026-06-01T00:00:00.000Z',
      }),
      skillsRow({ id: 'sk_b', slug: 'b', name: 'B' }),
    ];
    const { pool } = skillsPool(rows, 2);
    const app = mount(healthyServices(), pool);
    const res = await app.request('/v1/admin/skills', { headers: BEARER });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      skills: Array<{
        id: string;
        slug: string;
        mothershipPublishStatus: string | null;
        mothershipUrl: string | null;
        createdAt: string | null;
      }>;
      total: number;
    };
    expect(body.total).toBe(2);
    expect(body.skills).toHaveLength(2);
    expect(body.skills[0]?.slug).toBe('a');
    expect(body.skills[0]?.mothershipPublishStatus).toBe('published');
    expect(body.skills[0]?.mothershipUrl).toBe(
      'https://api.skillsregistry.net/v1/skills/sk_a',
    );
    expect(body.skills[1]?.mothershipPublishStatus).toBeNull();
    expect(body.skills[1]?.mothershipUrl).toBeNull();
    expect(body.skills[1]?.createdAt).toBe('2026-05-01T00:00:00.000Z');
  });

  it('accepts numeric limit / offset query params and passes them to the pool', async () => {
    const { pool, calls } = skillsPool([], 42);
    const app = mount(healthyServices(), pool);
    const res = await app.request('/v1/admin/skills?limit=25&offset=50', {
      headers: BEARER,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { limit: number; offset: number; total: number };
    expect(body.limit).toBe(25);
    expect(body.offset).toBe(50);
    expect(body.total).toBe(42);
    const selectCall = calls.find((c) => c.sql.includes('FROM skills') && !c.sql.includes('COUNT'));
    expect(selectCall?.params).toEqual([25, 50]);
  });

  it('clamps limit above 500 to 500', async () => {
    const { pool, calls } = skillsPool([], 0);
    const app = mount(healthyServices(), pool);
    const res = await app.request('/v1/admin/skills?limit=99999', {
      headers: BEARER,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { limit: number };
    expect(body.limit).toBe(500);
    const selectCall = calls.find((c) => c.sql.includes('FROM skills') && !c.sql.includes('COUNT'));
    expect(selectCall?.params).toEqual([500, 0]);
  });

  it('rejects a non-integer limit with 400 bad_request', async () => {
    const { pool } = skillsPool([], 0);
    const app = mount(healthyServices(), pool);
    const res = await app.request('/v1/admin/skills?limit=abc', {
      headers: BEARER,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('bad_request');
  });

  it('rejects a negative offset with 400 bad_request', async () => {
    const { pool } = skillsPool([], 0);
    const app = mount(healthyServices(), pool);
    const res = await app.request('/v1/admin/skills?offset=-1', {
      headers: BEARER,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('bad_request');
  });

  it('rejects a limit=0 with 400 bad_request (min is 1)', async () => {
    const { pool } = skillsPool([], 0);
    const app = mount(healthyServices(), pool);
    const res = await app.request('/v1/admin/skills?limit=0', {
      headers: BEARER,
    });
    expect(res.status).toBe(400);
  });

  it('returns 500 with internal_error when the DB throws', async () => {
    const app = mount(healthyServices(), unreachablePool());
    const res = await app.request('/v1/admin/skills', { headers: BEARER });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('internal_error');
    expect(body.error.message).toContain('db unreachable');
  });

  it('rejects without a bearer token', async () => {
    const { pool } = skillsPool([], 0);
    const app = mount(healthyServices(), pool);
    const res = await app.request('/v1/admin/skills');
    expect(res.status).toBe(401);
  });

  it('handles Date instances in created_at by rendering ISO strings', async () => {
    const date = new Date('2026-05-01T12:34:56.000Z');
    const rows = [
      skillsRow({
        created_at: date as unknown as string,
        mothership_published_at: date as unknown as string,
      }),
    ];
    const { pool } = skillsPool(rows, 1);
    const app = mount(healthyServices(), pool);
    const res = await app.request('/v1/admin/skills', { headers: BEARER });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      skills: Array<{ createdAt: string | null; mothershipPublishedAt: string | null }>;
    };
    expect(body.skills[0]?.createdAt).toBe('2026-05-01T12:34:56.000Z');
    expect(body.skills[0]?.mothershipPublishedAt).toBe('2026-05-01T12:34:56.000Z');
  });
});
