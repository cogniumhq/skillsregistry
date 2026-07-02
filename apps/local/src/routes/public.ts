// ══════════════════════════════════════════════════════════════════════════════
// Public routes — /v1/*
// ══════════════════════════════════════════════════════════════════════════════
//
// Sub-app mounted at `/v1` by `createApp()`. Every handler here is called
// unauthenticated (public reads) or self-authenticated (single-tenant local
// install). Downstream services see the advisory `X-Tenant-Id` via
// `getTenantId(c)` — but never treat it as a security boundary.
//
// Handler surface (per T-2.11):
//
//   GET  /v1/search             — local pgvector search + confidence gate
//                                  (+ optional upstream fallback)
//   GET  /v1/skills/:id         — local-first; upstream write-through cache
//   POST /v1/skills             — publish a local single-tenant skill
//   GET  /v1/leaderboards/:kind — proxy to mothership (always upstream)
//   POST /v1/trust/score        — trigger scoring via mothership
//
// Handlers ship in T-2.11. This module currently ships 501 stubs so the
// route surface + `AppServices` DI wiring can be exercised end-to-end
// (integration tests + smoke tests) before per-endpoint logic lands.
//
// The 501 body carries `{ error: { code: 'not_implemented', message,
// task } }` so a caller sees which downstream task fills it in.
//
// ══════════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { tenantContext } from '../middleware/index.js';
import type { AppServices } from '../services.js';

/**
 * Build the public sub-app. `services` is captured in handler closures
 * (deferred to T-2.11); the parameter stays on the signature so wiring
 * doesn't shift when handlers land.
 */
export function createPublicRoutes(services: AppServices): Hono {
  const app = new Hono();
  app.use('*', tenantContext);

  // Silence unused-param warnings until T-2.11 wires handlers.
  void services;

  app.get('/search', (c) =>
    c.json(
      {
        error: {
          code: 'not_implemented',
          message: 'GET /v1/search handler lands in T-2.11',
          task: 'T-2.11',
        },
      },
      501,
    ),
  );

  app.get('/skills/:id', (c) =>
    c.json(
      {
        error: {
          code: 'not_implemented',
          message: 'GET /v1/skills/:id handler lands in T-2.11',
          task: 'T-2.11',
        },
      },
      501,
    ),
  );

  app.post('/skills', (c) =>
    c.json(
      {
        error: {
          code: 'not_implemented',
          message: 'POST /v1/skills handler lands in T-2.11',
          task: 'T-2.11',
        },
      },
      501,
    ),
  );

  app.get('/leaderboards/:kind', (c) =>
    c.json(
      {
        error: {
          code: 'not_implemented',
          message: 'GET /v1/leaderboards/:kind handler lands in T-2.11',
          task: 'T-2.11',
        },
      },
      501,
    ),
  );

  app.post('/trust/score', (c) =>
    c.json(
      {
        error: {
          code: 'not_implemented',
          message: 'POST /v1/trust/score handler lands in T-2.11',
          task: 'T-2.11',
        },
      },
      501,
    ),
  );

  return app;
}
