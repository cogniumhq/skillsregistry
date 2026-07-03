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
// T-2.13 wires POST /mcp against `handleMcpRequest` with adapters + config
// built at boot on `AppServices`. T-2.14 wires the discovery descriptors at
// GET /mcp.json + GET /.well-known/mcp.json via `buildDiscoveryDescriptor`.
//
// The `tenantContext` middleware runs on every MCP route — v1 uses
// `X-Tenant-Id` as an advisory scope hint (never a security boundary).
// When absent, the tenant id resolves to `'local'` for dispatch context so
// downstream services see a stable synthetic scope.
//
// ══════════════════════════════════════════════════════════════════════════════

import { Hono, type Context } from 'hono';
import {
  buildDiscoveryDescriptor,
  handleMcpRequest,
  parseErrorResponse,
  type DispatchContext,
} from '@skillsregistry/mcp';
import { tenantContext, getTenantId } from '../middleware/index.js';
import type { AppConfig } from '../config.js';
import type { AppServices } from '../services.js';

/** Fallback tenant id when the caller supplies no `X-Tenant-Id`. */
const DEFAULT_TENANT_ID = 'local';

/**
 * Build the MCP sub-app. The three paths mount flat at `/` so `createApp()`
 * can hoist them under the root Hono instance without a prefix.
 */
export function createMcpRoutes(services: AppServices, config: AppConfig): Hono {
  const app = new Hono();
  app.use('*', tenantContext);

  void config;

  app.post('/mcp', async (c) => {
    // Body parsing is the only place a malformed request maps to a JSON-RPC
    // parse-error envelope (-32700). Everything downstream flows through
    // `handleMcpRequest` which owns its own error shaping.
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(parseErrorResponse(), 400);
    }

    const ctx: DispatchContext = {
      tenantId: getTenantId(c) ?? DEFAULT_TENANT_ID,
      adapters: services.mcpAdapters,
      config: services.mcpConfig,
    };

    const outcome = await handleMcpRequest(body, ctx);
    switch (outcome.kind) {
      case 'json':
        return c.json(outcome.body, 200);
      case 'accepted':
        // JSON-RPC 2.0 notifications + empty-response batches. No body per
        // MCP 2025-03-26 §Transports.
        return c.body(null, 202);
      case 'error':
        return c.json(outcome.body, outcome.status as 400);
    }
  });

  const discovery = (c: Context) =>
    c.json(
      buildDiscoveryDescriptor({
        requestUrl: c.req.url,
        config: services.mcpConfig,
      }),
    );

  app.get('/mcp.json', discovery);
  app.get('/.well-known/mcp.json', discovery);

  return app;
}
