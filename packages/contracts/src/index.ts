// ══════════════════════════════════════════════════════════════════════════════
// @skillsregistry/contracts — public API contracts
// ══════════════════════════════════════════════════════════════════════════════
//
// Zod schemas + inferred TypeScript types for:
//
//   - `./common`     — shared OpenAPI path / query params (uses
//                      `@hono/zod-openapi`)
//   - `./responses`  — HTTP response envelopes for public REST routes
//                      (uses `@hono/zod-openapi`)
//   - `./upstream`   — local-node → mothership contract types
//                      (plain `zod`, no OpenAPI meta)
//
// Downstream consumers (mothership, local node) pin exact versions —
// `"1.0.0"`, not `"^1.0.0"`. Any field rename or removal is a MAJOR bump.
//
// ══════════════════════════════════════════════════════════════════════════════

export * from './common.js';
export * from './responses.js';
export * from './upstream.js';
