// ══════════════════════════════════════════════════════════════════════════════
// PgVectorProvider — search / vector / full-text / SQL-shape tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Verifies the SqlPool port is called with the expected query shape + params
// for the branches that the fusion test doesn't cover:
//   - vectorSearch WHERE clause (tenant scope, blocked statuses, allowVulnerable,
//     statusFilter override, minTrustScore, tags, category, executionLayer,
//     visibility, runtimeEnv, portable, slug/version pin)
//   - fullTextSearch WHERE clause + tsvector plumbing
//   - search() end-to-end: fusion → trust boost → pagination → enrich → confidence
//   - getEmbeddingStamps read path (null / row / pre-A7 sentinel)
//   - delete + healthCheck side channels
//
// No real Postgres. Every test wires a scripted `SqlPool` that returns
// canned rows and captures the (sql, params) tuples for assertion.
//
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgVectorProvider } from './pgvector-provider.js';
import type { SqlPool, SqlQueryResult } from '../adapters/sql.js';
import type { SearchFilters } from '../types.js';

// ──────────────────────────────────────────────────────────────────────────────
// Scriptable pool: return canned rows in order, capture calls
// ──────────────────────────────────────────────────────────────────────────────

interface QueryLog {
  sql: string;
  params: readonly unknown[] | undefined;
}

function scriptedPool(responses: SqlQueryResult<Record<string, unknown>>[]): {
  pool: SqlPool;
  log: QueryLog[];
} {
  const log: QueryLog[] = [];
  let i = 0;
  const query = vi.fn(async (sql: string, params?: readonly unknown[]) => {
    log.push({ sql, params });
    const r = responses[i++];
    if (!r) throw new Error(`scriptedPool: unexpected extra query #${i}\nSQL:\n${sql}`);
    return r;
  });
  return {
    log,
    pool: {
      query,
      connect: vi.fn(),
    } as unknown as SqlPool,
  };
}

function ok<T = Record<string, unknown>>(rows: T[]): SqlQueryResult<T> {
  return { rows, rowCount: rows.length };
}

const filters = (over: Partial<SearchFilters> = {}): SearchFilters => ({
  tenantId: 'tenant_x',
  ...over,
});

const embedding = () => Array.from({ length: 512 }, (_, i) => i / 512);

// ══════════════════════════════════════════════════════════════════════════════
// vectorSearch — WHERE clause & param packing (private → bracket)
// ══════════════════════════════════════════════════════════════════════════════

describe('PgVectorProvider — vectorSearch WHERE clause', () => {
  function callVector(
    provider: PgVectorProvider,
    filters: SearchFilters,
    limit = 10,
    emb = embedding(),
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (provider as any).vectorSearch(emb, filters, limit);
  }

  it('always includes tenant scope + public "default"', async () => {
    const { pool, log } = scriptedPool([ok([])]);
    const p = new PgVectorProvider({ pool });
    await callVector(p, filters());

    expect(log[0]!.sql).toContain("se.tenant_id IN ($1, 'default')");
    expect(log[0]!.params?.[0]).toBe('tenant_x');
  });

  it('always excludes BLOCKED_STATUSES (revoked/draft/degraded)', async () => {
    const { pool, log } = scriptedPool([ok([])]);
    const p = new PgVectorProvider({ pool });
    await callVector(p, filters());

    expect(log[0]!.sql).toContain('s.status NOT IN');
    expect(log[0]!.params).toEqual(
      expect.arrayContaining(['revoked', 'draft', 'degraded']),
    );
  });

  it('excludes vulnerable + contains-vulnerable when allowVulnerable is falsy', async () => {
    const { pool, log } = scriptedPool([ok([])]);
    const p = new PgVectorProvider({ pool });
    await callVector(p, filters());

    expect(log[0]!.params).toEqual(
      expect.arrayContaining(['vulnerable', 'contains-vulnerable']),
    );
  });

  it('does NOT exclude vulnerable when allowVulnerable=true', async () => {
    const { pool, log } = scriptedPool([ok([])]);
    const p = new PgVectorProvider({ pool });
    await callVector(p, filters({ allowVulnerable: true }));

    const params = log[0]!.params as unknown[];
    expect(params).not.toContain('vulnerable');
    expect(params).not.toContain('contains-vulnerable');
  });

  it('appends explicit statusFilter (excluding BLOCKED_STATUSES)', async () => {
    const { pool, log } = scriptedPool([ok([])]);
    const p = new PgVectorProvider({ pool });
    await callVector(
      p,
      filters({
        allowVulnerable: true,
        statusFilter: ['published', 'vulnerable', 'revoked'], // revoked is blocked → filtered
      }),
    );

    const params = log[0]!.params as unknown[];
    expect(log[0]!.sql).toContain('s.status IN');
    expect(params).toContain('published');
    expect(params).toContain('vulnerable');
    // BLOCKED entries are stripped before being added to the IN () clause
    const revokedOccurrences = params.filter((p) => p === 'revoked').length;
    // Only the always-excluded NOT IN clause params ["revoked", "draft", "degraded"]
    expect(revokedOccurrences).toBe(1);
  });

  it('applies minTrustScore predicate', async () => {
    const { pool, log } = scriptedPool([ok([])]);
    const p = new PgVectorProvider({ pool });
    await callVector(p, filters({ minTrustScore: 0.7 }));

    expect(log[0]!.sql).toContain('s.trust_score >=');
    expect(log[0]!.params).toEqual(expect.arrayContaining([0.7]));
  });

  it('applies content_safety_passed=true unless contentSafetyRequired=false', async () => {
    const { pool, log } = scriptedPool([ok([])]);
    const p = new PgVectorProvider({ pool });
    await callVector(p, filters());
    expect(log[0]!.sql).toContain('s.content_safety_passed = true');
  });

  it('omits content_safety predicate when contentSafetyRequired=false', async () => {
    const { pool, log } = scriptedPool([ok([])]);
    const p = new PgVectorProvider({ pool });
    await callVector(p, filters({ contentSafetyRequired: false }));
    expect(log[0]!.sql).not.toContain('s.content_safety_passed');
  });

  it('applies executionLayer, category, tags, runtimeEnv, portable filters', async () => {
    const { pool, log } = scriptedPool([ok([])]);
    const p = new PgVectorProvider({ pool });
    await callVector(
      p,
      filters({
        executionLayer: 'mcp-remote',
        category: 'devtools',
        tags: ['ai', 'ml'],
        runtimeEnv: ['worker', 'node'],
        portable: true,
      }),
    );

    const sql = log[0]!.sql;
    const params = log[0]!.params as unknown[];
    expect(sql).toContain('s.execution_layer =');
    expect(sql).toContain('s.category =');
    expect(sql).toContain('s.tags &&');
    expect(sql).toContain('s.runtime_env = ANY');
    expect(sql).toContain('s.portable = true');
    expect(params).toContain('mcp-remote');
    expect(params).toContain('devtools');
    expect(params).toContainEqual(['ai', 'ml']);
    expect(params).toContainEqual(['worker', 'node']);
  });

  it('defaults visibility clause to public OR (own private/unlisted)', async () => {
    const { pool, log } = scriptedPool([ok([])]);
    const p = new PgVectorProvider({ pool });
    await callVector(p, filters());

    expect(log[0]!.sql).toContain("s.visibility = 'public'");
    expect(log[0]!.sql).toContain("s.visibility IN ('private', 'unlisted')");
  });

  it('applies explicit visibility filter when provided', async () => {
    const { pool, log } = scriptedPool([ok([])]);
    const p = new PgVectorProvider({ pool });
    await callVector(p, filters({ visibility: 'private' }));

    const params = log[0]!.params as unknown[];
    expect(log[0]!.sql).toContain('s.visibility =');
    expect(params).toContain('private');
  });

  it('applies slug + version pin', async () => {
    const { pool, log } = scriptedPool([ok([])]);
    const p = new PgVectorProvider({ pool });
    await callVector(p, filters({ slug: 'foo', version: '1.2.3' }));

    const params = log[0]!.params as unknown[];
    expect(log[0]!.sql).toContain('s.slug =');
    expect(log[0]!.sql).toContain('s.version =');
    expect(params).toContain('foo');
    expect(params).toContain('1.2.3');
  });

  it('embeds vector as $2 with halfvec cast + IS NOT NULL guard', async () => {
    const { pool, log } = scriptedPool([ok([])]);
    const p = new PgVectorProvider({ pool });
    await callVector(p, filters());

    expect(log[0]!.sql).toContain('$2::halfvec');
    expect(log[0]!.sql).toContain('se.embedding IS NOT NULL');
  });

  it('parses trust_score as float, defaulting to 0.5 on non-numeric', async () => {
    const { pool } = scriptedPool([
      ok([
        { skill_id: 'a', score: 0.9, match_source: 'agent_summary', match_text: 't', trust_score: '0.87' },
        { skill_id: 'b', score: 0.5, match_source: 'agent_summary', match_text: 't', trust_score: 'garbage' },
      ]),
    ]);
    const p = new PgVectorProvider({ pool });
    const rows = await callVector(p, filters());
    expect(rows).toEqual([
      expect.objectContaining({ skillId: 'a', trustScore: 0.87 }),
      expect.objectContaining({ skillId: 'b', trustScore: 0.5 }),
    ]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// fullTextSearch — SQL shape + normalization + error swallow
// ══════════════════════════════════════════════════════════════════════════════

describe('PgVectorProvider — fullTextSearch', () => {
  function callFT(provider: PgVectorProvider, q: string, f: SearchFilters, limit = 10) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (provider as any).fullTextSearch(q, f, limit);
  }

  it('uses plainto_tsquery with english config', async () => {
    const { pool, log } = scriptedPool([ok([])]);
    const p = new PgVectorProvider({ pool });
    await callFT(p, 'hello world', filters());

    expect(log[0]!.sql).toContain("plainto_tsquery('english'");
    expect(log[0]!.sql).toContain('se.tsv @@');
  });

  it('normalizes raw_score by max for 0–1 output', async () => {
    const { pool } = scriptedPool([
      ok([
        { skill_id: 'a', raw_score: 1.0, keyword_hits: 3 },
        { skill_id: 'b', raw_score: 0.5, keyword_hits: 1 },
      ]),
    ]);
    const p = new PgVectorProvider({ pool });
    const rows = await callFT(p, 'q', filters());
    expect(rows).toEqual([
      { skillId: 'a', score: 1.0, keywordHits: 3 },
      { skillId: 'b', score: 0.5, keywordHits: 1 },
    ]);
  });

  it('returns [] and logs to console.error when the SQL throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const query = vi.fn().mockRejectedValue(new Error('boom'));
    const pool = { query, connect: vi.fn() } as unknown as SqlPool;
    const p = new PgVectorProvider({ pool });
    const rows = await callFT(p, '', filters());
    expect(rows).toEqual([]);
    expect(errSpy).toHaveBeenCalledWith('Full-text search error:', expect.any(Error));
    errSpy.mockRestore();
  });

  it('parses non-numeric keyword_hits to 0', async () => {
    const { pool } = scriptedPool([
      ok([{ skill_id: 'a', raw_score: 1, keyword_hits: 'nope' }]),
    ]);
    const p = new PgVectorProvider({ pool });
    const rows = await callFT(p, 'q', filters());
    expect(rows[0].keywordHits).toBe(0);
  });

  it('applies status + visibility filters (same builder as vectorSearch)', async () => {
    const { pool, log } = scriptedPool([ok([])]);
    const p = new PgVectorProvider({ pool });
    await callFT(p, 'q', filters());
    expect(log[0]!.sql).toContain('s.status NOT IN');
    expect(log[0]!.sql).toContain("s.visibility = 'public'");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// search() — end-to-end: fusion + trust boost + pagination + enrich + confidence
// ══════════════════════════════════════════════════════════════════════════════

describe('PgVectorProvider — search() orchestration', () => {
  it('runs vector + FTS + enrich → produces confidence + meta', async () => {
    const { pool } = scriptedPool([
      // vectorSearch
      ok([
        { skill_id: 'a', score: 0.9, match_source: 'agent_summary', match_text: 'ta', trust_score: '0.8' },
        { skill_id: 'b', score: 0.6, match_source: 'agent_summary', match_text: 'tb', trust_score: '0.5' },
      ]),
      // fullTextSearch
      ok([
        { skill_id: 'a', raw_score: 1.0, keyword_hits: 2 },
        { skill_id: 'b', raw_score: 0.5, keyword_hits: 1 },
      ]),
      // enrichWithSkillMetadata
      ok([
        {
          id: 'a', name: 'A', slug: 'a', version: '1.0.0', agent_summary: 'A blurb',
          trust_score: '0.8', execution_layer: 'mcp-remote', capabilities_required: ['x'],
          status: 'published', skill_type: 'atomic', verification_tier: 'verified',
          trust_badge: null, forked_from: null, run_count: 10,
          last_run_at: { toISOString: () => '2026-01-01T00:00:00Z' },
          revoked_reason: null, remediation_message: null, remediation_url: null,
          replacement_skill_id: null, publisher_key_id: null,
          signature_verified_at: null, signature_failure_reason: null,
        },
        {
          id: 'b', name: 'B', slug: 'b', version: '1.0.0', agent_summary: 'B blurb',
          trust_score: '0.5', execution_layer: 'mcp-remote', capabilities_required: [],
          status: 'published', skill_type: 'atomic', verification_tier: 'scanned',
          trust_badge: null, forked_from: null, run_count: 0,
          last_run_at: null,
          revoked_reason: null, remediation_message: null, remediation_url: null,
          replacement_skill_id: null, publisher_key_id: null,
          signature_verified_at: null, signature_failure_reason: null,
        },
      ]),
    ]);
    const p = new PgVectorProvider({ pool });
    const result = await p.search('q', embedding(), filters(), { limit: 10 });

    expect(result.results).toHaveLength(2);
    expect(result.results[0]!.skillId).toBe('a');
    expect(result.meta.fusionStrategy).toBe('score_blend');
    expect(result.meta.cacheHit).toBe(false);
    expect(result.meta.totalCandidates).toBe(2);
    expect(result.confidence.tier).toBeGreaterThanOrEqual(1);
    expect(result.confidence.tier).toBeLessThanOrEqual(3);
  });

  it('applies trust boost before pagination (high-trust rescue)', async () => {
    // Two candidates: `a` narrowly higher raw fused score, `b` much higher trust.
    // With trustBoostWeight=1.0 (aggressive), `b` should rank above `a`.
    const { pool } = scriptedPool([
      ok([
        { skill_id: 'a', score: 0.60, match_source: 'agent_summary', match_text: 'ta', trust_score: '0.4' },
        { skill_id: 'b', score: 0.55, match_source: 'agent_summary', match_text: 'tb', trust_score: '0.9' },
      ]),
      ok([]), // no FTS
      ok([
        {
          id: 'b', name: 'B', slug: 'b', version: '1.0.0', agent_summary: '', trust_score: '0.9',
          execution_layer: 'x', capabilities_required: [], status: 'published',
          skill_type: 'atomic', verification_tier: 'verified', trust_badge: null,
          forked_from: null, run_count: 0, last_run_at: null,
          revoked_reason: null, remediation_message: null, remediation_url: null,
          replacement_skill_id: null, publisher_key_id: null,
          signature_verified_at: null, signature_failure_reason: null,
        },
        {
          id: 'a', name: 'A', slug: 'a', version: '1.0.0', agent_summary: '', trust_score: '0.4',
          execution_layer: 'x', capabilities_required: [], status: 'published',
          skill_type: 'atomic', verification_tier: 'scanned', trust_badge: null,
          forked_from: null, run_count: 0, last_run_at: null,
          revoked_reason: null, remediation_message: null, remediation_url: null,
          replacement_skill_id: null, publisher_key_id: null,
          signature_verified_at: null, signature_failure_reason: null,
        },
      ]),
    ]);
    const p = new PgVectorProvider({ pool, trustBoostWeight: 1.0 });
    const result = await p.search('q', embedding(), filters());
    // b boosted: 0.7*0.55 * (1 + 1.0*(0.9-0.5)) = 0.385*1.4 = 0.539
    // a boosted: 0.7*0.60 * (1 + 1.0*(0.4-0.5)) = 0.42 *0.9 = 0.378
    expect(result.results[0]!.skillId).toBe('b');
  });

  it('paginates AFTER trust boost (respects limit/offset)', async () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((id) => ({
      skill_id: id, score: 0.8, match_source: 'agent_summary', match_text: `t${id}`, trust_score: '0.5',
    }));
    const enrich = ['a', 'b', 'c', 'd', 'e'].map((id) => ({
      id, name: id, slug: id, version: '1.0.0', agent_summary: '', trust_score: '0.5',
      execution_layer: 'x', capabilities_required: [], status: 'published',
      skill_type: 'atomic', verification_tier: 'scanned', trust_badge: null,
      forked_from: null, run_count: 0, last_run_at: null,
      revoked_reason: null, remediation_message: null, remediation_url: null,
      replacement_skill_id: null, publisher_key_id: null,
      signature_verified_at: null, signature_failure_reason: null,
    }));
    const { pool } = scriptedPool([ok(rows), ok([]), ok(enrich)]);
    const p = new PgVectorProvider({ pool });
    const result = await p.search('q', embedding(), filters(), { limit: 2, offset: 1 });
    expect(result.results).toHaveLength(2);
  });

  it('sets meta.fusionStrategy="rrf" when fusionMode="rrf"', async () => {
    const { pool } = scriptedPool([
      ok([{ skill_id: 'a', score: 0.9, match_source: 'agent_summary', match_text: '', trust_score: '0.5' }]),
      ok([]),
      ok([{
        id: 'a', name: 'A', slug: 'a', version: '1.0.0', agent_summary: '', trust_score: '0.5',
        execution_layer: 'x', capabilities_required: [], status: 'published',
        skill_type: 'atomic', verification_tier: 'scanned', trust_badge: null,
        forked_from: null, run_count: 0, last_run_at: null,
        revoked_reason: null, remediation_message: null, remediation_url: null,
        replacement_skill_id: null, publisher_key_id: null,
        signature_verified_at: null, signature_failure_reason: null,
      }]),
    ]);
    const p = new PgVectorProvider({ pool, fusionMode: 'rrf' });
    const result = await p.search('q', embedding(), filters());
    expect(result.meta.fusionStrategy).toBe('rrf');
  });

  it('skips trust boost pass when trustBoostWeight=0', async () => {
    const { pool, log } = scriptedPool([
      ok([{ skill_id: 'a', score: 0.9, match_source: 'agent_summary', match_text: '', trust_score: '0.5' }]),
      ok([]),
      ok([{
        id: 'a', name: 'A', slug: 'a', version: '1.0.0', agent_summary: '', trust_score: '0.5',
        execution_layer: 'x', capabilities_required: [], status: 'published',
        skill_type: 'atomic', verification_tier: 'scanned', trust_badge: null,
        forked_from: null, run_count: 0, last_run_at: null,
        revoked_reason: null, remediation_message: null, remediation_url: null,
        replacement_skill_id: null, publisher_key_id: null,
        signature_verified_at: null, signature_failure_reason: null,
      }]),
    ]);
    const p = new PgVectorProvider({ pool, trustBoostWeight: 0 });
    const r = await p.search('q', embedding(), filters());
    expect(r.results).toHaveLength(1);
    // Exactly 3 SQL calls (vector, FTS, enrich) — no extra pass
    expect(log).toHaveLength(3);
  });

  it('returns [] gracefully when vectorSearch has no hits', async () => {
    const { pool } = scriptedPool([ok([]), ok([])]);
    const p = new PgVectorProvider({ pool });
    const r = await p.search('q', embedding(), filters());
    expect(r.results).toEqual([]);
    expect(r.confidence.tier).toBe(3);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getEmbeddingStamps — read path (null / row / pre-A7 sentinel)
// ══════════════════════════════════════════════════════════════════════════════

describe('PgVectorProvider — getEmbeddingStamps', () => {
  it('returns null when no row exists', async () => {
    const { pool } = scriptedPool([ok([])]);
    const p = new PgVectorProvider({ pool });
    const out = await p.getEmbeddingStamps('sk_1', 'tenant_a');
    expect(out).toBeNull();
  });

  it('returns stamps when row exists', async () => {
    const { pool, log } = scriptedPool([
      ok([{ embed_model: 'qwen3-embedding-0.6B@mrl-512', text_norm_sha256: 'abc123' }]),
    ]);
    const p = new PgVectorProvider({ pool });
    const out = await p.getEmbeddingStamps('sk_1', 'tenant_a');
    expect(out).toEqual({
      embedModel: 'qwen3-embedding-0.6B@mrl-512',
      textNormSha256: 'abc123',
    });
    expect(log[0]!.sql).toContain("source = 'agent_summary'");
    expect(log[0]!.params).toEqual(['sk_1', 'tenant_a']);
  });

  it('returns null textNormSha256 for pre-A7 rows (no fingerprint stamp)', async () => {
    const { pool } = scriptedPool([
      ok([{ embed_model: 'qwen3-embedding-0.6B@mrl-512', text_norm_sha256: null }]),
    ]);
    const p = new PgVectorProvider({ pool });
    const out = await p.getEmbeddingStamps('sk_1', 'tenant_a');
    expect(out).toEqual({
      embedModel: 'qwen3-embedding-0.6B@mrl-512',
      textNormSha256: null,
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// delete + healthCheck
// ══════════════════════════════════════════════════════════════════════════════

describe('PgVectorProvider — delete()', () => {
  it('issues DELETE with skill_id param', async () => {
    const { pool, log } = scriptedPool([ok([])]);
    const p = new PgVectorProvider({ pool });
    await p.delete('sk_1');
    expect(log[0]!.sql).toContain('DELETE FROM skill_embeddings');
    expect(log[0]!.sql).toContain('WHERE skill_id = $1');
    expect(log[0]!.params).toEqual(['sk_1']);
  });
});

describe('PgVectorProvider — healthCheck()', () => {
  it('runs SELECT 1 and reports ok:true', async () => {
    const { pool, log } = scriptedPool([ok([])]);
    const p = new PgVectorProvider({ pool });
    const h = await p.healthCheck();
    expect(h.ok).toBe(true);
    expect(h.latencyMs).toBeGreaterThanOrEqual(0);
    expect(log[0]!.sql).toBe('SELECT 1');
  });

  it('reports ok:false on failure and logs the error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const query = vi.fn().mockRejectedValue(new Error('nope'));
    const pool = { query, connect: vi.fn() } as unknown as SqlPool;
    const p = new PgVectorProvider({ pool });
    const h = await p.healthCheck();
    expect(h.ok).toBe(false);
    expect(errSpy).toHaveBeenCalledWith('Health check failed:', expect.any(Error));
    errSpy.mockRestore();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Widened candidate pool
// ══════════════════════════════════════════════════════════════════════════════

describe('PgVectorProvider — candidate pool sizing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes (limit + offset) × multiplier as the pool cap', async () => {
    const { pool, log } = scriptedPool([
      ok([]), // vector
      ok([]), // fts
    ]);
    const p = new PgVectorProvider({ pool, candidatePoolMultiplier: 4 });
    await p.search('q', embedding(), filters(), { limit: 5, offset: 2 });
    // Both queries should receive limit=(5+2)*4=28 in their third/second param slot
    // vector: params = [tenantId, embeddingStr, poolSize, ...others]
    // fullText: params = [tenantId, poolSize, ...others]
    expect(log[0]!.params?.[2]).toBe(28);
    expect(log[1]!.params?.[1]).toBe(28);
  });
});
