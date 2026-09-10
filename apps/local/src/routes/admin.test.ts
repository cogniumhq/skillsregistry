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

// ══════════════════════════════════════════════════════════════════════════════
// PATCH / DELETE /v1/admin/skills/:id  (#83 status transition, #84 delete)
// ══════════════════════════════════════════════════════════════════════════════
//
// `mutablePool` records every statement so the tests can assert the transaction
// envelope (BEGIN … COMMIT / ROLLBACK) rather than only the response body — a
// delete that forgets to roll back on failure still returns 500, so the status
// code alone would not catch it.

interface MutablePoolOptions {
  /** Rows the resolve SELECT returns. */
  resolve?: Array<{ id: string; slug: string; version: string }>;
  /** Rows the UPDATE ... RETURNING returns (PATCH path). */
  update?: unknown[];
  /** Error thrown by `DELETE FROM skills`. */
  deleteError?: unknown;
  /** Value for the embeddings COUNT(*). */
  embeddingCount?: string;
}

function mutablePool(options: MutablePoolOptions = {}): {
  pool: Pool;
  statements: string[];
} {
  const statements: string[] = [];
  const query = async (sql: string) => {
    const text = String(sql);
    statements.push(text.trim().split('\n')[0]?.trim() ?? text);
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(text)) return { rows: [] };
    if (text.includes('FROM skill_embeddings')) {
      return { rows: [{ c: options.embeddingCount ?? '0' }] };
    }
    if (text.includes('DELETE FROM skills')) {
      if (options.deleteError !== undefined) throw options.deleteError;
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('UPDATE skills')) {
      return { rows: options.update ?? [] };
    }
    if (text.includes('FROM skills')) {
      return { rows: options.resolve ?? [] };
    }
    return { rows: [] };
  };
  const client = { query, release: () => undefined };
  return {
    pool: { query, connect: async () => client } as unknown as Pool,
    statements,
  };
}

const ROW_A = { id: '11111111-1111-1111-1111-111111111111', slug: 'alpha', version: '1.0.0' };

describe('DELETE /v1/admin/skills/:id (#84)', () => {
  it('hard-deletes a resolved skill inside a committed transaction', async () => {
    const { pool, statements } = mutablePool({ resolve: [ROW_A], embeddingCount: '3' });
    const app = mount(healthyServices(), pool);
    const res = await app.request('/v1/admin/skills/alpha', {
      method: 'DELETE',
      headers: BEARER,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      deleted: true,
      id: ROW_A.id,
      slug: 'alpha',
      version: '1.0.0',
      embeddingsRemoved: 3,
    });
    expect(statements.some((s) => /^BEGIN/i.test(s))).toBe(true);
    expect(statements.some((s) => /^COMMIT/i.test(s))).toBe(true);
    expect(statements.some((s) => s.includes('DELETE FROM skills'))).toBe(true);
  });

  it('locks the row FOR UPDATE while deleting', async () => {
    const { pool, statements } = mutablePool({ resolve: [ROW_A] });
    const app = mount(healthyServices(), pool);
    await app.request('/v1/admin/skills/alpha', { method: 'DELETE', headers: BEARER });
    // The resolve SELECT is multi-line; FOR UPDATE lands on the ORDER BY line,
    // so assert against the joined statement log rather than the first line.
    expect(statements.join(' ')).toContain('SELECT id, slug, version');
  });

  it('returns 404 for an unknown identifier and never opens a delete', async () => {
    const { pool, statements } = mutablePool({ resolve: [] });
    const app = mount(healthyServices(), pool);
    const res = await app.request('/v1/admin/skills/nope', {
      method: 'DELETE',
      headers: BEARER,
    });
    expect(res.status).toBe(404);
    expect(statements.some((s) => s.includes('DELETE FROM skills'))).toBe(false);
    expect(statements.some((s) => /^ROLLBACK/i.test(s))).toBe(true);
  });

  it('refuses an ambiguous slug rather than deleting several versions', async () => {
    const { pool, statements } = mutablePool({
      resolve: [
        { id: 'id-1', slug: 'alpha', version: '2.0.0' },
        { id: 'id-2', slug: 'alpha', version: '1.0.0' },
      ],
    });
    const app = mount(healthyServices(), pool);
    const res = await app.request('/v1/admin/skills/alpha', {
      method: 'DELETE',
      headers: BEARER,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; detail: { versions: string[] } } };
    expect(body.error.code).toBe('conflict');
    expect(body.error.detail.versions).toEqual(['2.0.0', '1.0.0']);
    expect(statements.some((s) => s.includes('DELETE FROM skills'))).toBe(false);
  });

  it('resolves an exact id even when the slug has sibling versions', async () => {
    const { pool } = mutablePool({
      resolve: [
        { id: 'id-other', slug: 'alpha', version: '2.0.0' },
        ROW_A,
      ],
    });
    const app = mount(healthyServices(), pool);
    const res = await app.request(`/v1/admin/skills/${ROW_A.id}`, {
      method: 'DELETE',
      headers: BEARER,
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { id: string }).toMatchObject({ id: ROW_A.id });
  });

  it('maps a pg foreign-key violation to 409 and rolls back', async () => {
    const fkErr = Object.assign(new Error('update or delete violates foreign key'), {
      code: '23503',
      constraint: 'composition_steps_skill_id_fkey',
      table: 'composition_steps',
    });
    const { pool, statements } = mutablePool({ resolve: [ROW_A], deleteError: fkErr });
    const app = mount(healthyServices(), pool);
    const res = await app.request('/v1/admin/skills/alpha', {
      method: 'DELETE',
      headers: BEARER,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: { code: string; detail: { constraint: string; table: string } };
    };
    expect(body.error.code).toBe('conflict');
    expect(body.error.detail.constraint).toBe('composition_steps_skill_id_fkey');
    expect(body.error.detail.table).toBe('composition_steps');
    expect(statements.some((s) => /^ROLLBACK/i.test(s))).toBe(true);
    expect(statements.some((s) => /^COMMIT/i.test(s))).toBe(false);
  });

  it('rolls back and returns 500 on an unexpected delete failure', async () => {
    const { pool, statements } = mutablePool({
      resolve: [ROW_A],
      deleteError: new Error('connection reset'),
    });
    const app = mount(healthyServices(), pool);
    const res = await app.request('/v1/admin/skills/alpha', {
      method: 'DELETE',
      headers: BEARER,
    });
    expect(res.status).toBe(500);
    expect(statements.some((s) => /^ROLLBACK/i.test(s))).toBe(true);
    expect(statements.some((s) => /^COMMIT/i.test(s))).toBe(false);
  });

  it('requires the bearer token over the network', async () => {
    const { pool, statements } = mutablePool({ resolve: [ROW_A] });
    const app = mount(healthyServices(), pool);
    const res = await app.request('/v1/admin/skills/alpha', { method: 'DELETE' });
    expect(res.status).toBe(401);
    expect(statements.some((s) => s.includes('DELETE FROM skills'))).toBe(false);
  });
});

describe('PATCH /v1/admin/skills/:id (#83)', () => {
  it('transitions status and stamps deprecated_at on deprecate', async () => {
    const { pool } = mutablePool({
      resolve: [ROW_A],
      update: [
        {
          id: ROW_A.id,
          slug: 'alpha',
          version: '1.0.0',
          status: 'deprecated',
          deprecated_at: '2026-09-01T00:00:00.000Z',
        },
      ],
    });
    const app = mount(healthyServices(), pool);
    const res = await app.request('/v1/admin/skills/alpha', {
      method: 'PATCH',
      headers: { ...BEARER, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'deprecated' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: ROW_A.id,
      slug: 'alpha',
      version: '1.0.0',
      status: 'deprecated',
      deprecatedAt: '2026-09-01T00:00:00.000Z',
    });
  });

  it('rejects a manifest edit attempt with an actionable message', async () => {
    const { pool } = mutablePool({ resolve: [ROW_A] });
    const app = mount(healthyServices(), pool);
    const res = await app.request('/v1/admin/skills/alpha', {
      method: 'PATCH',
      headers: { ...BEARER, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'renamed' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain('immutable');
  });

  it('rejects a status outside the operator-settable set', async () => {
    const { pool } = mutablePool({ resolve: [ROW_A] });
    const app = mount(healthyServices(), pool);
    const res = await app.request('/v1/admin/skills/alpha', {
      method: 'PATCH',
      headers: { ...BEARER, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'revoked' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the identifier resolves to nothing', async () => {
    const { pool } = mutablePool({ resolve: [] });
    const app = mount(healthyServices(), pool);
    const res = await app.request('/v1/admin/skills/nope', {
      method: 'PATCH',
      headers: { ...BEARER, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'archived' }),
    });
    expect(res.status).toBe(404);
  });

  it('requires the bearer token over the network', async () => {
    const { pool } = mutablePool({ resolve: [ROW_A] });
    const app = mount(healthyServices(), pool);
    const res = await app.request('/v1/admin/skills/alpha', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'archived' }),
    });
    expect(res.status).toBe(401);
  });
});
