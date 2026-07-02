// ══════════════════════════════════════════════════════════════════════════════
// UpstreamError — typed error surface for every mothership failure.
// ══════════════════════════════════════════════════════════════════════════════
//
// The `code` field mirrors `UpstreamErrorCode` from `@skillsregistry/contracts`.
// Consumers pattern-match on `code` instead of parsing HTTP status codes.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { UpstreamErrorCode } from '@skillsregistry/contracts';

export interface UpstreamErrorOptions {
  /** Seconds until the caller may safely retry. */
  retryAfter?: number;
  /** Structured detail — mothership field errors, etc. */
  detail?: Record<string, unknown>;
  /** Correlates with mothership logs. */
  requestId?: string;
  /** Wrapped root cause (network error, AbortError). */
  cause?: unknown;
}

export class UpstreamError extends Error {
  readonly code: UpstreamErrorCode;
  readonly retryAfter?: number;
  readonly detail?: Record<string, unknown>;
  readonly requestId?: string;

  constructor(
    code: UpstreamErrorCode,
    message: string,
    options: UpstreamErrorOptions = {},
  ) {
    super(message);
    this.name = 'UpstreamError';
    this.code = code;
    this.retryAfter = options.retryAfter;
    this.detail = options.detail;
    this.requestId = options.requestId;
    if (options.cause !== undefined) {
      // Preserve chain without triggering exactOptionalPropertyTypes.
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}
