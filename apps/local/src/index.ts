// ══════════════════════════════════════════════════════════════════════════════
// @skillsregistry/local — entry point.
// ══════════════════════════════════════════════════════════════════════════════
//
// Stub for T-2.1. Loads config, mounts a health route, starts the HTTP server.
// Real routing (public + admin + /mcp) lands in T-2.3.
//
// ══════════════════════════════════════════════════════════════════════════════

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { loadConfig, ConfigError, type AppConfig } from './config.js';

interface HealthPayload {
  status: 'ok';
  version: string;
  nodeEnv: string;
  upstreamConfigured: boolean;
  embedder: string;
}

export function createApp(config: AppConfig): Hono {
  const app = new Hono();

  app.get('/v1/health', (c) => {
    const payload: HealthPayload = {
      status: 'ok',
      version: '0.1.0',
      nodeEnv: config.nodeEnv,
      upstreamConfigured: config.upstream !== null,
      embedder: config.embedder.kind,
    };
    return c.json(payload);
  });

  return app;
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

  const app = createApp(config);

  serve(
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
}

// Only run when invoked directly, not when imported (tests).
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error('[skillsregistry-local] fatal:', err);
    process.exit(1);
  });
}
