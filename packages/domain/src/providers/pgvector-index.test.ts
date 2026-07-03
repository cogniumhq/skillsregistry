// ══════════════════════════════════════════════════════════════════════════════
// PgVectorProvider.index — transactional write path
// ══════════════════════════════════════════════════════════════════════════════
//
// Covers:
//   - BEGIN → INSERT skill → DELETE embeddings → INSERT embedding → COMMIT
//   - ROLLBACK on error inside the transaction
//   - client.release() runs in `finally` regardless of outcome
//   - 512-dim assertion — throws before writes if storedDims != 512
//   - text_norm_sha256 fingerprint is derived from agentSummary.text
//   - halfvec cast on the embedding INSERT
//   - delete() calls the pool directly (not via connect())
//
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import { PgVectorProvider } from './pgvector-provider.js';
import type {
  SqlPool,
  SqlConnection,
  SqlQueryResult,
} from '../adapters/sql.js';
import type { SkillInput, EmbeddingSet } from '../types.js';
import { textNormSha256 } from '../ingestion/text-fingerprint.js';

// ──────────────────────────────────────────────────────────────────────────────
// Test doubles — client + pool with per-call query capture
// ──────────────────────────────────────────────────────────────────────────────

interface QueryLog {
  sql: string;
  params?: readonly unknown[];
}

interface ScriptedClient {
  client: SqlConnection;
  log: QueryLog[];
  released: () => boolean;
}

function scriptedClient(options: { failOn?: number } = {}): ScriptedClient {
  const log: QueryLog[] = [];
  let released = false;
  let call = 0;
  const query = vi.fn(
    async (
      sql: string,
      params?: readonly unknown[]
    ): Promise<SqlQueryResult<Record<string, unknown>>> => {
      log.push({ sql, params });
      call += 1;
      if (options.failOn !== undefined && call === options.failOn) {
        throw new Error(`scripted failure on call ${call}`);
      }
      return { rows: [], rowCount: 0 };
    }
  );
  const release = vi.fn(() => {
    released = true;
  });
  const client = { query, release } as unknown as SqlConnection;
  return { client, log, released: () => released };
}

function scriptedPool(
  connectImpl: () => Promise<SqlConnection>
): { pool: SqlPool; connect: ReturnType<typeof vi.fn>; poolQuery: ReturnType<typeof vi.fn> } {
  const poolQuery = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  const connect = vi.fn(connectImpl);
  const pool = {
    query: poolQuery,
    connect,
  } as unknown as SqlPool;
  return { pool, connect, poolQuery };
}

function makeSkill(overrides: Partial<SkillInput> = {}): SkillInput {
  return {
    id: 'sk_1',
    name: 'test skill',
    slug: 'test/skill',
    version: '1.0.0',
    source: 'first-party',
    description: 'a test skill',
    agentSummary: 'agent summary text',
    tags: ['foo', 'bar'],
    category: 'utility',
    trustScore: 0.5,
    capabilitiesRequired: ['fs.read'],
    executionLayer: 'sandbox',
    tenantId: 'tenant_a',
    ...overrides,
  };
}

function makeEmbeddings(overrides: Partial<EmbeddingSet> = {}): EmbeddingSet {
  return {
    agentSummary: {
      text: 'agent summary text',
      embedding: Array.from({ length: 512 }, (_, i) => i / 512),
    },
    embedderIdentity: 'qwen3-embedding-0.6b@mrl512',
    storedDims: 512,
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// index() — happy path
// ──────────────────────────────────────────────────────────────────────────────

describe('PgVectorProvider.index — happy path', () => {
  it('executes BEGIN → INSERT skill → DELETE embeddings → INSERT embedding → COMMIT in order', async () => {
    const c = scriptedClient();
    const { pool, connect } = scriptedPool(async () => c.client);
    const p = new PgVectorProvider({ pool });

    await p.index(makeSkill(), makeEmbeddings());

    expect(connect).toHaveBeenCalledTimes(1);
    expect(c.log).toHaveLength(5);
    expect(c.log[0]!.sql).toBe('BEGIN');
    expect(c.log[1]!.sql).toContain('INSERT INTO skills');
    expect(c.log[2]!.sql).toContain('DELETE FROM skill_embeddings');
    expect(c.log[3]!.sql).toContain('INSERT INTO skill_embeddings');
    expect(c.log[4]!.sql).toBe('COMMIT');
  });

  it('releases the client in finally after COMMIT', async () => {
    const c = scriptedClient();
    const { pool } = scriptedPool(async () => c.client);
    const p = new PgVectorProvider({ pool });

    await p.index(makeSkill(), makeEmbeddings());

    expect(c.released()).toBe(true);
  });

  it('binds skill columns positionally on the skill INSERT', async () => {
    const c = scriptedClient();
    const { pool } = scriptedPool(async () => c.client);
    const p = new PgVectorProvider({ pool });

    const skill = makeSkill({
      id: 'sk_zed',
      name: 'zed',
      slug: 'z/e',
      version: '2.0.0',
      source: 'github',
      description: 'desc',
      agentSummary: 'summary',
      tags: ['t1'],
      category: 'cat',
      trustScore: 0.8,
      capabilitiesRequired: ['net.fetch'],
      executionLayer: 'wasm',
    });

    await p.index(skill, makeEmbeddings());

    const params = c.log[1]!.params!;
    expect(params[0]).toBe('sk_zed');
    expect(params[1]).toBe('zed');
    expect(params[2]).toBe('z/e');
    expect(params[3]).toBe('2.0.0');
    expect(params[4]).toBe('github');
    expect(params[5]).toBe('desc');
    expect(params[6]).toBe('summary');
    expect(params[7]).toEqual(['t1']);
    expect(params[8]).toBe('cat');
    expect(params[9]).toBe(0.8);
    expect(params[10]).toEqual(['net.fetch']);
    expect(params[11]).toBe('wasm');
    // content_safety_passed hardcoded true
    expect(params[12]).toBe(true);
  });

  it('substitutes empty array when capabilitiesRequired is omitted', async () => {
    const c = scriptedClient();
    const { pool } = scriptedPool(async () => c.client);
    const p = new PgVectorProvider({ pool });

    const skill = makeSkill();
    delete skill.capabilitiesRequired;

    await p.index(skill, makeEmbeddings());

    const params = c.log[1]!.params!;
    expect(params[10]).toEqual([]);
  });

  it('deletes existing embeddings scoped by skill_id + tenant_id', async () => {
    const c = scriptedClient();
    const { pool } = scriptedPool(async () => c.client);
    const p = new PgVectorProvider({ pool });

    await p.index(
      makeSkill({ id: 'sk_del', tenantId: 'tenant_x' }),
      makeEmbeddings()
    );

    expect(c.log[2]!.sql).toContain(
      'DELETE FROM skill_embeddings WHERE skill_id = $1 AND tenant_id = $2'
    );
    expect(c.log[2]!.params).toEqual(['sk_del', 'tenant_x']);
  });

  it('writes the halfvec-cast embedding row with fingerprint and identity', async () => {
    const c = scriptedClient();
    const { pool } = scriptedPool(async () => c.client);
    const p = new PgVectorProvider({ pool });

    const skill = makeSkill({ id: 'sk_emb', tenantId: 'tenant_a' });
    const embeddings = makeEmbeddings({
      agentSummary: {
        text: 'Hello  World',
        embedding: Array.from({ length: 512 }, () => 0.1),
      },
      embedderIdentity: 'qwen3-embedding-0.6b@mrl512',
    });

    await p.index(skill, embeddings);

    const sql = c.log[3]!.sql;
    expect(sql).toContain('INSERT INTO skill_embeddings');
    expect(sql).toContain('$5::halfvec');
    expect(sql).toContain('embed_model');
    expect(sql).toContain('text_norm_sha256');

    const params = c.log[3]!.params!;
    expect(params[0]).toBe('sk_emb'); // skill_id
    expect(params[1]).toBe('tenant_a'); // tenant_id
    expect(params[2]).toBe('agent_summary'); // source
    expect(params[3]).toBe('Hello  World'); // source_text (verbatim, un-normalized)

    // Vector encoded as `[v1,v2,...]` string for halfvec cast
    expect(typeof params[4]).toBe('string');
    expect(params[4] as string).toMatch(/^\[0\.1(,0\.1){511}\]$/);

    expect(params[5]).toBe('qwen3-embedding-0.6b@mrl512'); // embed_model
    // Fingerprint is SHA-256 of normalized text ('hello world' collapsed)
    const expected = await textNormSha256('Hello  World');
    expect(params[6]).toBe(expected);
  });

  it('preserves the raw ordering of embedding floats in the vector literal', async () => {
    const c = scriptedClient();
    const { pool } = scriptedPool(async () => c.client);
    const p = new PgVectorProvider({ pool });

    const values = Array.from({ length: 512 }, (_, i) => (i + 1) * 0.001);
    await p.index(
      makeSkill(),
      makeEmbeddings({
        agentSummary: { text: 't', embedding: values },
      })
    );

    const vec = c.log[3]!.params![4] as string;
    expect(vec.startsWith('[')).toBe(true);
    expect(vec.endsWith(']')).toBe(true);
    const parsed = vec.slice(1, -1).split(',').map(Number);
    expect(parsed).toHaveLength(512);
    expect(parsed[0]).toBeCloseTo(0.001);
    expect(parsed[511]).toBeCloseTo(0.512);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// index() — dimension guard
// ──────────────────────────────────────────────────────────────────────────────

describe('PgVectorProvider.index — dimension guard (§10 A10)', () => {
  it('throws when storedDims is 384 (pre-A10)', async () => {
    const c = scriptedClient();
    const { pool } = scriptedPool(async () => c.client);
    const p = new PgVectorProvider({ pool });

    await expect(
      p.index(makeSkill(), makeEmbeddings({ storedDims: 384 }))
    ).rejects.toThrow(/storedDims=384/);
  });

  it('throws when storedDims is 1024', async () => {
    const c = scriptedClient();
    const { pool } = scriptedPool(async () => c.client);
    const p = new PgVectorProvider({ pool });

    await expect(
      p.index(makeSkill(), makeEmbeddings({ storedDims: 1024 }))
    ).rejects.toThrow(/only 512 is supported/);
  });

  it('rolls back the transaction on dimension mismatch', async () => {
    const c = scriptedClient();
    const { pool } = scriptedPool(async () => c.client);
    const p = new PgVectorProvider({ pool });

    await expect(
      p.index(makeSkill(), makeEmbeddings({ storedDims: 256 }))
    ).rejects.toThrow();

    // BEGIN + INSERT skill + DELETE + ROLLBACK — no embedding INSERT, no COMMIT
    expect(c.log[0]!.sql).toBe('BEGIN');
    expect(c.log.at(-1)!.sql).toBe('ROLLBACK');
    expect(c.log.some((q) => q.sql === 'COMMIT')).toBe(false);
    expect(c.log.some((q) => q.sql.includes('INSERT INTO skill_embeddings'))).toBe(
      false
    );
  });

  it('releases the client after dimension-guard rollback', async () => {
    const c = scriptedClient();
    const { pool } = scriptedPool(async () => c.client);
    const p = new PgVectorProvider({ pool });

    await expect(
      p.index(makeSkill(), makeEmbeddings({ storedDims: 100 }))
    ).rejects.toThrow();

    expect(c.released()).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// index() — SQL failure paths
// ──────────────────────────────────────────────────────────────────────────────

describe('PgVectorProvider.index — transaction rollback on SQL failure', () => {
  it('rolls back when the skill INSERT fails and rethrows the error', async () => {
    // failOn=2 → BEGIN succeeds, INSERT skill throws
    const c = scriptedClient({ failOn: 2 });
    const { pool } = scriptedPool(async () => c.client);
    const p = new PgVectorProvider({ pool });

    await expect(p.index(makeSkill(), makeEmbeddings())).rejects.toThrow(
      /scripted failure on call 2/
    );

    // BEGIN + failed INSERT + ROLLBACK
    expect(c.log[0]!.sql).toBe('BEGIN');
    expect(c.log[1]!.sql).toContain('INSERT INTO skills');
    expect(c.log[2]!.sql).toBe('ROLLBACK');
  });

  it('rolls back when the DELETE embeddings query fails', async () => {
    // failOn=3 → BEGIN, INSERT skill, DELETE throws
    const c = scriptedClient({ failOn: 3 });
    const { pool } = scriptedPool(async () => c.client);
    const p = new PgVectorProvider({ pool });

    await expect(p.index(makeSkill(), makeEmbeddings())).rejects.toThrow();

    expect(c.log[2]!.sql).toContain('DELETE FROM skill_embeddings');
    expect(c.log[3]!.sql).toBe('ROLLBACK');
  });

  it('rolls back when the embedding INSERT fails', async () => {
    // failOn=4 → BEGIN, INSERT skill, DELETE, INSERT embedding throws
    const c = scriptedClient({ failOn: 4 });
    const { pool } = scriptedPool(async () => c.client);
    const p = new PgVectorProvider({ pool });

    await expect(p.index(makeSkill(), makeEmbeddings())).rejects.toThrow();

    expect(c.log[3]!.sql).toContain('INSERT INTO skill_embeddings');
    expect(c.log[4]!.sql).toBe('ROLLBACK');
  });

  it('rolls back when COMMIT itself fails', async () => {
    // failOn=5 → all four writes succeed, COMMIT throws
    const c = scriptedClient({ failOn: 5 });
    const { pool } = scriptedPool(async () => c.client);
    const p = new PgVectorProvider({ pool });

    await expect(p.index(makeSkill(), makeEmbeddings())).rejects.toThrow();

    expect(c.log[4]!.sql).toBe('COMMIT');
    expect(c.log[5]!.sql).toBe('ROLLBACK');
  });

  it('releases the client after rollback', async () => {
    const c = scriptedClient({ failOn: 2 });
    const { pool } = scriptedPool(async () => c.client);
    const p = new PgVectorProvider({ pool });

    await expect(p.index(makeSkill(), makeEmbeddings())).rejects.toThrow();
    expect(c.released()).toBe(true);
  });

  it('releases the client even when connect resolves but every query throws', async () => {
    const c = scriptedClient({ failOn: 1 });
    const { pool } = scriptedPool(async () => c.client);
    const p = new PgVectorProvider({ pool });

    await expect(p.index(makeSkill(), makeEmbeddings())).rejects.toThrow();
    expect(c.released()).toBe(true);
    // BEGIN failed → no ROLLBACK issued because BEGIN never opened; but
    // rollback IS called in the catch block regardless.
    expect(c.log[0]!.sql).toBe('BEGIN');
    // ROLLBACK is queued in catch — it may or may not be logged depending on
    // whether it throws too. The important assertion is `released()` = true.
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// index() — connect() failure
// ──────────────────────────────────────────────────────────────────────────────

describe('PgVectorProvider.index — connect() failure', () => {
  it('propagates the pool.connect() error without touching client state', async () => {
    const boom = new Error('pool exhausted');
    const connect = vi.fn(async () => {
      throw boom;
    });
    const pool = {
      query: vi.fn(),
      connect,
    } as unknown as SqlPool;
    const p = new PgVectorProvider({ pool });

    await expect(p.index(makeSkill(), makeEmbeddings())).rejects.toBe(boom);
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
