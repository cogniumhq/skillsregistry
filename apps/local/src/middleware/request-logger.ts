// ══════════════════════════════════════════════════════════════════════════════
// requestLogger — request-id assignment + per-request structured log.
// ══════════════════════════════════════════════════════════════════════════════
//
// Every request gets a stable id from the configured header (default
// `X-Request-Id`) or a fresh `crypto.randomUUID()` when the header is absent /
// malformed. The id is:
//
//   - stashed on `c.set('requestId', …)` so handlers can correlate logs
//   - stashed on `c.set('logger', …)` as a pino child bound to
//     `{ req_id, method, path }` so handlers can log with correlation for free
//   - echoed on the response via the same header so clients / proxies can
//     stitch traces
//
// After `await next()` runs the handler chain, one summary line is emitted
// with `status`, `duration_ms`, and `tenant_id` (read via `getTenantId` —
// safe even on routes that don't mount `tenantContext`; returns null). Log
// level is chosen by status: 5xx → ERROR, 4xx → WARN, else INFO. If a handler
// threw and Hono stashed the underlying `Error` on `c.error`, the message is
// included as `err`. Uncaught throws propagate — the middleware does not
// swallow them.
//
// Pino writes are non-blocking (default backpressure = drop-and-buffer), so
// this middleware does NOT need `AfterResponse.defer(...)`. Reserve that
// wrapper for DB observability writes per `.specifica/principles.md`.
//
// ══════════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

import type { PinoLogger } from '../logging/index.js';
import { getTenantId } from './tenant.js';

/** Valid `X-Request-Id` payload — RFC 4122 style + a permissive alnum window. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
    logger: PinoLogger;
  }
}

export interface RequestLoggerOptions {
  /** Root pino logger; child-scoped per request. */
  logger: PinoLogger;
  /** HTTP header name honored on inbound + echoed on outbound. */
  requestIdHeader: string;
}

/**
 * Build the middleware handler. Curried so `createApp` can inject the
 * per-app logger + header from `AppConfig`.
 */
export function requestLogger(options: RequestLoggerOptions): MiddlewareHandler {
  const { logger, requestIdHeader } = options;
  const headerName = requestIdHeader;

  return async (c, next) => {
    const raw = c.req.header(headerName);
    const trimmed = raw?.trim();
    const requestId =
      trimmed && REQUEST_ID_PATTERN.test(trimmed) ? trimmed : randomUUID();

    const method = c.req.method;
    const path = new URL(c.req.url).pathname;

    const child = logger.child({ req_id: requestId, method, path });
    c.set('requestId', requestId);
    c.set('logger', child);
    c.header(headerName, requestId);

    const startNs = process.hrtime.bigint();
    await next();
    const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;

    const status = c.res.status;
    const err = c.error;
    const fields: Record<string, unknown> = {
      status,
      duration_ms: Number(durationMs.toFixed(3)),
      tenant_id: getTenantId(c),
    };
    if (err) {
      fields.err = err instanceof Error ? err.message : String(err);
    }

    if (status >= 500 || err) {
      child.error(fields, 'request failed');
    } else if (status >= 400) {
      child.warn(fields, 'request');
    } else {
      child.info(fields, 'request');
    }
  };
}
