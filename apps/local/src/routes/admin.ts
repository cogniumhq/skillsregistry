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
//   GET    /v1/admin/skills        — paginated local skill list (T-3.4)
//   PATCH  /v1/admin/skills/:id    — lifecycle status transition (#83)
//   DELETE /v1/admin/skills/:id    — remove a local skill (#84)
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
import type {
  AdminSkillDeleteResponse,
  AdminSkillPatchResponse,
  AdminSkillsListItem,
  AdminSkillsListResponse,
} from '@skillsregistry/contracts';
import { AdminSkillPatchRequestSchema } from '@skillsregistry/contracts';
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

// ── Admin skills list (T-3.4) ────────────────────────────────────────────────
//
// Feeds the admin UI's skills + migration tables. Wire shape sourced from
// `@skillsregistry/contracts` (`AdminSkillsListResponse` + item) so this
// route and any downstream consumer share one type. Minimal projection:
// fields downstream renders as columns + the mothership metadata that
// drives the "publish to mothership" button. Detail view still goes
// through /v1/skills/:id.

const ADMIN_SKILLS_DEFAULT_LIMIT = 100;
const ADMIN_SKILLS_MAX_LIMIT = 500;

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

  // ── GET /v1/admin/skills (T-3.4) ───────────────────────────────────────
  //
  // Paginated list of local skills for the admin UI. Loopback-friendly
  // (bypass on 127.0.0.1) + bearer-gated over the network. Query params:
  //
  //   limit  — 1..500, default 100
  //   offset — 0..N,    default 0
  //
  // Ordering is by created_at DESC so the freshest publishes surface at
  // the top of the table. `total` is a separate COUNT(*) — cheap on the
  // local corpus (self-host runs never exceed a few thousand skills), and
  // lets the UI render a "X of N" caption without a second round-trip.
  app.get('/admin/skills', async (c) => {
    const limitRaw = c.req.query('limit');
    const offsetRaw = c.req.query('offset');
    const limit = clampInt(
      limitRaw,
      ADMIN_SKILLS_DEFAULT_LIMIT,
      1,
      ADMIN_SKILLS_MAX_LIMIT,
    );
    const offset = clampInt(offsetRaw, 0, 0, Number.MAX_SAFE_INTEGER);
    if (limit === null || offset === null) {
      return c.json(
        {
          error: {
            code: 'bad_request' as const,
            message: 'limit and offset must be non-negative integers',
          },
        },
        400,
      );
    }

    try {
      const [rowsResult, countResult] = await Promise.all([
        pool.query(
          `SELECT id, slug, name, source, version,
                  mothership_publish_status, mothership_url,
                  mothership_published_at, created_at
             FROM skills
            ORDER BY created_at DESC NULLS LAST, id
            LIMIT $1 OFFSET $2`,
          [limit, offset],
        ),
        pool.query('SELECT COUNT(*)::text AS c FROM skills'),
      ]);

      const skills = (rowsResult.rows as AdminSkillsRow[]).map(rowToItem);
      const total = Number.parseInt(
        (countResult.rows[0] as { c?: string } | undefined)?.c ?? '0',
        10,
      );

      const body: AdminSkillsListResponse = {
        skills,
        total: Number.isFinite(total) ? total : 0,
        limit,
        offset,
      };
      return c.json(body, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json(
        {
          error: {
            code: 'internal_error' as const,
            message: `skills list failed: ${message}`,
          },
        },
        500,
      );
    }
  });

  // ── PATCH /v1/admin/skills/:id (#83) ───────────────────────────────────
  //
  // The ONE mutable field on a local skill. Manifest content is immutable by
  // construction: `POST /v1/skills` is INSERT-only and migration 0036 made
  // `(slug, version)` unique, so a corrected manifest is a new version, not an
  // edit of history. #83 asks for that rule to be explicit — this is it.
  // Everything else the admin UI shows is read-only.
  //
  // `archived` is the soft-delete escape hatch for operators who want the row
  // kept: it drops out of the default admin view without touching the data.
  app.patch('/admin/skills/:id', async (c) => {
    const identifier = c.req.param('id');
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json(
        {
          error: {
            code: 'bad_request' as const,
            message: 'body must be JSON',
          },
        },
        400,
      );
    }

    const parsed = AdminSkillPatchRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: 'bad_request' as const,
            message:
              'status must be one of: draft, published, deprecated, archived. ' +
              'Manifest fields are immutable — publish a new version instead.',
            detail: { issues: parsed.error.issues },
          },
        },
        400,
      );
    }
    const { status } = parsed.data;

    try {
      const resolved = await resolveSkill(pool, identifier, c.req.query('version'));
      if (resolved.kind === 'not_found') return notFound(c, identifier);
      if (resolved.kind === 'ambiguous') return ambiguous(c, identifier, resolved.versions);

      // `deprecated_at` is set on the transition into `deprecated` and cleared
      // on the way back out, so the timestamp always describes current state.
      const { rows } = await pool.query(
        `UPDATE skills
            SET status = $2,
                deprecated_at = CASE WHEN $2 = 'deprecated' THEN NOW() ELSE NULL END,
                updated_at = NOW()
          WHERE id = $1
        RETURNING id, slug, version, status, deprecated_at`,
        [resolved.row.id, status],
      );
      const row = rows[0] as
        | {
            id: string;
            slug: string;
            version: string;
            status: string;
            deprecated_at: Date | string | null;
          }
        | undefined;
      if (row === undefined) return notFound(c, identifier);

      const body: AdminSkillPatchResponse = {
        id: row.id,
        slug: row.slug,
        version: row.version,
        status: row.status,
        deprecatedAt: toIso(row.deprecated_at),
      };
      return c.json(body, 200);
    } catch (err) {
      return internal(c, 'status update failed', err);
    }
  });

  // ── DELETE /v1/admin/skills/:id (#84) ──────────────────────────────────
  //
  // HARD delete, deliberately. The issue's own use case is resetting a local
  // node so the same slug+version can be re-published; a soft delete leaves the
  // `UNIQUE (slug, version)` constraint occupied and the re-publish still
  // fails. Operators who want the row kept have `PATCH … {status:"archived"}`.
  //
  // Only the local row goes. `mothership_skill_id` is a cached pointer, never
  // a mutation target — the mothership copy is untouched by construction
  // because this handler talks to the local pool only.
  //
  // The audit trail survives the delete by schema design:
  //   skill_embeddings      ON DELETE CASCADE  → removed with the skill
  //   composition_steps     ON DELETE CASCADE  (as composition_id)
  //   user_stars            ON DELETE CASCADE
  //   mcp_invocations       ON DELETE SET NULL → invocation history retained
  //   skill_signature_audits ON DELETE SET NULL → audit retained
  //   quality_feedback      no FK              → retained verbatim
  //
  // The references with NO on-delete action are the dependency guard:
  // `composition_steps.skill_id`, `skill_invocations.skill_id/composition_id`
  // and the `skills.fork_of / origin_id / replacement_skill_id` self-refs all
  // RESTRICT. Postgres raises 23503 and we surface 409 rather than cascading
  // a delete through a composition someone still depends on.
  app.delete('/admin/skills/:id', async (c) => {
    const identifier = c.req.param('id');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const resolved = await resolveSkill(client, identifier, c.req.query('version'), {
        lock: true,
      });
      if (resolved.kind === 'not_found') {
        await client.query('ROLLBACK');
        return notFound(c, identifier);
      }
      if (resolved.kind === 'ambiguous') {
        await client.query('ROLLBACK');
        return ambiguous(c, identifier, resolved.versions);
      }

      const { row } = resolved;
      // Counted before the delete so the response can state what went with it.
      const embeddings = await client.query(
        'SELECT COUNT(*)::text AS c FROM skill_embeddings WHERE skill_id = $1',
        [row.id],
      );
      const embeddingsRemoved = Number.parseInt(
        (embeddings.rows[0] as { c?: string } | undefined)?.c ?? '0',
        10,
      );

      await client.query('DELETE FROM skills WHERE id = $1', [row.id]);
      await client.query('COMMIT');

      const body: AdminSkillDeleteResponse = {
        deleted: true,
        id: row.id,
        slug: row.slug,
        version: row.version,
        embeddingsRemoved: Number.isFinite(embeddingsRemoved) ? embeddingsRemoved : 0,
      };
      return c.json(body, 200);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {
        /* connection already broken — nothing to roll back */
      });
      if (isForeignKeyViolation(err)) {
        return c.json(
          {
            error: {
              code: 'conflict' as const,
              message:
                `skill ${identifier} is still referenced by another row ` +
                '(a composition step, an invocation, or a fork lineage) and was not deleted',
              detail: {
                pg_code: '23503',
                constraint: (err as { constraint?: string }).constraint ?? null,
                table: (err as { table?: string }).table ?? null,
              },
            },
          },
          409,
        );
      }
      return internal(c, 'delete failed', err);
    } finally {
      client.release();
    }
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

// ── Skill resolution + error helpers (#83 / #84) ─────────────────────────────
//
// `resolveSkill` is the guard against the ambiguity the issue calls out: after
// migration 0036 a slug legitimately carries several versions, so a mutation
// keyed on slug alone could hit the wrong row. A UUID is always unambiguous; a
// slug is only accepted when it resolves to exactly one row, or when `?version=`
// narrows it. Read paths may keep guessing with ORDER BY / LIMIT 1 — a delete
// may not.

/** The subset of pg's Pool/PoolClient this module needs. */
interface Queryable {
  query: Pool['query'];
}

interface ResolvedRow {
  id: string;
  slug: string;
  version: string;
}

type SkillResolution =
  | { kind: 'found'; row: ResolvedRow }
  | { kind: 'not_found' }
  | { kind: 'ambiguous'; versions: string[] };

async function resolveSkill(
  db: Queryable,
  identifier: string,
  version: string | undefined,
  options: { lock?: boolean } = {},
): Promise<SkillResolution> {
  const trimmed = identifier?.trim() ?? '';
  if (trimmed === '') return { kind: 'not_found' };

  // FOR UPDATE only on the delete path — it holds the row against a concurrent
  // publish/delete for the life of the transaction.
  const lock = options.lock === true ? ' FOR UPDATE' : '';
  const versionFilter = version !== undefined && version.trim() !== '';

  const { rows } = await db.query(
    `SELECT id, slug, version
       FROM skills
      WHERE (id::text = $1 OR slug = $1 OR mothership_skill_id = $1)
        AND ($2::text IS NULL OR version = $2)
      ORDER BY created_at DESC NULLS LAST, version DESC${lock}`,
    [trimmed, versionFilter ? version : null],
  );

  const candidates = rows as ResolvedRow[];
  if (candidates.length === 0) return { kind: 'not_found' };
  if (candidates.length === 1) {
    const only = candidates[0];
    if (only === undefined) return { kind: 'not_found' };
    return { kind: 'found', row: only };
  }

  // Several rows matched. An exact id hit is still unambiguous — a UUID
  // identifies one row even when its slug has siblings.
  const exactId = candidates.find((r) => r.id === trimmed);
  if (exactId !== undefined) return { kind: 'found', row: exactId };

  return { kind: 'ambiguous', versions: candidates.map((r) => r.version) };
}

type JsonContext = { json: (body: unknown, status?: number) => Response };

function notFound(c: JsonContext, identifier: string): Response {
  return c.json(
    {
      error: {
        code: 'not_found',
        message: `no local skill matches ${identifier}`,
      },
    },
    404,
  );
}

function ambiguous(
  c: JsonContext,
  identifier: string,
  versions: string[],
): Response {
  return c.json(
    {
      error: {
        code: 'conflict',
        message:
          `${identifier} matches ${versions.length} versions — ` +
          'pass ?version= or use the skill id',
        detail: { versions },
      },
    },
    409,
  );
}

function internal(c: JsonContext, what: string, err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  return c.json(
    { error: { code: 'internal_error', message: `${what}: ${message}` } },
    500,
  );
}

/** pg foreign_key_violation — a dependent row still points at this skill. */
function isForeignKeyViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === '23503'
  );
}

// ── Admin skills list helpers ────────────────────────────────────────────────

interface AdminSkillsRow {
  id: string;
  slug: string;
  name: string;
  source: string;
  version: string;
  mothership_publish_status: string | null;
  mothership_url: string | null;
  mothership_published_at: Date | string | null;
  created_at: Date | string | null;
}

function rowToItem(row: AdminSkillsRow): AdminSkillsListItem {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    source: row.source,
    version: row.version,
    mothershipPublishStatus: row.mothership_publish_status,
    mothershipUrl: row.mothership_url,
    mothershipPublishedAt: toIso(row.mothership_published_at),
    createdAt: toIso(row.created_at),
  };
}

function toIso(v: Date | string | null): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

/**
 * Parse a `?limit`/`?offset` query param. Returns the fallback when the
 * param is absent; returns null when it is present but not a
 * non-negative integer or is out of range. Clamps to [min, max].
 */
function clampInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number | null {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n)) return null;
  if (n < min) return null;
  return n > max ? max : n;
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
