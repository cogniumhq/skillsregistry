// ══════════════════════════════════════════════════════════════════════════════
// loopback — helpers + middleware for loopback-only surfaces.
// ══════════════════════════════════════════════════════════════════════════════
//
// The admin web UI (mounted at `/admin/*` — see src/index.ts) must never be
// reachable over the network, even if the operator misconfigures Docker port
// publishing. This module gates it purely on the inbound socket's remote
// address as reported by `@hono/node-server` on `env.incoming.socket`.
//
// Two pieces:
//
//   - `isLoopbackAddress(addr)` — a pure predicate. Accepts IPv4 loopback
//     (`127.0.0.0/8`), IPv6 loopback (`::1`), and IPv4-mapped IPv6 loopback
//     (`::ffff:127.0.0.1` / `::ffff:7f00:1`). Anything else — including
//     `undefined`/`null`/empty — returns `false` so the caller **fails
//     closed** by default.
//
//   - `loopbackOnly()` — a Hono MiddlewareHandler that hard-rejects
//     non-loopback requests with a 403. Used to gate `/admin/*` (the static
//     Astro UI) so the browser can only reach it from localhost.
//
// The same predicate is used by `adminAuth` to short-circuit its bearer
// check when the request originates from the local socket — so the admin UI
// can call `/v1/admin/*` and `/v1/migrate/*` cross-origin-free from the
// browser without embedding a token in the client bundle.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { MiddlewareHandler } from 'hono';

/**
 * Return `true` if `addr` is a loopback address (IPv4 `127.x.x.x`, IPv6
 * `::1`, or the IPv4-mapped-in-IPv6 form of `127.x.x.x`).
 *
 * Fails closed: unknown / empty / malformed inputs return `false`.
 */
export function isLoopbackAddress(
  addr: string | null | undefined,
): boolean {
  if (typeof addr !== 'string' || addr.length === 0) return false;

  // IPv6 loopback (exact).
  if (addr === '::1') return true;

  // IPv4-mapped IPv6 loopback: `::ffff:127.0.0.1`.
  const mapped = addr.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped !== null && mapped[1] !== undefined) {
    return isIpv4Loopback(mapped[1]);
  }

  // IPv4-mapped IPv6 loopback in hex: `::ffff:7f00:1` etc.
  const mappedHex = addr.toLowerCase().match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex !== null && mappedHex[1] !== undefined && mappedHex[2] !== undefined) {
    const hi = parseInt(mappedHex[1], 16);
    // High byte of the mapped IPv4 must be 127.
    return (hi >>> 8) === 127;
  }

  // Plain IPv4.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(addr)) {
    return isIpv4Loopback(addr);
  }

  return false;
}

function isIpv4Loopback(addr: string): boolean {
  const parts = addr.split('.');
  if (parts.length !== 4) return false;
  const first = Number(parts[0]);
  if (!Number.isInteger(first)) return false;
  // 127.0.0.0/8
  return first === 127;
}

/**
 * Extract the remote address off the inbound Node socket. Returns `null` when
 * `env.incoming.socket.remoteAddress` isn't available (unit-test contexts,
 * unusual runtimes).
 */
export function readRemoteAddress(env: unknown): string | null {
  if (typeof env !== 'object' || env === null) return null;
  const incoming = (env as { incoming?: unknown }).incoming;
  if (typeof incoming !== 'object' || incoming === null) return null;
  const socket = (incoming as { socket?: unknown }).socket;
  if (typeof socket !== 'object' || socket === null) return null;
  const remoteAddress = (socket as { remoteAddress?: unknown }).remoteAddress;
  return typeof remoteAddress === 'string' && remoteAddress.length > 0
    ? remoteAddress
    : null;
}

/**
 * Convenience: `true` iff the current request came from the local socket.
 */
export function isLoopbackRequest(env: unknown): boolean {
  return isLoopbackAddress(readRemoteAddress(env));
}

/**
 * Middleware that rejects any non-loopback request with 403. Mount on the
 * admin UI path (`/admin/*`) so the static bundle never escapes localhost.
 */
export function loopbackOnly(): MiddlewareHandler {
  return async (c, next) => {
    if (isLoopbackRequest(c.env)) {
      await next();
      return;
    }
    return c.json(
      {
        error: {
          code: 'forbidden',
          message: 'admin UI is loopback-only; bind Docker with -p 127.0.0.1:3000:3000',
        },
      },
      403,
    );
  };
}
