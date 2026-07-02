// ══════════════════════════════════════════════════════════════════════════════
// Admin routes — /v1/admin/* and /v1/migrate/*
// ══════════════════════════════════════════════════════════════════════════════
//
// Sub-app mounted at `/v1` (so the migration door at /v1/migrate/publish
// shares the guard). Every route under this sub-app requires
// `Authorization: Bearer <ADMIN_TOKEN>` via `adminAuth(...)` middleware.
//
// Handler surface:
//
//   GET  /v1/admin/budget          — cached mothership budget snapshot
//   POST /v1/admin/budget/refresh  — force-refresh from mothership
//   GET  /v1/admin/health          — deep health (DB, Ollama, upstream,
//                                     migration state)
//   POST /v1/migrate/publish       — single-skill push-up (T-2.10)
//
// `pool` is threaded as a separate arg — mirrors `createApp(config, pool,
// services)` — because `AppServices` does not carry the pg pool and the
// deep-health handler needs to run `SELECT 1` + read the migration table
// directly.
//
// ══════════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import type { Pool } from 'pg';
import { SCHEMA_VERSION } from '@skillsregistry/schema';
import { upstreamErrorToResponse } from '../http/upstream-response.js';
import { adminAuth } from '../middleware/index.js';
import type { AppServices } from '../services.js';
import type { BudgetSnapshot } from '../trust-client.js';
import type { CircuitState } from '@skillsregistry/domain/resilience';
import { UpstreamError } from '../upstream-client/errors.js';

// ── Response shapes ──────────────────────────────────────────────────────────

interface BudgetResponseBody {
  budget: BudgetSnapshot | null;
  mode: 'configured' | 'air_gapped';
}

type CheckStatus = 'ok' | 'degraded' | 'unknown';

interface DbCheck {
  status: 'ok' | 'degraded';
  message?: string;
}

interface EmbedderCheck {
  status: 'ok' | 'degraded';
  identity?: string;
  message?: string;
}

interface MothershipCheck {
  status: CheckStatus;
  mode: 'configured' | 'air_gapped';
  circuitState?: CircuitState;
}

interface MigrationsCheck {
  status: 'ok' | 'degraded';
  current: number;
  required: number;
  message?: string;
}

interface HealthResponseBody {
  status: 'ok' | 'degraded';
  schemaVersion: { current: number; required: number };
  checks: {
    db: DbCheck;
    embedder: EmbedderCheck;
    mothership: MothershipCheck;
    migrations: MigrationsCheck;
  };
}

/**
 * Build the admin sub-app. The auth middleware is attached inside so
 * mounting is a one-liner in `createApp()`.
 */
export function createAdminRoutes(
  services: AppServices,
  adminToken: string,
  pool: Pool,
): Hono {
  const app = new Hono();
  // Scoped to admin + migrate paths so the guard does not leak onto sibling
  // public routes when this sub-app shares the /v1 mount prefix.
  const guard = adminAuth({ token: adminToken });
  app.use('/admin/*', guard);
  app.use('/migrate/*', guard);

  // ── GET /v1/admin/budget ───────────────────────────────────────────────
  //
  // Reads whatever the BudgetMeter has cached in kv_store. `getCached()`
  // never throws — it returns null on missing key, malformed payload, KV
  // read failure, or air-gap. `mode` disambiguates a null-because-air-gap
  // from a null-because-cache-cold reading so operators can tell them apart
  // without probing config.
  app.get('/admin/budget', async (c) => {
    const snapshot = await services.budgetMeter.getCached();
    const mode: BudgetResponseBody['mode'] = services.upstream.isAirGapped
      ? 'air_gapped'
      : 'configured';
    const body: BudgetResponseBody = { budget: snapshot, mode };
    return c.json(body, 200);
  });

  // ── POST /v1/admin/budget/refresh ──────────────────────────────────────
  //
  // Force-refresh from mothership. `refresh()` throws through so operators
  // see the failure (unlike the cron callback, which swallows). In air-gap
  // mode the meter returns null without an upstream call — surface a 503
  // so callers cannot mistake it for "budget = null but node is healthy".
  app.post('/admin/budget/refresh', async (c) => {
    if (services.upstream.isAirGapped) {
      return c.json(
        {
          error: {
            code: 'upstream_not_configured' as const,
            message:
              'Mothership is not configured (air-gap mode); nothing to refresh.',
          },
        },
        503,
      );
    }
    try {
      const snapshot = await services.budgetMeter.refresh();
      const body: BudgetResponseBody = {
        budget: snapshot,
        mode: 'configured',
      };
      return c.json(body, 200);
    } catch (err) {
      if (err instanceof UpstreamError) {
        const { status, body } = upstreamErrorToResponse(err);
        return c.json(body, status as Parameters<typeof c.json>[1]);
      }
      const message = err instanceof Error ? err.message : String(err);
      return c.json(
        {
          error: {
            code: 'internal_error' as const,
            message: `budget refresh failed: ${message}`,
          },
        },
        500,
      );
    }
  });

  // ── GET /v1/admin/health ───────────────────────────────────────────────
  //
  // Deep health across four subsystems:
  //
  //   1. DB          — active `SELECT 1` via the pg pool
  //   2. Embedder    — active `.embed('.')` probe of Ollama
  //   3. Mothership  — passive read of `UpstreamClient.isAirGapped` +
  //                    `.circuitState`. Skips the active call so the
  //                    /admin/health poll does not burn mothership budget.
  //   4. Migrations  — `SELECT MAX(version)` vs `SCHEMA_VERSION` from
  //                    `@skillsregistry/schema`.
  //
  // Aggregate `status` is `ok` only when db + embedder + migrations are all
  // `ok`. Mothership does not gate `ok` — air-gap mode is a valid healthy
  // posture — but its own sub-check surfaces the circuit state.
  //
  // Returns 200 when aggregate is `ok`, 503 when `degraded`. This makes
  // the endpoint usable directly as a container probe.
  app.get('/admin/health', async (c) => {
    const [dbCheck, embedderCheck, migrationsCheck] = await Promise.all([
      probeDb(pool),
      probeEmbedder(services),
      probeMigrations(pool),
    ]);
    const mothershipCheck = probeMothership(services);
    const aggregate: HealthResponseBody['status'] =
      dbCheck.status === 'ok' &&
      embedderCheck.status === 'ok' &&
      migrationsCheck.status === 'ok'
        ? 'ok'
        : 'degraded';
    const body: HealthResponseBody = {
      status: aggregate,
      schemaVersion: {
        current: migrationsCheck.current,
        required: migrationsCheck.required,
      },
      checks: {
        db: dbCheck,
        embedder: embedderCheck,
        mothership: mothershipCheck,
        migrations: migrationsCheck,
      },
    };
    return c.json(body, aggregate === 'ok' ? 200 : 503);
  });

  // ── POST /v1/migrate/publish (T-2.10) ──────────────────────────────────
  //
  // Migration door. Reads `?skill_id=<uuid>`, delegates to the migration
  // client, and surfaces `UpstreamError` codes verbatim in the response
  // body. Handler stays thin — the whole promotion pipeline (local lookup
  // → manifest build → upstream.publish → persist) lives in
  // `migrationClient.publish(...)`.
  app.post('/migrate/publish', async (c) => {
    const skillId = c.req.query('skill_id');
    if (skillId === undefined || skillId.trim() === '') {
      return c.json(
        {
          error: {
            code: 'bad_request' as const,
            message: 'skill_id query parameter is required',
          },
        },
        400,
      );
    }
    try {
      const response = await services.migrationClient.publish(skillId);
      return c.json(response, 200);
    } catch (err) {
      if (err instanceof UpstreamError) {
        const { status, body } = upstreamErrorToResponse(err);
        return c.json(body, status as Parameters<typeof c.json>[1]);
      }
      // Unexpected local failure — bubble as 500 without leaking internals.
      const message = err instanceof Error ? err.message : String(err);
      return c.json(
        {
          error: {
            code: 'internal_error' as const,
            message: `migration failed: ${message}`,
          },
        },
        500,
      );
    }
  });

  return app;
}

// ── Health probes ────────────────────────────────────────────────────────────
//
// Each probe returns a check block; errors surface as `degraded` with the
// error message so operators can diagnose without tailing app logs.

async function probeDb(pool: Pool): Promise<DbCheck> {
  try {
    await pool.query('SELECT 1');
    return { status: 'ok' };
  } catch (err) {
    return {
      status: 'degraded',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeEmbedder(services: AppServices): Promise<EmbedderCheck> {
  try {
    // A single-character probe is enough — we only need to know the
    // Ollama server responded with a well-formed embedding. Actual result
    // is discarded.
    await services.embedder.embed('.');
    return { status: 'ok', identity: services.embedder.identity.id };
  } catch (err) {
    return {
      status: 'degraded',
      identity: services.embedder.identity.id,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function probeMothership(services: AppServices): MothershipCheck {
  if (services.upstream.isAirGapped) {
    return { status: 'unknown', mode: 'air_gapped' };
  }
  const circuitState = services.upstream.circuitState;
  // Passive read: healthy when circuit is closed (no recent failures);
  // otherwise `degraded` so /admin/health surfaces circuit-open before
  // the operator hits a real endpoint. We do NOT call getBudget() here —
  // burning mothership budget on every probe is a footgun.
  return {
    status: circuitState === 'closed' ? 'ok' : 'degraded',
    mode: 'configured',
    circuitState,
  };
}

async function probeMigrations(pool: Pool): Promise<MigrationsCheck> {
  try {
    const { rows } = await pool.query(
      'SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations',
    );
    const row = (rows[0] as { v: number | string } | undefined) ?? { v: 0 };
    const current =
      typeof row.v === 'string' ? Number.parseInt(row.v, 10) : row.v;
    const status: MigrationsCheck['status'] =
      current >= SCHEMA_VERSION ? 'ok' : 'degraded';
    const check: MigrationsCheck = {
      status,
      current,
      required: SCHEMA_VERSION,
    };
    if (status === 'degraded') {
      check.message = `db at v${current}, sdk requires v${SCHEMA_VERSION}`;
    }
    return check;
  } catch (err) {
    return {
      status: 'degraded',
      current: 0,
      required: SCHEMA_VERSION,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
