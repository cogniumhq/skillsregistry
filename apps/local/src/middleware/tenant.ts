// ══════════════════════════════════════════════════════════════════════════════
// tenantContext — X-Tenant-Id extraction for public + MCP routes.
// ══════════════════════════════════════════════════════════════════════════════
//
// Per the MCP v1 spec + `.specifica/mvp` design notes, `X-Tenant-Id` is an
// *advisory* scope hint on read-only surfaces — it is NOT a security boundary
// in this release. Missing / spoofed tenant IDs default to public visibility
// inside downstream services.
//
// This middleware:
//   - Reads `X-Tenant-Id` (any case) from the request.
//   - Trims + validates a lightweight shape: non-empty, ≤ 128 chars, safe
//     ASCII (`[A-Za-z0-9._:-]`). Invalid values are dropped silently (treated
//     as public) rather than 400'd — a bad ID never blocks a public read.
//   - Stashes the resolved value (or `null`) on `c.set('tenantId', …)` so
//     handlers can read it via `c.get('tenantId')`.
//   - Exposes `getTenantId(c)` for handlers that prefer a helper over string
//     literals.
//
// The Hono context variable is typed via module augmentation below so
// `c.get('tenantId')` narrows to `string | null` without casts.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { Context, MiddlewareHandler } from 'hono';

const TENANT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const CONTEXT_KEY = 'tenantId';

declare module 'hono' {
  interface ContextVariableMap {
    tenantId: string | null;
  }
}

/**
 * Middleware handler. Reads `X-Tenant-Id`, validates shape, stores on
 * context. Always calls `next()` — even when the header is absent or
 * invalid.
 */
export const tenantContext: MiddlewareHandler = async (c, next) => {
  const raw = c.req.header('X-Tenant-Id') ?? c.req.header('x-tenant-id');
  const trimmed = raw === undefined ? undefined : raw.trim();
  const resolved =
    trimmed !== undefined && trimmed !== '' && TENANT_ID_PATTERN.test(trimmed)
      ? trimmed
      : null;
  c.set(CONTEXT_KEY, resolved);
  await next();
};

/** Handler helper — returns the resolved tenant ID or `null`. */
export function getTenantId(c: Context): string | null {
  return c.get(CONTEXT_KEY) ?? null;
}
