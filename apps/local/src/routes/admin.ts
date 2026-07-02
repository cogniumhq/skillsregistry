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
import { adminAuth } from '../middleware/index.js';
import type { AppServices } from '../services.js';

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

  void services;

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

  app.post('/migrate/publish', (c) =>
    c.json(
      {
        error: {
          code: 'not_implemented',
          message: 'POST /v1/migrate/publish handler lands in T-2.10',
          task: 'T-2.10',
        },
      },
      501,
    ),
  );

  return app;
}
