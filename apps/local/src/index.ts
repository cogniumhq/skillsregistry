// ══════════════════════════════════════════════════════════════════════════════
// @skillsregistry/local — entry point.
// ══════════════════════════════════════════════════════════════════════════════
//
// Boot order (fail-fast at every step):
//   1. loadConfig()             — parse env, throw ConfigError on any issue
//   2. createPool()             — instantiate pg.Pool with tuning knobs
//   3. bootSchema(pool)         — apply pending migrations, assert version
//   4. buildAppServices()       — wire adapters + upstream client
//   5. createApp(config, ..)    — mount Hono routes
//   6. serve()                  — bind + listen
//
// Route surface mounted here (see `routes/*` for per-module docs):
//   - GET /v1/health           — liveness (T-2.18); pings pool
//   - /v1/*                    — public routes (T-2.11 fills handlers)
//   - /v1/admin/*, /v1/migrate/*  — admin routes behind bearer auth
//                                    (T-2.9 / T-2.10 / T-2.12 fill handlers)
//   - /mcp, /mcp.json, /.well-known/mcp.json — MCP surface
//                                    (T-2.13 / T-2.14 fill handlers)
//
// Shutdown: SIGINT/SIGTERM → stop server → close services → drain pool.
//
// ══════════════════════════════════════════════════════════════════════════════

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import type { Pool } from 'pg';
import { bootSchema } from './boot/schema.js';
import { loadConfig, ConfigError, type AppConfig } from './config.js';
import { createPool } from './db/pool.js';
import {
  adaptToPortLogger,
  createLogger,
  createSilentLogger,
  type PinoLogger,
} from './logging/index.js';
import { requestLogger } from './middleware/index.js';
import {
  createAdminRoutes,
  createMcpRoutes,
  createPublicRoutes,
} from './routes/index.js';
import {
  buildAppServices,
  closeAppServices,
  type AppServices,
} from './services.js';

interface HealthPayload {
  status: 'ok' | 'degraded';
  version: string;
  nodeEnv: string;
  upstreamConfigured: boolean;
  embedder: string;
  dbReachable: boolean;
}

export function createApp(
  config: AppConfig,
  pool: Pool,
  services: AppServices,
): Hono {
  const app = new Hono();

  // Root-scoped so every downstream sub-app (public, admin, MCP) inherits
  // request-id assignment + per-request logging. Mounted first so the log
  // line covers the full handler duration including tenantContext/auth.
  //
  // `services.logger` is set by `buildAppServices` on the real boot path; the
  // fallback keeps unit tests that pass `{} as AppServices` from blowing up
  // inside the middleware (no logs is fine; a thrown `undefined.child` isn't).
  const middlewareLogger = services.logger ?? createSilentLogger();
  app.use(
    '*',
    requestLogger({
      logger: middlewareLogger,
      requestIdHeader: config.log.requestIdHeader,
    }),
  );

  // Liveness. Served at both `/v1/health` (this node's canonical path) and
  // `/health` — mothership parity: api.skillsregistry.net answers `/health`
  // (its `/v1/health` is 404), so operators following one README can hit the
  // same path on either node (#45). Identical payload on both.
  const healthHandler = async (c: Context) => {
    const dbReachable = await pingDb(pool);
    const payload: HealthPayload = {
      status: dbReachable ? 'ok' : 'degraded',
      version: '0.1.0',
      nodeEnv: config.nodeEnv,
      upstreamConfigured: config.upstream !== null,
      embedder: config.embedder.kind,
      dbReachable,
    };
    return c.json(payload, dbReachable ? 200 : 503);
  };
  app.get('/v1/health', healthHandler);
  app.get('/health', healthHandler);

  // Public + admin share the /v1 prefix. Admin mounts first so its more
  // specific paths (/v1/admin/*, /v1/migrate/*) win over any collisions.
  app.route('/v1', createAdminRoutes(services, config.admin.token, pool));
  app.route('/v1', createPublicRoutes(services));

  // MCP mounts at root — its paths (/mcp, /mcp.json, /.well-known/mcp.json)
  // don't share a prefix with /v1.
  app.route('/', createMcpRoutes(services, config));

  // Admin web UI (T-3.x). Static Astro bundle at `apps/local/web/dist/`
  // built with `base: '/admin'`. Two-stage mount:
  //
  //   The static UI shell (skeletons + client JS, no secrets) is served to any
  //   caller; every data path goes through the token-gated admin APIs
  //   (`/v1/admin/*` + `/v1/migrate/*`, `adminAuth`) — a loopback caller is
  //   bypassed for local-dev convenience, an over-network caller (Docker
  //   bridge, LAN) must present `Authorization: Bearer <ADMIN_TOKEN>`, which
  //   the UI supplies via its login prompt. Fixes #44: the old loopback-only
  //   UI gate 403'd under Docker bridge networking (the container sees the
  //   bridge gateway IP, never loopback, so `-p 127.0.0.1:...` couldn't
  //   unlock it).
  //
  //   serveStatic() resolves `/admin/foo` against `./web/dist/foo`; the path
  //   rewrite strips the `/admin` prefix, falling through to `index.html`.
  app.use(
    '/admin/*',
    serveStatic({
      root: './web/dist',
      rewriteRequestPath: (p) => {
        const stripped = p.replace(/^\/admin\/?/, '/');
        return stripped === '/' ? '/index.html' : stripped;
      },
    }),
  );
  // Bare `/admin` (no trailing slash) → 302 to `/admin/` so relative
  // asset URLs (base '/admin/') resolve correctly.
  app.get('/admin', (c) => c.redirect('/admin/'));

  return app;
}

async function pingDb(pool: Pool): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      // No logger yet — config parse is upstream of `createLogger(config.log)`.
      // Fall back to stderr so the operator still sees the enumerated issues.
      // eslint-disable-next-line no-console
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const logger: PinoLogger = createLogger(config.log);
  const bootLogger = logger.child({ module: 'boot' });

  const pool = createPool(config.postgres);

  try {
    await bootSchema(pool, {
      logger: adaptToPortLogger(logger.child({ module: 'boot-schema' })),
    });
  } catch (err) {
    bootLogger.error(
      { err: (err as Error).message },
      'schema boot failed',
    );
    await pool.end().catch(() => {});
    process.exit(1);
  }

  let services: AppServices;
  try {
    services = await buildAppServices(config, pool, logger);
  } catch (err) {
    bootLogger.error(
      { err: (err as Error).message },
      'services init failed',
    );
    await pool.end().catch(() => {});
    process.exit(1);
  }

  const app = createApp(config, pool, services);

  // Start the budget meter cron. No-op in air-gap mode. Started after
  // createApp so a failing warm-refresh (mothership down at boot) still
  // logs after route wiring, not before.
  services.budgetMeter.start();

  const server = serve(
    { fetch: app.fetch, hostname: config.http.host, port: config.http.port },
    (info) => {
      bootLogger.info(
        {
          address: info.address,
          port: info.port,
          node_env: config.nodeEnv,
          embedder: config.embedder.kind,
          upstream: config.upstream ? 'configured' : 'air-gap',
        },
        'listening',
      );
    },
  );

  const shutdown = async (signal: string): Promise<void> => {
    bootLogger.info({ signal }, 'shutdown received');
    server.close();
    await closeAppServices(services).catch(() => {});
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

// Only run when invoked directly, not when imported (tests).
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    // Fatal-at-boot fallback. If we crashed before `createLogger` ran, we
    // won't have a pino sink; stderr is the safest last-resort channel.
    // eslint-disable-next-line no-console
    console.error('[skillsregistry-local] fatal:', err);
    process.exit(1);
  });
}
