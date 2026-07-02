// ══════════════════════════════════════════════════════════════════════════════
// MCP routes — /mcp, /mcp.json, /.well-known/mcp.json
// ══════════════════════════════════════════════════════════════════════════════
//
// Sub-app mounted at `/` (paths at root because MCP discovery is served
// under `/.well-known/mcp.json` by convention).
//
// Handler surface (per T-2.13 + T-2.14):
//
//   POST /mcp                    — JSON-RPC 2.0 tool dispatch via
//                                  `@skillsregistry/mcp` handleMcpRequest
//   GET  /mcp.json               — discovery descriptor (mirror of well-known)
//   GET  /.well-known/mcp.json   — canonical MCP discovery
//
// Handlers ship in T-2.13 (dispatch) + T-2.14 (discovery). This module
// ships 501 stubs so mount + `tenantContext` middleware can be exercised.
//
// The `tenantContext` middleware runs on every MCP route — v1 uses
// `X-Tenant-Id` as an advisory scope hint (never a security boundary).
//
// ══════════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { tenantContext } from '../middleware/index.js';
import type { AppConfig } from '../config.js';
import type { AppServices } from '../services.js';

/**
 * Build the MCP sub-app. The three paths mount flat at `/` so `createApp()`
 * can hoist them under the root Hono instance without a prefix.
 */
export function createMcpRoutes(services: AppServices, config: AppConfig): Hono {
  const app = new Hono();
  app.use('*', tenantContext);

  void services;
  void config;

  app.post('/mcp', (c) =>
    c.json(
      {
        error: {
          code: 'not_implemented',
          message: 'POST /mcp handler lands in T-2.13',
          task: 'T-2.13',
        },
      },
      501,
    ),
  );

  app.get('/mcp.json', (c) =>
    c.json(
      {
        error: {
          code: 'not_implemented',
          message: 'GET /mcp.json handler lands in T-2.14',
          task: 'T-2.14',
        },
      },
      501,
    ),
  );

  app.get('/.well-known/mcp.json', (c) =>
    c.json(
      {
        error: {
          code: 'not_implemented',
          message: 'GET /.well-known/mcp.json handler lands in T-2.14',
          task: 'T-2.14',
        },
      },
      501,
    ),
  );

  return app;
}
