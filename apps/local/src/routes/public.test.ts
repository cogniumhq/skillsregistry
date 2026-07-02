// ══════════════════════════════════════════════════════════════════════════════
// public.test.ts — happy-path + error-mapping suites for T-2.11a handlers.
// ══════════════════════════════════════════════════════════════════════════════
//
// `routing.test.ts` covers the wired-vs-501 smoke case (air-gap → 503) + a
// couple of bad_request paths. This file exercises the interesting happy
// paths + the full UpstreamError → HTTP status table so a rewrite of the
// mapping never silently downgrades a public error.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config.js';
import { createApp } from '../index.js';
import type { AppServices } from '../services.js';
import { UpstreamError } from '../upstream-client/errors.js';

function buildConfig(): AppConfig {
  return {
    nodeEnv: 'test',
    http: { host: '0.0.0.0', port: 3000 },
    postgres: {
      connectionString: 'postgres://x',
      poolMax: 10,
      statementTimeoutMs: 30000,
    },
    admin: { token: 'test-admin-token' },
    artifact: { baseDir: '/tmp/artifacts' },
    embedder: {
      kind: 'ollama',
      url: 'http://localhost:11434',
      model: 'nomic-embed-text',
    },
    upstream: null,
    log: { level: 'info' },
  };
}

function fakePool(): Pool {
  return {
    query: async () => ({ rows: [{ '?column?': 1 }] }),
  } as unknown as Pool;
}

describe('POST /v1/trust/score (T-2.11a)', () => {
  it('returns the TrustScoreResponse body verbatim on success', async () => {
    const scoreResponse = {
      skill_id: 'skill-1',
      trust_score: 0.87,
      trust_tier: 'B' as const,
      trust_breakdown: { code_quality: 0.9, provenance: 0.85 },
      scored_at: '2026-06-28T12:00:00.000Z',
      tokens_consumed: 42,
    };
    const score = vi.fn().mockResolvedValue({ response: scoreResponse, budget: null });
    const services = { trustClient: { score } } as unknown as AppServices;

    const app = createApp(buildConfig(), fakePool(), services);
    const res = await app.request('/v1/trust/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill_id: 'skill-1' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(scoreResponse);
    expect(score).toHaveBeenCalledWith({ skill_id: 'skill-1' });
  });

  it('does NOT leak the budget snapshot into the public response', async () => {
    const scoreResponse = {
      skill_id: 'skill-1',
      trust_score: 0.5,
      trust_tier: 'C' as const,
      trust_breakdown: {},
      scored_at: '2026-06-28T12:00:00.000Z',
      tokens_consumed: 10,
    };
    const budget = {
      tenantId: 't-1',
      plan: 'starter' as const,
      tokensTotal: 1000,
      tokensRemaining: 500,
      tokensResetAt: '2026-07-01T00:00:00.000Z',
      lowBalance: false,
      cachedAt: '2026-06-28T12:00:00.000Z',
    };
    const services = {
      trustClient: {
        score: async () => ({ response: scoreResponse, budget }),
      },
    } as unknown as AppServices;

    const app = createApp(buildConfig(), fakePool(), services);
    const res = await app.request('/v1/trust/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill_id: 'skill-1' }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('budget');
    expect(body).not.toHaveProperty('tokens_remaining');
  });

  it('maps budget_exhausted → 402 with retry_after preserved', async () => {
    const services = {
      trustClient: {
        score: async () => {
          throw new UpstreamError('budget_exhausted', 'out of tokens', {
            retryAfter: 3600,
          });
        },
      },
    } as unknown as AppServices;

    const app = createApp(buildConfig(), fakePool(), services);
    const res = await app.request('/v1/trust/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill_id: 'skill-1' }),
    });

    expect(res.status).toBe(402);
    const body = (await res.json()) as {
      error: { code: string; retry_after?: number };
    };
    expect(body.error.code).toBe('budget_exhausted');
    expect(body.error.retry_after).toBe(3600);
  });

  it('maps rate_limited → 429', async () => {
    const services = {
      trustClient: {
        score: async () => {
          throw new UpstreamError('rate_limited', 'slow down', {
            retryAfter: 5,
          });
        },
      },
    } as unknown as AppServices;
    const app = createApp(buildConfig(), fakePool(), services);
    const res = await app.request('/v1/trust/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill_id: 'skill-1' }),
    });
    expect(res.status).toBe(429);
  });

  it('maps upstream_timeout → 504', async () => {
    const services = {
      trustClient: {
        score: async () => {
          throw new UpstreamError('upstream_timeout', 'timed out');
        },
      },
    } as unknown as AppServices;
    const app = createApp(buildConfig(), fakePool(), services);
    const res = await app.request('/v1/trust/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill_id: 'skill-1' }),
    });
    expect(res.status).toBe(504);
  });

  it('forwards optional manifest field through validation', async () => {
    const score = vi.fn().mockResolvedValue({
      response: {
        skill_id: 'skill-1',
        trust_score: 0.5,
        trust_tier: 'C' as const,
        trust_breakdown: {},
        scored_at: '2026-06-28T12:00:00.000Z',
        tokens_consumed: 1,
      },
      budget: null,
    });
    const services = { trustClient: { score } } as unknown as AppServices;

    const app = createApp(buildConfig(), fakePool(), services);
    const requestBody = {
      skill_id: 'skill-1',
      manifest: {
        name: 'test-skill',
        version: '1.0.0',
        source: 'local',
        description: 'a test',
      },
      tenant_id: 't-1',
    };
    const res = await app.request('/v1/trust/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    expect(res.status).toBe(200);
    expect(score).toHaveBeenCalledWith(requestBody);
  });
});

describe('GET /v1/leaderboards/:kind (T-2.11a)', () => {
  it('returns the mothership body verbatim on success', async () => {
    const upstreamBody = {
      leaderboard: [
        { skill_id: 's1', rank: 1, score: 0.99 },
        { skill_id: 's2', rank: 2, score: 0.87 },
      ],
      generated_at: '2026-06-28T12:00:00.000Z',
    };
    const getLeaderboard = vi.fn().mockResolvedValue(upstreamBody);
    const services = { upstream: { getLeaderboard } } as unknown as AppServices;

    const app = createApp(buildConfig(), fakePool(), services);
    const res = await app.request('/v1/leaderboards/trending');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(upstreamBody);
    expect(getLeaderboard).toHaveBeenCalledWith('trending', {});
  });

  it('forwards limit + category + ecosystem + skill_type filters', async () => {
    const getLeaderboard = vi.fn().mockResolvedValue({ leaderboard: [] });
    const services = { upstream: { getLeaderboard } } as unknown as AppServices;

    const app = createApp(buildConfig(), fakePool(), services);
    const res = await app.request(
      '/v1/leaderboards/trust?limit=25&category=browser&ecosystem=node&skill_type=agentic',
    );
    expect(res.status).toBe(200);
    expect(getLeaderboard).toHaveBeenCalledWith('trust', {
      limit: 25,
      category: 'browser',
      ecosystem: 'node',
      skill_type: 'agentic',
    });
  });

  it('drops empty-string filters without forwarding them', async () => {
    const getLeaderboard = vi.fn().mockResolvedValue({ leaderboard: [] });
    const services = { upstream: { getLeaderboard } } as unknown as AppServices;

    const app = createApp(buildConfig(), fakePool(), services);
    await app.request('/v1/leaderboards/trust?category=');
    expect(getLeaderboard).toHaveBeenCalledWith('trust', {});
  });

  it('rejects non-integer limit as 400 without touching upstream', async () => {
    const getLeaderboard = vi.fn();
    const services = { upstream: { getLeaderboard } } as unknown as AppServices;

    const app = createApp(buildConfig(), fakePool(), services);
    const res = await app.request('/v1/leaderboards/trust?limit=abc');
    expect(res.status).toBe(400);
    expect(getLeaderboard).not.toHaveBeenCalled();
  });

  it('rejects zero and negative limit as 400', async () => {
    const services = {
      upstream: { getLeaderboard: vi.fn() },
    } as unknown as AppServices;
    const app = createApp(buildConfig(), fakePool(), services);

    const zero = await app.request('/v1/leaderboards/trust?limit=0');
    expect(zero.status).toBe(400);

    const negative = await app.request('/v1/leaderboards/trust?limit=-5');
    expect(negative.status).toBe(400);
  });

  it('rejects non-integer float limit as 400', async () => {
    const services = {
      upstream: { getLeaderboard: vi.fn() },
    } as unknown as AppServices;
    const app = createApp(buildConfig(), fakePool(), services);
    const res = await app.request('/v1/leaderboards/trust?limit=1.5');
    expect(res.status).toBe(400);
  });

  it('maps upstream not_found → 404 (upstream returned no such kind)', async () => {
    const services = {
      upstream: {
        getLeaderboard: async () => {
          throw new UpstreamError('not_found', 'unknown leaderboard kind');
        },
      },
    } as unknown as AppServices;
    const app = createApp(buildConfig(), fakePool(), services);
    const res = await app.request('/v1/leaderboards/does-not-exist');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });

  it('maps upstream_unavailable → 503', async () => {
    const services = {
      upstream: {
        getLeaderboard: async () => {
          throw new UpstreamError('upstream_unavailable', 'circuit open');
        },
      },
    } as unknown as AppServices;
    const app = createApp(buildConfig(), fakePool(), services);
    const res = await app.request('/v1/leaderboards/trust');
    expect(res.status).toBe(503);
  });

  it('maps unauthenticated → 502 (our API key, not caller-side)', async () => {
    const services = {
      upstream: {
        getLeaderboard: async () => {
          throw new UpstreamError('unauthenticated', 'bad api key');
        },
      },
    } as unknown as AppServices;
    const app = createApp(buildConfig(), fakePool(), services);
    const res = await app.request('/v1/leaderboards/trust');
    expect(res.status).toBe(502);
  });

  it('forwards UpstreamError.detail through to the response body', async () => {
    const services = {
      upstream: {
        getLeaderboard: async () => {
          throw new UpstreamError('bad_request', 'invalid filter', {
            detail: { field: 'category', reason: 'unknown' },
          });
        },
      },
    } as unknown as AppServices;
    const app = createApp(buildConfig(), fakePool(), services);
    const res = await app.request('/v1/leaderboards/trust');
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; detail?: Record<string, unknown> };
    };
    expect(body.error.detail).toEqual({ field: 'category', reason: 'unknown' });
  });
});

describe('GET /v1/skills/:id (T-2.11b)', () => {
  it('returns the SkillDetail body verbatim on local hit', async () => {
    const skill = {
      id: 'local-uuid-1',
      slug: 'test-skill',
      name: 'test-skill',
      version: '1.0.0',
      source: 'local',
    };
    const getSkill = vi
      .fn()
      .mockResolvedValue({ source: 'local', skill });
    const services = { skillsClient: { getSkill } } as unknown as AppServices;

    const app = createApp(buildConfig(), fakePool(), services);
    const res = await app.request('/v1/skills/test-skill');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(skill);
    expect(getSkill).toHaveBeenCalledWith('test-skill');
  });

  it('returns upstream-cached body verbatim on local miss + upstream hit', async () => {
    const skill = {
      id: 'ms-uuid-1',
      slug: 'upstream-skill',
      name: 'upstream-skill',
      version: '2.0.0',
      source: 'upstream',
    };
    const services = {
      skillsClient: {
        getSkill: async () => ({ source: 'upstream', skill }),
      },
    } as unknown as AppServices;

    const app = createApp(buildConfig(), fakePool(), services);
    const res = await app.request('/v1/skills/upstream-skill');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(skill);
  });

  it('maps air-gap not_found → 404 with truthful code', async () => {
    const services = {
      skillsClient: {
        getSkill: async () => {
          throw new UpstreamError(
            'not_found',
            'no local skill with id x (air-gap mode)',
          );
        },
      },
    } as unknown as AppServices;

    const app = createApp(buildConfig(), fakePool(), services);
    const res = await app.request('/v1/skills/does-not-exist');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });

  it('maps upstream_unavailable → 503', async () => {
    const services = {
      skillsClient: {
        getSkill: async () => {
          throw new UpstreamError('upstream_unavailable', 'circuit open');
        },
      },
    } as unknown as AppServices;
    const app = createApp(buildConfig(), fakePool(), services);
    const res = await app.request('/v1/skills/anything');
    expect(res.status).toBe(503);
  });

  it('maps upstream_timeout → 504', async () => {
    const services = {
      skillsClient: {
        getSkill: async () => {
          throw new UpstreamError('upstream_timeout', 'timed out');
        },
      },
    } as unknown as AppServices;
    const app = createApp(buildConfig(), fakePool(), services);
    const res = await app.request('/v1/skills/anything');
    expect(res.status).toBe(504);
  });

  it('maps rate_limited → 429', async () => {
    const services = {
      skillsClient: {
        getSkill: async () => {
          throw new UpstreamError('rate_limited', 'slow down', {
            retryAfter: 30,
          });
        },
      },
    } as unknown as AppServices;
    const app = createApp(buildConfig(), fakePool(), services);
    const res = await app.request('/v1/skills/anything');
    expect(res.status).toBe(429);
    const body = (await res.json()) as {
      error: { code: string; retry_after?: number };
    };
    expect(body.error.retry_after).toBe(30);
  });

  it('maps bad_request with empty id → 400', async () => {
    // Empty id after `/skills/` collapses to `/skills` which is POST-only,
    // so this route only fires for non-empty ids. Simulate the client-side
    // guard by throwing bad_request explicitly.
    const services = {
      skillsClient: {
        getSkill: async () => {
          throw new UpstreamError(
            'bad_request',
            'skill id must be non-empty',
          );
        },
      },
    } as unknown as AppServices;
    const app = createApp(buildConfig(), fakePool(), services);
    const res = await app.request('/v1/skills/%20'); // encoded space
    expect(res.status).toBe(400);
  });
});

describe('POST /v1/skills (T-2.11b)', () => {
  const validRequest = {
    manifest: {
      name: 'my-skill',
      slug: 'my-skill',
      version: '1.0.0',
      source: 'local',
      description: 'a skill',
      execution_layer: 'sandboxed',
    },
  };

  it('returns 201 + LocalPublishResult on happy path', async () => {
    const publishLocal = vi.fn().mockResolvedValue({
      id: 'local-uuid-1',
      slug: 'my-skill',
      version: '1.0.0',
      status: 'published',
    });
    const services = {
      skillsClient: { publishLocal },
    } as unknown as AppServices;

    const app = createApp(buildConfig(), fakePool(), services);
    const res = await app.request('/v1/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validRequest),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: 'local-uuid-1',
      slug: 'my-skill',
      version: '1.0.0',
      status: 'published',
    });
    expect(publishLocal).toHaveBeenCalledWith(validRequest);
  });

  it('rejects invalid body with 400 bad_request + issues detail', async () => {
    const publishLocal = vi.fn();
    const services = {
      skillsClient: { publishLocal },
    } as unknown as AppServices;
    const app = createApp(buildConfig(), fakePool(), services);
    const res = await app.request('/v1/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'missing-slug-and-version' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; detail?: { issues?: unknown[] } };
    };
    expect(body.error.code).toBe('bad_request');
    expect(Array.isArray(body.error.detail?.issues)).toBe(true);
    expect(publishLocal).not.toHaveBeenCalled();
  });

  it('rejects non-JSON body with 400', async () => {
    const publishLocal = vi.fn();
    const services = {
      skillsClient: { publishLocal },
    } as unknown as AppServices;
    const app = createApp(buildConfig(), fakePool(), services);
    const res = await app.request('/v1/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json{{',
    });
    expect(res.status).toBe(400);
    expect(publishLocal).not.toHaveBeenCalled();
  });

  it('maps unique-slug bad_request → 400 with detail preserved', async () => {
    const services = {
      skillsClient: {
        publishLocal: async () => {
          throw new UpstreamError(
            'bad_request',
            'slug already exists: my-skill',
            {
              detail: {
                slug: 'my-skill',
                constraint: 'unique_violation',
              },
            },
          );
        },
      },
    } as unknown as AppServices;
    const app = createApp(buildConfig(), fakePool(), services);
    const res = await app.request('/v1/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validRequest),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; detail?: Record<string, unknown> };
    };
    expect(body.error.code).toBe('bad_request');
    expect(body.error.detail).toEqual({
      slug: 'my-skill',
      constraint: 'unique_violation',
    });
  });

  it('propagates unrelated UpstreamError codes (e.g. upstream_unavailable → 503)', async () => {
    // publishLocal itself doesn't call upstream, but the handler still
    // routes any UpstreamError through the shared mapper so nothing leaks.
    const services = {
      skillsClient: {
        publishLocal: async () => {
          throw new UpstreamError('upstream_unavailable', 'db down');
        },
      },
    } as unknown as AppServices;
    const app = createApp(buildConfig(), fakePool(), services);
    const res = await app.request('/v1/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validRequest),
    });
    expect(res.status).toBe(503);
  });
});
