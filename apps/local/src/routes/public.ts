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
//   GET  /v1/search             — local pgvector search + confidence gate (T-2.11c — wired)
//   GET  /v1/skills/:id         — local-first; upstream write-through cache (T-2.11b — wired)
//   POST /v1/skills             — publish a local single-tenant skill      (T-2.11b — wired)
//   GET  /v1/leaderboards/:kind — proxy to mothership (always upstream)    (T-2.11a — wired)
//   POST /v1/trust/score        — trigger scoring via mothership           (T-2.11a — wired)
//
// All five handlers are wired. See per-handler comments below for the
// module each one delegates to.
//
// ══════════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import {
  PublishRequestSchema,
  TrustScoreRequestSchema,
  SkillVisibilitySchema
} from '@skillsregistry/contracts';
import { upstreamErrorToResponse } from '../http/upstream-response.js';
import { getTenantId, tenantContext } from '../middleware/index.js';
import type { SearchOptions } from '../search/index.js';
import type { AppServices } from '../services.js';
import { UpstreamError } from '../upstream-client/errors.js';

type AppetiteQuery = NonNullable<SearchOptions['appetite']>;
const APPETITE_VALUES: readonly AppetiteQuery[] = [
  'strict',
  'cautious',
  'balanced',
  'adventurous',
];
// #95: the 4-band model (migration 0035) — imported from the shared contract
// so this list can never drift from what `POST /v1/skills` accepts.
const VISIBILITY_VALUES = SkillVisibilitySchema.options;

/**
 * Build the public sub-app. `services` is captured in handler closures.
 */
export function createPublicRoutes(services: AppServices): Hono {
  const app = new Hono();
  app.use('*', tenantContext);

  // T-2.11c: local-first search. `SearchService.search(query, opts)` runs
  // the `ConfidenceGate` (PgVectorProvider + optional deep-search + optional
  // reranker) and projects the domain `FindSkillResponse` onto the
  // `SearchResponseSchema` wire contract. MVP is local-only — the
  // mothership has no `/v1/search` contract in
  // `@skillsregistry/contracts/upstream.ts`, so there is no upstream
  // fallback path here. Deep search + reranker default to disabled
  // (see `SEARCH_DEEP_ENABLED` / `SEARCH_RERANKER_ENABLED` in
  // `config.ts`); the stub backends satisfy the type contract but
  // throw at call time if the operator flips the flags without
  // wiring a real backend.
  app.get('/search', async (c) => {
    const query = c.req.query('q');
    if (query === undefined || query.trim() === '') {
      return c.json(
        {
          error: {
            code: 'bad_request' as const,
            message: 'query parameter `q` is required and must be non-empty',
          },
        },
        400,
      );
    }

    const opts: SearchOptions = {
      tenantId: getTenantId(c) ?? 'local',
    };

    const limitRaw = c.req.query('limit');
    if (limitRaw !== undefined) {
      const parsed = Number(limitRaw);
      if (
        !Number.isFinite(parsed) ||
        !Number.isInteger(parsed) ||
        parsed <= 0 ||
        parsed > 50
      ) {
        return c.json(
          {
            error: {
              code: 'bad_request' as const,
              message: 'limit must be an integer between 1 and 50',
            },
          },
          400,
        );
      }
      opts.limit = parsed;
    }

    const appetiteRaw = c.req.query('appetite');
    if (appetiteRaw !== undefined && appetiteRaw !== '') {
      if (!(APPETITE_VALUES as readonly string[]).includes(appetiteRaw)) {
        return c.json(
          {
            error: {
              code: 'bad_request' as const,
              message: `appetite must be one of ${APPETITE_VALUES.join('|')}`,
            },
          },
          400,
        );
      }
      opts.appetite = appetiteRaw as AppetiteQuery;
    }

    const tagsRaw = c.req.query('tags');
    if (tagsRaw !== undefined && tagsRaw !== '') {
      opts.tags = tagsRaw.split(',').map((s) => s.trim()).filter((s) => s !== '');
    }

    const category = c.req.query('category');
    if (category !== undefined && category !== '') opts.category = category;

    const runtimeEnvRaw = c.req.query('runtime_env');
    if (runtimeEnvRaw !== undefined && runtimeEnvRaw !== '') {
      opts.runtimeEnv = runtimeEnvRaw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '');
    }

    const visibilityRaw = c.req.query('visibility');
    if (visibilityRaw !== undefined && visibilityRaw !== '') {
      if (!(VISIBILITY_VALUES as readonly string[]).includes(visibilityRaw)) {
        return c.json(
          {
            error: {
              code: 'bad_request' as const,
              message: `visibility must be one of ${VISIBILITY_VALUES.join('|')}`,
            },
          },
          400,
        );
      }
      opts.visibility = visibilityRaw as (typeof VISIBILITY_VALUES)[number];
    }

    const portableRaw = c.req.query('portable');
    if (portableRaw !== undefined && portableRaw !== '') {
      if (portableRaw === 'true' || portableRaw === '1') {
        opts.portable = true;
      } else if (portableRaw === 'false' || portableRaw === '0') {
        opts.portable = false;
      } else {
        return c.json(
          {
            error: {
              code: 'bad_request' as const,
              message: 'portable must be true|false|1|0',
            },
          },
          400,
        );
      }
    }

    const response = await services.searchService.search(query, opts);
    return c.json(response, 200);
  });

  // T-2.11b: local-first skill read. `SkillsClient.getSkill(id)` resolves
  // by (id | slug | mothership_skill_id) against the local `skills` table;
  // on miss delegates to `upstream.getSkill(...)` and best-effort caches
  // the mothership row locally. Air-gap misses collapse to `not_found`
  // inside the client so callers see a truthful 404, not a misleading 503.
  app.get('/skills/:id', async (c) => {
    const id = c.req.param('id');
    try {
      const result = await services.skillsClient.getSkill(id);
      return c.json(result.skill as Record<string, unknown>, 200);
    } catch (err) {
      if (err instanceof UpstreamError) {
        const { status, body } = upstreamErrorToResponse(err);
        return c.json(body, status as Parameters<typeof c.json>[1]);
      }
      throw err;
    }
  });

  // T-2.11b: single-tenant local publish. Validates against the
  // `PublishRequestSchema` contract (same shape the mothership accepts on
  // `POST /v1/publish`), then INSERTs into local `skills`. This is
  // *local* — the row stays on the node until the operator explicitly
  // calls `POST /v1/migrate/publish` (T-2.10) to promote it.
  app.post('/skills', async (c) => {
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
    const parsed = PublishRequestSchema.safeParse(raw);
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
      const result = await services.skillsClient.publishLocal(parsed.data, {
        tenantId: getTenantId(c) ?? 'local',
      });
      return c.json(result, 201);
    } catch (err) {
      if (err instanceof UpstreamError) {
        const { status, body } = upstreamErrorToResponse(err);
        return c.json(body, status as Parameters<typeof c.json>[1]);
      }
      throw err;
    }
  });

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
