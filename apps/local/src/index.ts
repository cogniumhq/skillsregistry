// ══════════════════════════════════════════════════════════════════════════════
// @skillsregistry/local — entry point.
// ══════════════════════════════════════════════════════════════════════════════
//
// Boot order (fail-fast at every step):
//   1. loadConfig()             — parse env, throw ConfigError on any issue
//   2. createPool()             — instantiate pg.Pool with tuning knobs
//   3. bootSchema(pool)         — apply pending migrations, assert version
//   4. createApp(config)        — mount Hono routes
//   5. serve()                  — bind + listen
//
// Real routing (public + admin + /mcp) lands in T-2.3. `GET /v1/health` is
// the T-2.18 liveness endpoint and depends on the DB being reachable, so it
// pings the pool.
//
// ══════════════════════════════════════════════════════════════════════════════

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { Pool } from 'pg';
import { bootSchema } from './boot/schema.js';
import { loadConfig, ConfigError, type AppConfig } from './config.js';
import { createPool } from './db/pool.js';

interface HealthPayload {
  status: 'ok' | 'degraded';
  version: string;
  nodeEnv: string;
  upstreamConfigured: boolean;
  embedder: string;
  dbReachable: boolean;
}

export function createApp(config: AppConfig, pool: Pool): Hono {
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
    console.error('[skillsregistry-local] schema boot failed:', (err as Error).message);
    await pool.end().catch(() => {});
    process.exit(1);
  }

  const app = createApp(config, pool);

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
