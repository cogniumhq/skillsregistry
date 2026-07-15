// ══════════════════════════════════════════════════════════════════════════════
// upstream-response — HTTP status + response body for `UpstreamError`.
// ══════════════════════════════════════════════════════════════════════════════
//
// Every route that surfaces an upstream call (T-2.10 migration door, T-2.11
// public routes, T-2.12 admin routes) needs to map `UpstreamErrorCode` to
// an HTTP status and shape a response body. This module owns that mapping
// so we can't drift the taxonomy between callers.
//
// The response body mirrors `UpstreamErrorEnvelope` from
// `@skillsregistry/contracts` — same shape whether the failure originated
// at the mothership or was minted locally by `TrustClient` /
// `PublishToMothershipClient`. Downstream tooling doesn't case-split on
// which hop failed.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { UpstreamErrorCode } from '@skillsregistry/contracts';
import { UpstreamError } from '../upstream-client/errors.js';

/**
 * `UpstreamErrorCode` → HTTP status. Kept as a table (not a switch) so the
 * taxonomy is visible at a glance.
 *
 * - `upstream_not_configured` → 503 — air-gap mode; caller should retry
 *   after operator sets `MOTHERSHIP_URL`.
 * - `budget_exhausted`        → 402 — payment / plan upgrade required.
 * - `unauthenticated`         → 502 — our API key with the mothership
 *   is bad; caller is not at fault, so we don't return 401.
 * - `forbidden`               → 502 — our tenant/plan can't perform the
 *   action; same reasoning as above.
 * - `not_found`               → 404 — resource absent (local or upstream).
 * - `rate_limited`            → 429 — local or upstream token bucket empty.
 * - `bad_request`             → 400 — schema validation failed.
 * - `upstream_unavailable`    → 503 — 5xx / network / circuit breaker open.
 * - `upstream_timeout`        → 504 — HTTP timeout.
 * - `sandbox_contract_violated` → 502 — L3 runtime aborted with exit 90
 *   (skill-convention §9.2 — wrong image / provider default / preflight
 *   failed). Infrastructure-side, caller can't fix it, so we don't 4xx.
 */
export const UPSTREAM_ERROR_STATUS: Record<UpstreamErrorCode, number> = {
  upstream_not_configured: 503,
  budget_exhausted: 402,
  unauthenticated: 502,
  forbidden: 502,
  not_found: 404,
  rate_limited: 429,
  bad_request: 400,
  upstream_unavailable: 503,
  upstream_timeout: 504,
  sandbox_contract_violated: 502,
};

/**
 * Response envelope surfaced to public + admin callers. Optional fields
 * are omitted (never set to `null` / `undefined` explicitly) so JSON
 * responses stay compact.
 */
export interface UpstreamErrorResponseBody {
  error: {
    code: UpstreamErrorCode;
    message: string;
    retry_after?: number;
    detail?: Record<string, unknown>;
    request_id?: string;
  };
}

/** Build the response body for an `UpstreamError`. */
export function upstreamErrorBody(err: UpstreamError): UpstreamErrorResponseBody {
  const body: UpstreamErrorResponseBody = {
    error: { code: err.code, message: err.message },
  };
  if (err.retryAfter !== undefined) body.error.retry_after = err.retryAfter;
  if (err.detail !== undefined) body.error.detail = err.detail;
  if (err.requestId !== undefined) body.error.request_id = err.requestId;
  return body;
}

/**
 * Pair (status, body) for handlers that want a one-line surface:
 *
 *     const { status, body } = upstreamErrorToResponse(err);
 *     return c.json(body, status as Parameters<typeof c.json>[1]);
 */
export function upstreamErrorToResponse(err: UpstreamError): {
  status: number;
  body: UpstreamErrorResponseBody;
} {
  return {
    status: UPSTREAM_ERROR_STATUS[err.code],
    body: upstreamErrorBody(err),
  };
}
