// ══════════════════════════════════════════════════════════════════════════════
// Admin routes — /v1/admin/* and /v1/migrate/*
// ══════════════════════════════════════════════════════════════════════════════
//
// Sub-app mounted at `/v1` (so the migration door at /v1/migrate/publish
// shares the guard). Every route under this sub-app requires
// `Authorization: Bearer <ADMIN_TOKEN>` via `adminAuth(...)` middleware.
//
// Handler surface (per T-2.12):
//
//   GET  /v1/admin/budget          — cached mothership budget
//   POST /v1/admin/budget/refresh  — force-refresh from mothership
//   GET  /v1/admin/health          — deep health (DB, Ollama, upstream)
//   POST /v1/migrate/publish       — single-skill push-up (T-2.10)
//
// Handlers ship in T-2.10 / T-2.12. This module ships 501 stubs so
// admin-auth + route wiring can be exercised end-to-end.
//
// ══════════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { upstreamErrorToResponse } from '../http/upstream-response.js';
import { adminAuth } from '../middleware/index.js';
import type { AppServices } from '../services.js';
import { UpstreamError } from '../upstream-client/errors.js';

/**
 * Build the admin sub-app. The auth middleware is attached inside so
 * mounting is a one-liner in `createApp()`.
 */
export function createAdminRoutes(
  services: AppServices,
  adminToken: string,
): Hono {
  const app = new Hono();
  // Scoped to admin + migrate paths so the guard does not leak onto sibling
  // public routes when this sub-app shares the /v1 mount prefix.
  const guard = adminAuth({ token: adminToken });
  app.use('/admin/*', guard);
  app.use('/migrate/*', guard);

  app.get('/admin/budget', (c) =>
    c.json(
      {
        error: {
          code: 'not_implemented',
          message: 'GET /v1/admin/budget handler lands in T-2.9 / T-2.12',
          task: 'T-2.12',
        },
      },
      501,
    ),
  );

  app.post('/admin/budget/refresh', (c) =>
    c.json(
      {
        error: {
          code: 'not_implemented',
          message: 'POST /v1/admin/budget/refresh handler lands in T-2.9 / T-2.12',
          task: 'T-2.12',
        },
      },
      501,
    ),
  );

  app.get('/admin/health', (c) =>
    c.json(
      {
        error: {
          code: 'not_implemented',
          message: 'GET /v1/admin/health handler lands in T-2.12',
          task: 'T-2.12',
        },
      },
      501,
    ),
  );

  // T-2.10: migration door. Reads `?skill_id=<uuid>`, delegates to the
  // migration client, and surfaces `UpstreamError` codes verbatim in the
  // response body. Handler stays thin — the whole promotion pipeline
  // (local lookup → manifest build → upstream.publish → persist) lives
  // in `migrationClient.publish(...)`.
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
