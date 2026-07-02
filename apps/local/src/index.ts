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
import { Hono } from 'hono';
import type { Pool } from 'pg';
import { bootSchema } from './boot/schema.js';
import { loadConfig, ConfigError, type AppConfig } from './config.js';
import { createPool } from './db/pool.js';
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

  app.get('/v1/health', async (c) => {
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
  });

  // Public + admin share the /v1 prefix. Admin mounts first so its more
  // specific paths (/v1/admin/*, /v1/migrate/*) win over any collisions.
  app.route('/v1', createAdminRoutes(services, config.admin.token));
  app.route('/v1', createPublicRoutes(services));

  // MCP mounts at root — its paths (/mcp, /mcp.json, /.well-known/mcp.json)
  // don't share a prefix with /v1.
  app.route('/', createMcpRoutes(services, config));

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
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const pool = createPool(config.postgres);

  try {
    await bootSchema(pool);
  } catch (err) {
    console.error(
      '[skillsregistry-local] schema boot failed:',
      (err as Error).message,
    );
    await pool.end().catch(() => {});
    process.exit(1);
  }

  let services: AppServices;
  try {
    services = await buildAppServices(config, pool);
  } catch (err) {
    console.error(
      '[skillsregistry-local] services init failed:',
      (err as Error).message,
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
      console.log(
        `[skillsregistry-local] listening on http://${info.address}:${info.port}`,
      );
      console.log(
        `[skillsregistry-local] node_env=${config.nodeEnv} embedder=${config.embedder.kind} upstream=${config.upstream ? 'configured' : 'air-gap'}`,
      );
    },
  );

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[skillsregistry-local] ${signal} received, shutting down`);
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
    console.error('[skillsregistry-local] fatal:', err);
    process.exit(1);
  });
}
