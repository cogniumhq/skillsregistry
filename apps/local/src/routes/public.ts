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
//                                  (+ optional upstream fallback)          (T-2.11c)
//   GET  /v1/skills/:id         — local-first; upstream write-through cache (T-2.11b)
//   POST /v1/skills             — publish a local single-tenant skill      (T-2.11b)
//   GET  /v1/leaderboards/:kind — proxy to mothership (always upstream)    (T-2.11a — wired)
//   POST /v1/trust/score        — trigger scoring via mothership           (T-2.11a — wired)
//
// The two thin proxies (trust/score + leaderboards) are wired here as
// T-2.11a; the fatter handlers (search + skills read/publish) still ship as
// 501 stubs pointing at T-2.11b / T-2.11c.
//
// ══════════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { TrustScoreRequestSchema } from '@skillsregistry/contracts';
import { upstreamErrorToResponse } from '../http/upstream-response.js';
import { tenantContext } from '../middleware/index.js';
import type { AppServices } from '../services.js';
import { UpstreamError } from '../upstream-client/errors.js';

/**
 * Build the public sub-app. `services` is captured in handler closures.
 */
export function createPublicRoutes(services: AppServices): Hono {
  const app = new Hono();
  app.use('*', tenantContext);

  app.get('/search', (c) =>
    c.json(
      {
        error: {
          code: 'not_implemented',
          message: 'GET /v1/search handler lands in T-2.11c',
          task: 'T-2.11c',
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
          message: 'GET /v1/skills/:id handler lands in T-2.11b',
          task: 'T-2.11b',
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
          message: 'POST /v1/skills handler lands in T-2.11b',
          task: 'T-2.11b',
        },
      },
      501,
    ),
  );

  // T-2.11a: leaderboards are always mothership-owned (there is no local
  // ranking today). Handler is a thin proxy: parse the path param + a
  // whitelist of well-known filters (limit/category/ecosystem/skill_type),
  // hand off to `upstream.getLeaderboard(...)`, pass the JSON body back
  // verbatim. Everything else — API-key threading, rate-limit + circuit
  // breaker, Zod-less pass-through — lives in `UpstreamClient`.
  app.get('/leaderboards/:kind', async (c) => {
    const kind = c.req.param('kind');
    const params: Record<string, string | number | undefined> = {};
    const limitRaw = c.req.query('limit');
    if (limitRaw !== undefined) {
      const parsed = Number(limitRaw);
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
        return c.json(
          {
            error: {
              code: 'bad_request' as const,
              message: 'limit must be a positive integer',
            },
          },
          400,
        );
      }
      params.limit = parsed;
    }
    for (const key of ['category', 'ecosystem', 'skill_type'] as const) {
      const v = c.req.query(key);
      if (v !== undefined && v !== '') params[key] = v;
    }
    try {
      const body = await services.upstream.getLeaderboard(kind, params);
      return c.json(body as Record<string, unknown>, 200);
    } catch (err) {
      if (err instanceof UpstreamError) {
        const { status, body } = upstreamErrorToResponse(err);
        return c.json(body, status as Parameters<typeof c.json>[1]);
      }
      throw err;
    }
  });

  // T-2.11a: trust scoring is authoritative on the mothership. Handler
  // validates the request body against the contract, delegates to
  // `trustClient.score(...)` (which layers KV budget precheck + local
  // persistence over `upstream.trustScore(...)`), and returns just the
  // scoring response — the `budget` snapshot is admin territory
  // (`/v1/admin/budget` lands in T-2.12).
  app.post('/trust/score', async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(
        {
          error: {
            code: 'bad_request' as const,
            message: 'request body must be valid JSON',
          },
        },
        400,
      );
    }
    const parsed = TrustScoreRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: 'bad_request' as const,
            message: 'request body failed schema validation',
            detail: { issues: parsed.error.issues },
          },
        },
        400,
      );
    }
    try {
      const result = await services.trustClient.score(parsed.data);
      return c.json(result.response, 200);
    } catch (err) {
      if (err instanceof UpstreamError) {
        const { status, body } = upstreamErrorToResponse(err);
        return c.json(body, status as Parameters<typeof c.json>[1]);
      }
      throw err;
    }
  });

  return app;
}
