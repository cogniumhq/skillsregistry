// ══════════════════════════════════════════════════════════════════════════════
// adminAuth — bearer-token middleware for /v1/admin/* routes.
// ══════════════════════════════════════════════════════════════════════════════
//
// Validates `Authorization: Bearer <token>` against the configured
// `ADMIN_TOKEN`. Returns 401 with a stable envelope for missing / malformed /
// mismatched tokens. Case-insensitive on the header name (Hono does this
// automatically); case-sensitive on the `Bearer` scheme (per RFC 6750 §2.1
// the scheme is defined lower-case but implementations MUST accept any case —
// we match either).
//
// Loopback exception: when the inbound socket's remote address is loopback
// (`127.x.x.x`, `::1`, or IPv4-mapped equivalents), the bearer check is
// bypassed. This lets the same-origin admin UI at `/admin/*` call the
// `/v1/admin/*` and `/v1/migrate/*` APIs without embedding a token in the
// browser bundle. Over-network requests always require the bearer.
//
// Constant-time comparison prevents timing-based token disclosure. The
// expected token is validated to be non-empty at construction — an empty
// admin token would let unauth requests through.
//
// ══════════════════════════════════════════════════════════════════════════════

import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { isLoopbackRequest } from './loopback.js';

export interface AdminAuthOptions {
  /** Expected bearer token. Must be non-empty. */
  token: string;
}

/**
 * Build the admin-auth middleware. Attach to any admin sub-app before its
 * routes so every request under the mount is guarded.
 */
export function adminAuth(options: AdminAuthOptions): MiddlewareHandler {
  const { token } = options;
  if (typeof token !== 'string' || token === '') {
    throw new Error('[admin-auth] token must be a non-empty string');
  }
  const expected = Buffer.from(token, 'utf8');

  return async (c, next) => {
    // Loopback bypass: the admin UI lives at /admin/* on the same process
    // and calls /v1/admin/* + /v1/migrate/* from a same-origin browser.
    // A LAN caller still has to present the bearer token.
    if (isLoopbackRequest(c.env)) {
      await next();
      return;
    }

    const header = c.req.header('Authorization') ?? c.req.header('authorization');
    if (header === undefined) {
      return c.json(
        { error: { code: 'unauthenticated', message: 'Missing Authorization header' } },
        401,
      );
    }

    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match === null || match[1] === undefined) {
      return c.json(
        {
          error: {
            code: 'unauthenticated',
            message: 'Authorization header must be `Bearer <token>`',
          },
        },
        401,
      );
    }

    const provided = Buffer.from(match[1], 'utf8');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return c.json(
        { error: { code: 'unauthenticated', message: 'Invalid admin token' } },
        401,
      );
    }

    await next();
    return;
  };
}
