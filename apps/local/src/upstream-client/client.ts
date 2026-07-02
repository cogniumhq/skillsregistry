// ══════════════════════════════════════════════════════════════════════════════
// UpstreamClient — the single door through which the local node talks to the
// mothership (`api.skillsregistry.net`).
// ══════════════════════════════════════════════════════════════════════════════
//
// Per this repo's sacred boundary rule, NO other module here should call the
// mothership directly. All routes / services depend on this class.
//
// Layered resilience (in this order per call):
//
//   1. Air-gap gate     — if no `UpstreamConfig`, every method throws
//                         `UpstreamError('upstream_not_configured')`.
//   2. Token bucket     — local-side rate limit. Throws
//                         `UpstreamError('rate_limited', retryAfter)`.
//   3. Circuit breaker  — from `@skillsregistry/domain/resilience`. Trips on
//                         transport errors, timeouts, and 5xx. When open, all
//                         calls throw `UpstreamError('upstream_unavailable')`.
//   4. HTTP transport   — AbortController-based timeout →
//                         `UpstreamError('upstream_timeout')`.
//   5. Response decode  — 2xx → Zod-validate against the contract schema.
//                         Non-2xx → parse `UpstreamErrorEnvelope`; fall back
//                         to status-code inference if the body doesn't match.
//
// Only 5xx / network / timeout errors trip the breaker. 4xx client errors are
// surfaced as `UpstreamError` but don't count against breaker state — a
// 401 is a config problem, not a mothership-outage signal.
//
// ══════════════════════════════════════════════════════════════════════════════

import {
  BudgetResponseSchema,
  PublishRequestSchema,
  PublishResponseSchema,
  TrustScoreRequestSchema,
  TrustScoreResponseSchema,
  TrustScoreSyncResponseSchema,
  UpstreamErrorSchema,
  type BudgetResponse,
  type PublishRequest,
  type PublishResponse,
  type TrustScoreRequest,
  type TrustScoreResponse,
  type TrustScoreSyncResponse,
  type UpstreamErrorCode,
} from '@skillsregistry/contracts';
import {
  CircuitBreaker,
  type CircuitState,
} from '@skillsregistry/domain/resilience';
import type { UpstreamConfig } from '../config.js';
import { UpstreamError } from './errors.js';
import { TokenBucket } from './token-bucket.js';

export interface UpstreamClientOptions {
  /** `null` puts the client in air-gap mode. Every method then throws `upstream_not_configured`. */
  config: UpstreamConfig | null;
  /** HTTP timeout per request. Default `30000` ms. */
  timeoutMs?: number;
  /** Local rate limit. Default `{ capacity: 60, refillPerSecond: 1 }` = 60 rpm burst. */
  rateLimit?: { capacity: number; refillPerSecond: number };
  /** Circuit breaker knobs. Default `{ threshold: 3, cooldownMs: 30000 }`. */
  circuit?: { threshold: number; cooldownMs: number };
  /** Fetch override for tests. */
  fetchImpl?: typeof fetch;
  /** Clock override for tests (used by the token bucket). */
  now?: () => number;
}

// Sentinel returned by `CircuitBreaker.execute` when the breaker is open or
// the wrapped fn throws twice. Never leaves this module.
const CIRCUIT_SENTINEL = Symbol('upstream-circuit-sentinel');

/** Internal shape returned by `doTransport`. */
interface RawResponse {
  status: number;
  statusText: string;
  body: unknown;
}

export class UpstreamClient {
  private readonly config: UpstreamConfig | null;
  private readonly timeoutMs: number;
  private readonly bucket: TokenBucket | null;
  private readonly breaker: CircuitBreaker | null;
  private readonly fetchImpl: typeof fetch;

  constructor(options: UpstreamClientOptions) {
    this.config = options.config;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    if (this.config !== null) {
      const rl = options.rateLimit ?? { capacity: 60, refillPerSecond: 1 };
      const bucketOptions: {
        capacity: number;
        refillPerSecond: number;
        now?: () => number;
      } = {
        capacity: rl.capacity,
        refillPerSecond: rl.refillPerSecond,
      };
      if (options.now !== undefined) bucketOptions.now = options.now;
      this.bucket = new TokenBucket(bucketOptions);
      const cb = options.circuit ?? { threshold: 3, cooldownMs: 30_000 };
      this.breaker = new CircuitBreaker(cb.threshold, cb.cooldownMs);
    } else {
      this.bucket = null;
      this.breaker = null;
    }
  }

  get isAirGapped(): boolean {
    return this.config === null;
  }

  get circuitState(): CircuitState {
    return this.breaker?.currentState ?? 'closed';
  }

  // ── Trust score ────────────────────────────────────────────────────────

  async trustScore(request: TrustScoreRequest): Promise<TrustScoreResponse> {
    const parsed = TrustScoreRequestSchema.parse(request);
    const body = await this.call('POST', '/v1/trust/score', parsed);
    return TrustScoreResponseSchema.parse(body);
  }

  // ── Tenant budget ──────────────────────────────────────────────────────

  async getBudget(): Promise<BudgetResponse> {
    const body = await this.call('GET', '/v1/tenant/budget');
    return BudgetResponseSchema.parse(body);
  }

  // ── Migration publish ──────────────────────────────────────────────────

  async publish(request: PublishRequest): Promise<PublishResponse> {
    const parsed = PublishRequestSchema.parse(request);
    const body = await this.call('POST', '/v1/publish', parsed);
    return PublishResponseSchema.parse(body);
  }

  // ── Skill fetch (fallback path) ────────────────────────────────────────

  /**
   * Fetch a skill by ID from the mothership. Returned as `unknown` because
   * the caller decides whether to Zod-validate against `SkillDetailSchema`
   * or pass through — some callers want the raw shape for a write-through
   * cache.
   */
  async getSkill(id: string): Promise<unknown> {
    if (id.trim() === '') {
      throw new UpstreamError('bad_request', 'skill id must be non-empty');
    }
    return this.call('GET', `/v1/skills/${encodeURIComponent(id)}`);
  }

  // ── Leaderboard proxy ──────────────────────────────────────────────────

  async getLeaderboard(
    kind: string,
    params: Record<string, string | number | undefined> = {},
  ): Promise<unknown> {
    if (kind.trim() === '') {
      throw new UpstreamError(
        'bad_request',
        'leaderboard kind must be non-empty',
      );
    }
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) qs.set(k, String(v));
    }
    const suffix = qs.toString().length > 0 ? `?${qs.toString()}` : '';
    return this.call(
      'GET',
      `/v1/leaderboards/${encodeURIComponent(kind)}${suffix}`,
    );
  }

  // ── Delta sync ─────────────────────────────────────────────────────────

  async syncTrustScores(since: string): Promise<TrustScoreSyncResponse> {
    if (since.trim() === '') {
      throw new UpstreamError('bad_request', 'since must be an ISO timestamp');
    }
    const body = await this.call(
      'GET',
      `/v1/sync/trust-scores?since=${encodeURIComponent(since)}`,
    );
    return TrustScoreSyncResponseSchema.parse(body);
  }

  // ── Core call pipeline ─────────────────────────────────────────────────

  private async call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    if (this.config === null) {
      throw new UpstreamError(
        'upstream_not_configured',
        'Mothership is not configured (air-gap mode)',
      );
    }
    // Local rate limit.
    const take = this.bucket!.tryTake();
    if (!take.ok) {
      throw new UpstreamError(
        'rate_limited',
        `Local rate limit exceeded; retry after ${take.retryAfterSeconds}s`,
        { retryAfter: take.retryAfterSeconds },
      );
    }

    // Breaker + transport.
    let lastError: unknown = null;
    const breaker = this.breaker!;
    const { result, degraded } = await breaker.execute(
      async () => {
        try {
          return await this.doTransport(method, path, body);
        } catch (err) {
          lastError = err;
          throw err;
        }
      },
      CIRCUIT_SENTINEL as unknown,
    );

    if (degraded) {
      // Preserve specific signal when we captured it.
      if (
        lastError !== null &&
        typeof lastError === 'object' &&
        (lastError as { name?: string }).name === 'AbortError'
      ) {
        throw new UpstreamError(
          'upstream_timeout',
          `Upstream request timed out after ${this.timeoutMs}ms`,
          { cause: lastError },
        );
      }
      const message =
        lastError instanceof Error
          ? lastError.message
          : 'Circuit breaker is open';
      throw new UpstreamError(
        'upstream_unavailable',
        `Upstream request failed: ${message}`,
        { cause: lastError ?? undefined },
      );
    }

    const response = result as RawResponse;
    if (response.status >= 200 && response.status < 300) {
      return response.body;
    }
    // Non-2xx 4xx: not a breaker signal. Map to typed error.
    throw this.decodeError(response);
  }

  private async doTransport(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<RawResponse> {
    const url = `${stripTrailingSlash(this.config!.baseUrl)}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const init: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${this.config!.apiKey}`,
          'X-Tenant-Id': this.config!.tenantId,
        },
        signal: controller.signal,
      };
      if (body !== undefined) {
        init.body = JSON.stringify(body);
      }
      const response = await this.fetchImpl(url, init);

      let parsed: unknown = null;
      if (response.status !== 204) {
        // Fault-tolerant JSON parse: empty bodies + non-JSON error pages
        // shouldn't crash the caller. Content-Type is advisory.
        const text = await response.text();
        if (text.length > 0) {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = null;
          }
        }
      }

      // 5xx → tell the breaker this is a mothership problem.
      if (response.status >= 500) {
        throw new Error(
          `upstream ${response.status} ${response.statusText || ''}`.trim(),
        );
      }

      return {
        status: response.status,
        statusText: response.statusText,
        body: parsed,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private decodeError(response: RawResponse): UpstreamError {
    const parsed = UpstreamErrorSchema.safeParse(response.body);
    if (parsed.success) {
      const { error, request_id } = parsed.data;
      const opts: {
        retryAfter?: number;
        detail?: Record<string, unknown>;
        requestId?: string;
      } = {};
      if (error.retry_after !== undefined) opts.retryAfter = error.retry_after;
      if (error.detail !== undefined) opts.detail = error.detail;
      if (request_id !== undefined) opts.requestId = request_id;
      return new UpstreamError(error.code, error.message, opts);
    }
    const code = statusToCode(response.status);
    return new UpstreamError(
      code,
      `Upstream responded ${response.status}${
        response.statusText ? ` ${response.statusText}` : ''
      }`,
    );
  }
}

function statusToCode(status: number): UpstreamErrorCode {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 400 && status < 500) return 'bad_request';
  return 'upstream_unavailable';
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
