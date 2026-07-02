import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpstreamConfig } from '../config.js';
import { UpstreamClient } from './client.js';
import { UpstreamError } from './errors.js';

type FetchImpl = typeof fetch;

interface QueuedResponse {
  status: number;
  body?: unknown;
  /** If set, throws instead of responding (network-level failure). */
  throws?: unknown;
  /** If set, aborts the signal (simulates timeout). */
  abort?: boolean;
}

interface FetchRecorder {
  impl: FetchImpl;
  calls: Array<{ url: string; init?: RequestInit }>;
}

function fakeFetch(queue: QueuedResponse[]): FetchRecorder {
  const calls: FetchRecorder['calls'] = [];
  const impl: FetchImpl = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    const next = queue.shift();
    if (next === undefined) {
      throw new Error(`fakeFetch: no response queued for ${url}`);
    }
    if (next.throws !== undefined) throw next.throws;
    if (next.abort === true) {
      const err = new Error('The operation was aborted') as Error & {
        name: string;
      };
      err.name = 'AbortError';
      throw err;
    }
    const body =
      next.body === undefined
        ? ''
        : typeof next.body === 'string'
          ? next.body
          : JSON.stringify(next.body);
    return new Response(body, {
      status: next.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as FetchImpl;
  return { impl, calls };
}

const CONFIG: UpstreamConfig = {
  baseUrl: 'https://api.skillsregistry.net',
  apiKey: 'test-key',
  tenantId: 'test-tenant',
  searchFallback: true,
};

const TRUST_RESPONSE = {
  skill_id: 'skl_1',
  trust_score: 0.83,
  trust_tier: 'B',
  trust_breakdown: { governance: 0.9, dependencies: 0.8 },
  scored_at: '2026-06-28T12:00:00.000Z',
  tokens_consumed: 12,
};

const BUDGET_RESPONSE = {
  tenant_id: 'test-tenant',
  plan: 'starter',
  tokens_total: 10000,
  tokens_remaining: 4200,
  tokens_reset_at: '2026-07-01T00:00:00.000Z',
  low_balance: false,
};

describe('UpstreamClient', () => {
  describe('air-gap mode (config = null)', () => {
    let client: UpstreamClient;

    beforeEach(() => {
      client = new UpstreamClient({ config: null });
    });

    it('reports isAirGapped=true', () => {
      expect(client.isAirGapped).toBe(true);
    });

    it('every method throws upstream_not_configured', async () => {
      await expect(client.trustScore({ skill_id: 'x' })).rejects.toMatchObject({
        code: 'upstream_not_configured',
      });
      await expect(client.getBudget()).rejects.toMatchObject({
        code: 'upstream_not_configured',
      });
      await expect(client.getSkill('x')).rejects.toMatchObject({
        code: 'upstream_not_configured',
      });
      await expect(
        client.getLeaderboard('trending'),
      ).rejects.toMatchObject({ code: 'upstream_not_configured' });
      await expect(
        client.syncTrustScores('2026-01-01T00:00:00.000Z'),
      ).rejects.toMatchObject({ code: 'upstream_not_configured' });
      await expect(
        client.publish({
          manifest: {
            name: 'x',
            slug: 'x',
            version: '1.0.0',
            source: 'test',
            execution_layer: 'sandbox',
          },
        }),
      ).rejects.toMatchObject({ code: 'upstream_not_configured' });
    });
  });

  describe('happy paths', () => {
    it('trustScore posts, sets auth + tenant headers, parses response', async () => {
      const { impl, calls } = fakeFetch([
        { status: 200, body: TRUST_RESPONSE },
      ]);
      const client = new UpstreamClient({ config: CONFIG, fetchImpl: impl });
      const result = await client.trustScore({ skill_id: 'skl_1' });
      expect(result.trust_score).toBe(0.83);
      expect(result.trust_tier).toBe('B');
      expect(calls[0]!.url).toBe(
        'https://api.skillsregistry.net/v1/trust/score',
      );
      const headers = calls[0]!.init!.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer test-key');
      expect(headers['X-Tenant-Id']).toBe('test-tenant');
      expect(calls[0]!.init!.method).toBe('POST');
      expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({
        skill_id: 'skl_1',
      });
    });

    it('getBudget GETs and parses', async () => {
      const { impl, calls } = fakeFetch([
        { status: 200, body: BUDGET_RESPONSE },
      ]);
      const client = new UpstreamClient({ config: CONFIG, fetchImpl: impl });
      const budget = await client.getBudget();
      expect(budget.tokens_remaining).toBe(4200);
      expect(calls[0]!.url).toBe(
        'https://api.skillsregistry.net/v1/tenant/budget',
      );
      expect(calls[0]!.init!.method).toBe('GET');
    });

    it('getSkill URL-encodes the id', async () => {
      const { impl, calls } = fakeFetch([
        { status: 200, body: { id: 'x' } },
      ]);
      const client = new UpstreamClient({ config: CONFIG, fetchImpl: impl });
      await client.getSkill('acme/my skill');
      expect(calls[0]!.url).toBe(
        'https://api.skillsregistry.net/v1/skills/acme%2Fmy%20skill',
      );
    });

    it('getLeaderboard builds the query string', async () => {
      const { impl, calls } = fakeFetch([
        { status: 200, body: { leaderboard: [] } },
      ]);
      const client = new UpstreamClient({ config: CONFIG, fetchImpl: impl });
      await client.getLeaderboard('trending', {
        limit: 25,
        category: 'browser',
      });
      expect(calls[0]!.url).toBe(
        'https://api.skillsregistry.net/v1/leaderboards/trending?limit=25&category=browser',
      );
    });

    it('syncTrustScores parses envelope with deltas', async () => {
      const { impl } = fakeFetch([
        {
          status: 200,
          body: {
            since: '2026-06-01T00:00:00.000Z',
            until: '2026-06-28T00:00:00.000Z',
            count: 1,
            deltas: [
              {
                skill_id: 'skl_1',
                trust_score: 0.9,
                trust_tier: 'A',
                scored_at: '2026-06-15T00:00:00.000Z',
              },
            ],
          },
        },
      ]);
      const client = new UpstreamClient({ config: CONFIG, fetchImpl: impl });
      const res = await client.syncTrustScores('2026-06-01T00:00:00.000Z');
      expect(res.count).toBe(1);
      expect(res.deltas[0]!.trust_tier).toBe('A');
    });
  });

  describe('error decoding', () => {
    it('maps a structured error envelope to UpstreamError with code + retryAfter', async () => {
      const { impl } = fakeFetch([
        {
          status: 429,
          body: {
            error: {
              code: 'rate_limited',
              message: 'too many trust scores',
              retry_after: 30,
            },
            request_id: 'req-42',
          },
        },
      ]);
      const client = new UpstreamClient({ config: CONFIG, fetchImpl: impl });
      await expect(client.trustScore({ skill_id: 'x' })).rejects.toMatchObject({
        code: 'rate_limited',
        retryAfter: 30,
        requestId: 'req-42',
      });
    });

    it('maps budget_exhausted envelope through the taxonomy', async () => {
      const { impl } = fakeFetch([
        {
          status: 402,
          body: {
            error: {
              code: 'budget_exhausted',
              message: 'no tokens left',
            },
          },
        },
      ]);
      const client = new UpstreamClient({ config: CONFIG, fetchImpl: impl });
      await expect(client.trustScore({ skill_id: 'x' })).rejects.toMatchObject({
        code: 'budget_exhausted',
      });
    });

    it('falls back to status-code inference when the body is not a valid envelope', async () => {
      const { impl } = fakeFetch([{ status: 401, body: '<html>nope</html>' }]);
      const client = new UpstreamClient({ config: CONFIG, fetchImpl: impl });
      await expect(client.trustScore({ skill_id: 'x' })).rejects.toMatchObject({
        code: 'unauthenticated',
      });
    });

    it('maps 403 → forbidden', async () => {
      const { impl } = fakeFetch([{ status: 403, body: '' }]);
      const client = new UpstreamClient({ config: CONFIG, fetchImpl: impl });
      await expect(client.trustScore({ skill_id: 'x' })).rejects.toMatchObject({
        code: 'forbidden',
      });
    });

    it('maps 404 → not_found', async () => {
      const { impl } = fakeFetch([{ status: 404, body: '' }]);
      const client = new UpstreamClient({ config: CONFIG, fetchImpl: impl });
      await expect(client.getSkill('missing')).rejects.toMatchObject({
        code: 'not_found',
      });
    });

    it('maps 400 → bad_request when the envelope is malformed', async () => {
      const { impl } = fakeFetch([{ status: 400, body: '' }]);
      const client = new UpstreamClient({ config: CONFIG, fetchImpl: impl });
      await expect(client.trustScore({ skill_id: 'x' })).rejects.toMatchObject({
        code: 'bad_request',
      });
    });
  });

  describe('rate limiting (local)', () => {
    it('throws rate_limited when local bucket is drained', async () => {
      const clock = { t: 0, now: () => 0 };
      clock.now = () => clock.t;
      const { impl } = fakeFetch([
        { status: 200, body: TRUST_RESPONSE },
        { status: 200, body: TRUST_RESPONSE },
      ]);
      const client = new UpstreamClient({
        config: CONFIG,
        fetchImpl: impl,
        rateLimit: { capacity: 1, refillPerSecond: 1 },
        now: clock.now,
      });
      await client.trustScore({ skill_id: 'a' });
      // Second call fires the local rate limit before the request goes out.
      const err = await client.trustScore({ skill_id: 'b' }).catch((e) => e);
      expect(err).toBeInstanceOf(UpstreamError);
      expect((err as UpstreamError).code).toBe('rate_limited');
      expect((err as UpstreamError).retryAfter).toBeGreaterThanOrEqual(1);
    });
  });

  describe('circuit breaker on 5xx / transport failures', () => {
    // Silence CircuitBreaker's console.warn / console.error inside this block.
    let warnSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('surfaces upstream_unavailable when the breaker degrades', async () => {
      // execute() retries once → each failed call consumes 2 fetches.
      const { impl } = fakeFetch([
        { status: 503, body: '' },
        { status: 503, body: '' },
      ]);
      const client = new UpstreamClient({
        config: CONFIG,
        fetchImpl: impl,
        // Very tight breaker so it degrades on the first call.
        circuit: { threshold: 1, cooldownMs: 60_000 },
      });
      await expect(client.trustScore({ skill_id: 'x' })).rejects.toMatchObject({
        code: 'upstream_unavailable',
      });
    });

    it('propagates network errors as upstream_unavailable', async () => {
      const { impl } = fakeFetch([
        { status: 0, throws: new Error('ECONNRESET') },
        { status: 0, throws: new Error('ECONNRESET') },
      ]);
      const client = new UpstreamClient({
        config: CONFIG,
        fetchImpl: impl,
        circuit: { threshold: 1, cooldownMs: 60_000 },
      });
      await expect(client.getBudget()).rejects.toMatchObject({
        code: 'upstream_unavailable',
      });
    });

    it('maps AbortError → upstream_timeout', async () => {
      const { impl } = fakeFetch([
        { status: 0, abort: true },
        { status: 0, abort: true },
      ]);
      const client = new UpstreamClient({
        config: CONFIG,
        fetchImpl: impl,
        timeoutMs: 100,
        circuit: { threshold: 1, cooldownMs: 60_000 },
      });
      await expect(client.getBudget()).rejects.toMatchObject({
        code: 'upstream_timeout',
      });
    });
  });

  describe('input guards', () => {
    it('trustScore validates the request via Zod', async () => {
      const client = new UpstreamClient({ config: CONFIG });
      // empty skill_id fails Zod
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client.trustScore({ skill_id: '' } as any),
      ).rejects.toThrow();
    });

    it('getSkill rejects empty id before touching the network', async () => {
      const spy = vi.fn();
      const impl: FetchImpl = spy as unknown as FetchImpl;
      const client = new UpstreamClient({ config: CONFIG, fetchImpl: impl });
      await expect(client.getSkill('')).rejects.toMatchObject({
        code: 'bad_request',
      });
      expect(spy).not.toHaveBeenCalled();
    });

    it('getLeaderboard rejects empty kind before touching the network', async () => {
      const spy = vi.fn();
      const impl: FetchImpl = spy as unknown as FetchImpl;
      const client = new UpstreamClient({ config: CONFIG, fetchImpl: impl });
      await expect(client.getLeaderboard('')).rejects.toMatchObject({
        code: 'bad_request',
      });
      expect(spy).not.toHaveBeenCalled();
    });

    it('syncTrustScores rejects empty since before touching the network', async () => {
      const spy = vi.fn();
      const impl: FetchImpl = spy as unknown as FetchImpl;
      const client = new UpstreamClient({ config: CONFIG, fetchImpl: impl });
      await expect(client.syncTrustScores('')).rejects.toMatchObject({
        code: 'bad_request',
      });
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('URL construction', () => {
    it('strips trailing slash from baseUrl', async () => {
      const { impl, calls } = fakeFetch([
        { status: 200, body: BUDGET_RESPONSE },
      ]);
      const client = new UpstreamClient({
        config: { ...CONFIG, baseUrl: 'https://api.skillsregistry.net/' },
        fetchImpl: impl,
      });
      await client.getBudget();
      expect(calls[0]!.url).toBe(
        'https://api.skillsregistry.net/v1/tenant/budget',
      );
    });
  });

  describe('observability', () => {
    it('exposes circuit state', () => {
      const client = new UpstreamClient({ config: CONFIG });
      expect(client.circuitState).toBe('closed');
    });

    it('reports isAirGapped=false with a config', () => {
      const client = new UpstreamClient({ config: CONFIG });
      expect(client.isAirGapped).toBe(false);
    });
  });
});
