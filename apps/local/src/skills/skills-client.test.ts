// ══════════════════════════════════════════════════════════════════════════════
// skills-client.test.ts — unit coverage for T-2.11b's SkillsClient.
// ══════════════════════════════════════════════════════════════════════════════
//
// The route wiring in `routes/public.ts` is thin — the interesting logic
// (local-first resolution, air-gap → not_found collapse, write-through
// cache, pg-error mapping) lives here.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { UpstreamError } from '../upstream-client/errors.js';
import type { UpstreamClient } from '../upstream-client/index.js';
import { SkillsClient, formatSkillDetail } from './skills-client.js';

function makeUpstream(overrides: Partial<UpstreamClient> = {}): UpstreamClient {
  return {
    getSkill: async () => {
      throw new UpstreamError(
        'upstream_not_configured',
        'air-gap',
      );
    },
    ...overrides,
  } as unknown as UpstreamClient;
}

/**
 * Programmable pool. The test hands in an ordered list of expected
 * `query` results; each `pool.query(...)` call pops one off. The recorded
 * (sql, params) pairs are asserted where meaningful.
 */
interface QueryCall {
  sql: string;
  params: unknown[];
}
function makePool(
  results: Array<
    | { rowCount: number; rows: Record<string, unknown>[] }
    | { throw: unknown }
  >,
): { pool: Pool; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  let idx = 0;
  const query = async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    const step = results[idx++];
    if (step === undefined) {
      throw new Error(`unexpected extra query at index ${idx}: ${sql}`);
    }
    if ('throw' in step) throw step.throw;
    return step;
  };
  return { pool: { query } as unknown as Pool, calls };
}

const SILENT_LOGGER = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

// ── getSkill ────────────────────────────────────────────────────────────

describe('SkillsClient.getSkill', () => {
  it('rejects empty id as bad_request without touching upstream or pool', async () => {
    const { pool, calls } = makePool([]);
    const upstream = makeUpstream();
    const client = new SkillsClient({ upstream, pool, logger: SILENT_LOGGER });
    await expect(client.getSkill('   ')).rejects.toMatchObject({
      code: 'bad_request',
    });
    expect(calls).toHaveLength(0);
  });

  it('returns a formatted local row when the DB has the skill', async () => {
    const row = mkRow({ id: 'uuid-1', slug: 'demo', name: 'Demo' });
    const { pool, calls } = makePool([{ rowCount: 1, rows: [row] }]);
    const upstreamGetSkill = vi.fn();
    const upstream = makeUpstream({ getSkill: upstreamGetSkill });
    const client = new SkillsClient({ upstream, pool, logger: SILENT_LOGGER });

    const result = await client.getSkill('demo');
    expect(result.source).toBe('local');
    const skill = result.skill as Record<string, unknown>;
    expect(skill.id).toBe('uuid-1');
    expect(skill.slug).toBe('demo');
    expect(skill.name).toBe('Demo');
    // Ensure upstream was never touched.
    expect(upstreamGetSkill).not.toHaveBeenCalled();
    // Ensure the SELECT matched id | slug | mothership_skill_id.
    expect(calls[0]?.sql).toMatch(/id::text = \$1/);
    expect(calls[0]?.sql).toMatch(/OR slug = \$1/);
    expect(calls[0]?.sql).toMatch(/OR mothership_skill_id = \$1/);
    expect(calls[0]?.params).toEqual(['demo']);
  });

  it('falls back to upstream on local miss and returns upstream body verbatim', async () => {
    const upstreamBody = {
      id: 'motherhip-uuid',
      slug: 'demo',
      name: 'Demo',
      version: '1.0.0',
      source: 'publish',
      executionLayer: 'api',
      trustTier: 'B',
      trustScoreV2: 0.7,
      shareUrl: 'https://api.skillsregistry.net/skills/demo',
    };
    const { pool, calls } = makePool([
      { rowCount: 0, rows: [] }, // local miss
      { rowCount: 1, rows: [] }, // write-through insert
    ]);
    const getSkill = vi.fn().mockResolvedValue(upstreamBody);
    const upstream = makeUpstream({ getSkill });
    const client = new SkillsClient({ upstream, pool, logger: SILENT_LOGGER });

    const result = await client.getSkill('demo');
    expect(result.source).toBe('upstream');
    expect(result.skill).toBe(upstreamBody);
    expect(getSkill).toHaveBeenCalledWith('demo');
    // Second call is the write-through INSERT ... ON CONFLICT.
    expect(calls[1]?.sql).toMatch(/INSERT INTO skills/);
    expect(calls[1]?.sql).toMatch(/ON CONFLICT \(slug\) DO UPDATE/);
  });

  it('collapses upstream_not_configured to not_found (air-gap mode)', async () => {
    const { pool } = makePool([{ rowCount: 0, rows: [] }]);
    const upstream = makeUpstream(); // default throws upstream_not_configured
    const client = new SkillsClient({ upstream, pool, logger: SILENT_LOGGER });
    await expect(client.getSkill('nonexistent')).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('propagates non-air-gap upstream errors unchanged', async () => {
    const { pool } = makePool([{ rowCount: 0, rows: [] }]);
    const upstream = makeUpstream({
      getSkill: async () => {
        throw new UpstreamError('rate_limited', 'slow down', { retryAfter: 5 });
      },
    });
    const client = new SkillsClient({ upstream, pool, logger: SILENT_LOGGER });
    await expect(client.getSkill('some-id')).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfter: 5,
    });
  });

  it('does not fail the response when the write-through cache errors', async () => {
    const upstreamBody = {
      id: 'x',
      slug: 'demo',
      name: 'Demo',
      version: '1.0.0',
      source: 'publish',
      executionLayer: 'api',
    };
    const { pool } = makePool([
      { rowCount: 0, rows: [] },
      { throw: new Error('cache boom') },
    ]);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const upstream = makeUpstream({
      getSkill: async () => upstreamBody,
    });
    const client = new SkillsClient({ upstream, pool, logger });
    const result = await client.getSkill('demo');
    expect(result.source).toBe('upstream');
    expect(result.skill).toBe(upstreamBody);
    expect(logger.error).toHaveBeenCalledWith(
      'writeThrough failed',
      expect.objectContaining({ slug: 'demo' }),
    );
  });

  it('skips write-through when upstream body lacks required cache columns', async () => {
    const upstreamBody = { id: 'x', slug: 'demo' }; // no name/version/etc.
    const { pool, calls } = makePool([{ rowCount: 0, rows: [] }]);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const upstream = makeUpstream({
      getSkill: async () => upstreamBody,
    });
    const client = new SkillsClient({ upstream, pool, logger });
    const result = await client.getSkill('demo');
    expect(result.source).toBe('upstream');
    // No second query — write-through short-circuited.
    expect(calls).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'writeThrough: upstream body missing required fields',
      expect.objectContaining({ slug: 'demo' }),
    );
  });

  it('skips write-through when upstream body has no slug', async () => {
    const upstreamBody = { id: 'x' }; // no slug at all
    const { pool, calls } = makePool([{ rowCount: 0, rows: [] }]);
    const upstream = makeUpstream({
      getSkill: async () => upstreamBody,
    });
    const client = new SkillsClient({ upstream, pool, logger: SILENT_LOGGER });
    await client.getSkill('demo');
    expect(calls).toHaveLength(1);
  });

  it('skips write-through when upstream body is not an object', async () => {
    const { pool, calls } = makePool([{ rowCount: 0, rows: [] }]);
    const upstream = makeUpstream({
      getSkill: async () => 'not-an-object',
    });
    const client = new SkillsClient({ upstream, pool, logger: SILENT_LOGGER });
    await client.getSkill('demo');
    expect(calls).toHaveLength(1);
  });
});

// ── publishLocal ────────────────────────────────────────────────────────

describe('SkillsClient.publishLocal', () => {
  const validRequest = {
    manifest: {
      name: 'Demo',
      slug: 'demo',
      version: '1.0.0',
      source: 'publish',
      execution_layer: 'api',
    },
  };

  it('inserts a local row and returns { id, slug, version, status }', async () => {
    const { pool, calls } = makePool([
      {
        rowCount: 1,
        rows: [
          { id: 'local-uuid', slug: 'demo', version: '1.0.0', status: 'published' },
        ],
      },
    ]);
    const upstream = makeUpstream();
    const client = new SkillsClient({ upstream, pool, logger: SILENT_LOGGER });
    const result = await client.publishLocal(validRequest);
    expect(result).toEqual({
      id: 'local-uuid',
      slug: 'demo',
      version: '1.0.0',
      status: 'published',
    });
    // Ensure it's an INSERT with RETURNING.
    expect(calls[0]?.sql).toMatch(/INSERT INTO skills/);
    expect(calls[0]?.sql).toMatch(/RETURNING id, slug, version, status/);
    // Ensure manifest values were forwarded.
    const params = calls[0]?.params as unknown[];
    expect(params).toContain('Demo');
    expect(params).toContain('demo');
    expect(params).toContain('1.0.0');
    expect(params).toContain('publish');
    expect(params).toContain('api');
  });

  it('forwards optional manifest fields (description, tags, mcp_url)', async () => {
    const { pool, calls } = makePool([
      {
        rowCount: 1,
        rows: [
          { id: 'x', slug: 'demo', version: '1.0.0', status: 'published' },
        ],
      },
    ]);
    const upstream = makeUpstream();
    const client = new SkillsClient({ upstream, pool, logger: SILENT_LOGGER });
    await client.publishLocal({
      manifest: {
        ...validRequest.manifest,
        description: 'A demo',
        agent_summary: 'demo summary',
        tags: ['demo', 'test'],
        category: 'tools',
        mcp_url: 'https://example.com/mcp',
        source_url: 'https://example.com/src',
        repository_url: 'https://github.com/demo/demo',
        skill_md: '# Demo',
        schema_json: { type: 'object' },
        install_method: { npm: 'demo' },
      },
      publisher_key_id: 'key-1',
      signature: 'sig-1',
    });
    const params = calls[0]?.params as unknown[];
    expect(params).toContain('A demo');
    expect(params).toContain('demo summary');
    expect(params).toEqual(expect.arrayContaining([['demo', 'test']]));
    expect(params).toContain('tools');
    expect(params).toContain('https://example.com/mcp');
    expect(params).toContain('key-1');
    expect(params).toContain('sig-1');
  });

  it('persists manifest.sandbox in the sandbox jsonb column', async () => {
    const { pool, calls } = makePool([
      {
        rowCount: 1,
        rows: [
          { id: 'x', slug: 'demo', version: '1.0.0', status: 'published' },
        ],
      },
    ]);
    const upstream = makeUpstream();
    const client = new SkillsClient({ upstream, pool, logger: SILENT_LOGGER });
    const sandbox = {
      image: 'ghcr.io/cognium-labs/skill-base:1.0.0',
      memory_mb: 1024,
      cpu: 2,
      timeout_seconds: 600,
      egress: ['api.osv.dev', 'api.github.com'],
    };
    await client.publishLocal({
      manifest: { ...validRequest.manifest, sandbox },
    });
    const insertSql = calls[0]?.sql ?? '';
    expect(insertSql).toMatch(/\bsandbox\b/);
    const params = calls[0]?.params as unknown[];
    expect(params).toContainEqual(sandbox);
  });

  it('persists null in the sandbox column when the manifest omits it', async () => {
    const { pool, calls } = makePool([
      {
        rowCount: 1,
        rows: [
          { id: 'x', slug: 'demo', version: '1.0.0', status: 'published' },
        ],
      },
    ]);
    const upstream = makeUpstream();
    const client = new SkillsClient({ upstream, pool, logger: SILENT_LOGGER });
    await client.publishLocal(validRequest);
    // sandbox is the last positional param — asserting the array ends in null.
    const params = calls[0]?.params as unknown[];
    expect(params?.at(-1)).toBeNull();
  });

  it('maps pg unique_violation (23505) → bad_request with slug detail', async () => {
    const uniqueErr = Object.assign(new Error('duplicate key'), {
      code: '23505',
    });
    const { pool } = makePool([{ throw: uniqueErr }]);
    const upstream = makeUpstream();
    const client = new SkillsClient({ upstream, pool, logger: SILENT_LOGGER });
    await expect(client.publishLocal(validRequest)).rejects.toMatchObject({
      code: 'bad_request',
      detail: { slug: 'demo', constraint: 'unique_violation' },
    });
  });

  it('maps pg not_null_violation (23502) → bad_request', async () => {
    const notNullErr = Object.assign(new Error('null value'), {
      code: '23502',
    });
    const { pool } = makePool([{ throw: notNullErr }]);
    const upstream = makeUpstream();
    const client = new SkillsClient({ upstream, pool, logger: SILENT_LOGGER });
    await expect(client.publishLocal(validRequest)).rejects.toMatchObject({
      code: 'bad_request',
      detail: { pg_code: '23502' },
    });
  });

  it('propagates unknown errors unchanged (they are not UpstreamErrors)', async () => {
    const boom = new Error('network');
    const { pool } = makePool([{ throw: boom }]);
    const upstream = makeUpstream();
    const client = new SkillsClient({ upstream, pool, logger: SILENT_LOGGER });
    await expect(client.publishLocal(validRequest)).rejects.toBe(boom);
  });
});

// ── formatSkillDetail ──────────────────────────────────────────────────

describe('formatSkillDetail', () => {
  it('maps snake_case columns to the camelCase SkillDetail shape', () => {
    const row = mkRow({
      id: 'x',
      slug: 'demo',
      name: 'Demo',
      description: 'body',
      agent_summary: 'summary',
      trust_score: '0.85',
      trust_score_v2: 0.9,
      trust_tier: 'B',
      execution_layer: 'api',
      runtime_env: 'api',
      visibility: 'public',
      tags: ['a', 'b'],
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      cognium_scanned_at: new Date('2026-01-02T00:00:00.000Z'),
    });
    const detail = formatSkillDetail(row);
    expect(detail.slug).toBe('demo');
    expect(detail.description).toBe('body');
    expect(detail.agentSummary).toBe('summary');
    // trust_score comes back as a string from pg NUMERIC — coerced to number.
    expect(detail.trustScore).toBe(0.85);
    expect(detail.trustScoreV2).toBe(0.9);
    expect(detail.trustTier).toBe('B');
    expect(detail.executionLayer).toBe('api');
    expect(detail.tags).toEqual(['a', 'b']);
    expect(detail.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(detail.cogniumScanned).toBe(true);
    expect(detail.cogniumScannedAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('uses mothership_url as shareUrl when present, else falls back to /skills/<slug>', () => {
    const rowWithUrl = mkRow({
      slug: 'demo',
      mothership_url: 'https://api.skillsregistry.net/skills/demo',
    });
    expect(formatSkillDetail(rowWithUrl).shareUrl).toBe(
      'https://api.skillsregistry.net/skills/demo',
    );
    const rowNoUrl = mkRow({ slug: 'other', mothership_url: null });
    expect(formatSkillDetail(rowNoUrl).shareUrl).toBe('/skills/other');
  });

  it('coalesces null nullable-scalar columns to their SkillDetail defaults', () => {
    const row = mkRow({
      description: null,
      trust_score: null,
      run_count: null,
      agent_invocation_count: null,
      human_star_count: null,
      human_fork_count: null,
    });
    const detail = formatSkillDetail(row);
    expect(detail.description).toBe(''); // schema disallows null on description
    expect(detail.trustScore).toBe(0);
    expect(detail.runCount).toBe(0);
    expect(detail.agentInvocationCount).toBe(0);
    expect(detail.humanStarCount).toBe(0);
    expect(detail.humanForkCount).toBe(0);
  });

  it('coerces bigint agent_invocation_count (pg returns string) to number', () => {
    const row = mkRow({ agent_invocation_count: '12345' });
    expect(formatSkillDetail(row).agentInvocationCount).toBe(12345);
  });

  it('serializes structured auth_requirements / install_method as JSON strings', () => {
    const row = mkRow({
      auth_requirements: { api_key: true },
      install_method: { npm: 'demo' },
    });
    const detail = formatSkillDetail(row);
    expect(detail.authRequirements).toBe('{"api_key":true}');
    expect(detail.installMethod).toBe('{"npm":"demo"}');
  });
});

// ── helpers ─────────────────────────────────────────────────────────────

function mkRow(overrides: Record<string, unknown> = {}): never {
  const base = {
    id: 'uuid-default',
    name: 'row',
    slug: 'row-slug',
    version: '1.0.0',
    source: 'publish',
    description: null,
    agent_summary: null,
    trust_score: null,
    verification_tier: null,
    trust_badge: null,
    status: 'published',
    execution_layer: 'api',
    mcp_url: null,
    skill_md: null,
    capabilities_required: null,
    skill_type: 'atomic',
    schema_json: null,
    source_url: null,
    tags: null,
    category: null,
    categories: null,
    ecosystem: null,
    language: null,
    license: null,
    readme: null,
    r2_bundle_key: null,
    auth_requirements: null,
    install_method: null,
    forked_from: null,
    run_count: 0,
    last_run_at: null,
    author_id: null,
    author_type: 'human',
    tenant_id: null,
    revoked_reason: null,
    remediation_message: null,
    remediation_url: null,
    replacement_skill_id: null,
    avg_execution_time_ms: null,
    error_rate: null,
    human_star_count: 0,
    human_fork_count: 0,
    agent_invocation_count: 0,
    runtime_env: 'api',
    visibility: 'public',
    environment_variables: null,
    cognium_scanned_at: null,
    scan_coverage: null,
    content_safety_passed: null,
    quality_score: null,
    quality_tier: null,
    quality_results: null,
    quality_analyzed_at: null,
    trust_score_v2: null,
    trust_tier: null,
    trust_results: null,
    trust_analyzed_at: null,
    understand_results: null,
    understand_analyzed_at: null,
    spec_alignment_score: null,
    spec_gaps: null,
    spec_analyzed_at: null,
    publisher_key_id: null,
    signature_verified_at: null,
    signature_failure_reason: null,
    created_at: null,
    updated_at: null,
    published_at: null,
    mothership_skill_id: null,
    mothership_url: null,
  };
  return { ...base, ...overrides } as never;
}
