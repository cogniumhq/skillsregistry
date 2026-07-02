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
// Constant-time comparison prevents timing-based token disclosure. The
// expected token is validated to be non-empty at construction — an empty
// admin token would let unauth requests through.
//
// ══════════════════════════════════════════════════════════════════════════════

import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

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
