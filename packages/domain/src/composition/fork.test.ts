// ══════════════════════════════════════════════════════════════════════════════
// forkSkill — fork a published skill with lineage + trust reset
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { forkSkill } from './fork.js';
import { NotFoundError } from './errors.js';
import { BASE_TRUST } from '../scoring/policy.js';
import type { SqlPool } from '../adapters/sql.js';
import type { QueueAdapter } from '../adapters/queue.js';
import type {
  CompositionAdapters,
  EmbedQueueMessage,
  CogniumScanQueueMessage,
} from './adapters.js';

// ──────────────────────────────────────────────────────────────────────────────
// Doubles
// ──────────────────────────────────────────────────────────────────────────────

interface Call {
  sql: string;
  params?: unknown[];
}

function scriptedPool(script: Array<{ rows: unknown[]; rowCount?: number }>): {
  pool: SqlPool;
  calls: Call[];
} {
  const calls: Call[] = [];
  let idx = 0;
  const pool = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      const next = script[idx++];
      if (!next) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: next.rows, rowCount: next.rowCount ?? next.rows.length };
    }),
    connect: vi.fn(),
  } as unknown as SqlPool;
  return { pool, calls };
}

function stubQueue<T>(): {
  q: QueueAdapter<T>;
  sends: T[];
} {
  const sends: T[] = [];
  const q: QueueAdapter<T> = {
    send: vi.fn(async (m: T) => {
      sends.push(m);
    }),
    sendBatch: vi.fn(async (msgs: T[]) => {
      sends.push(...msgs);
    }),
  };
  return { q, sends };
}

function throwingQueue<T>(): QueueAdapter<T> {
  return {
    send: vi.fn(async () => {
      throw new Error('queue down');
    }),
    sendBatch: vi.fn(async () => {
      throw new Error('queue down');
    }),
  };
}

function makeAdapters(pool: SqlPool): {
  adapters: CompositionAdapters;
  embedSends: EmbedQueueMessage[];
  scanSends: CogniumScanQueueMessage[];
} {
  const embed = stubQueue<EmbedQueueMessage>();
  const scan = stubQueue<CogniumScanQueueMessage>();
  return {
    adapters: {
      pool,
      embedQueue: embed.q,
      scanQueue: scan.q,
    },
    embedSends: embed.sends,
    scanSends: scan.sends,
  };
}

const SOURCE_ATOMIC = {
  id: 'src_id',
  slug: 'rust-lint',
  version: '2.3.0',
  name: 'rust-lint',
  description: 'lint rust',
  readme: '# rust-lint',
  schema_json: { foo: 'bar' },
  execution_layer: 'wasm',
  tags: ['rust', 'lint'],
  categories: ['dev-tools'],
  ecosystem: 'rust',
  license: 'MIT',
  capabilities_required: ['fs:read'],
  skill_type: 'atomic',
  source: 'mcp-registry',
  root_source: 'mcp-registry',
  composition_skill_ids: null,
};

const FORK_ROW = {
  id: 'fork_id',
  slug: 'rust-lint-fork-abc123',
  version: '1.0.0',
  status: 'draft',
};

// ──────────────────────────────────────────────────────────────────────────────
// Happy path
// ──────────────────────────────────────────────────────────────────────────────

describe('forkSkill — atomic source, human author', () => {
  it('inherits trust from BASE_TRUST[root_source]', async () => {
    const { pool } = scriptedPool([
      { rows: [SOURCE_ATOMIC] }, // SELECT source
      { rows: [FORK_ROW] }, // INSERT fork
      { rows: [] }, // UPDATE human_fork_count
    ]);
    const { adapters, embedSends, scanSends } = makeAdapters(pool);

    const out = await forkSkill('src_id', 'author_id', 'human', adapters);

    expect(out.id).toBe('fork_id');
    expect(out.slug).toBe('rust-lint-fork-abc123');
    expect(out.version).toBe('1.0.0');
    expect(out.status).toBe('draft');
    expect(out.forkedFrom).toBe('rust-lint@2.3.0');
    expect(out.trustScore).toBe(BASE_TRUST['mcp-registry']); // 0.80

    // Best-effort queue sends fired
    expect(embedSends).toEqual([{ skillId: 'fork_id', action: 'embed' }]);
    expect(scanSends).toHaveLength(1);
    expect(scanSends[0]!.skillId).toBe('fork_id');
    expect(scanSends[0]!.priority).toBe('normal');
    expect(typeof scanSends[0]!.timestamp).toBe('number');
  });

  it('falls back to trust=0.40 when root_source is unknown', async () => {
    const src = { ...SOURCE_ATOMIC, root_source: 'unknown-src' };
    const { pool } = scriptedPool([
      { rows: [src] },
      { rows: [FORK_ROW] },
      { rows: [] },
    ]);
    const { adapters } = makeAdapters(pool);
    const out = await forkSkill('src_id', 'author_id', 'human', adapters);
    expect(out.trustScore).toBe(0.40);
  });

  it('falls back to source column when root_source is null', async () => {
    const src = { ...SOURCE_ATOMIC, root_source: null, source: 'smithery' };
    const { pool } = scriptedPool([
      { rows: [src] },
      { rows: [FORK_ROW] },
      { rows: [] },
    ]);
    const { adapters } = makeAdapters(pool);
    const out = await forkSkill('src_id', 'author_id', 'human', adapters);
    expect(out.trustScore).toBe(BASE_TRUST['smithery']); // 0.65
  });

  it("uses '1.0.0' when source version is null (forkedFrom fallback)", async () => {
    const src = { ...SOURCE_ATOMIC, version: null };
    const { pool } = scriptedPool([
      { rows: [src] },
      { rows: [FORK_ROW] },
      { rows: [] },
    ]);
    const { adapters } = makeAdapters(pool);
    const out = await forkSkill('src_id', 'a', 'human', adapters);
    expect(out.forkedFrom).toBe('rust-lint@1.0.0');
  });

  it('bumps human_fork_count when authorType is human', async () => {
    const { pool, calls } = scriptedPool([
      { rows: [SOURCE_ATOMIC] },
      { rows: [FORK_ROW] },
      { rows: [] },
    ]);
    const { adapters } = makeAdapters(pool);
    await forkSkill('src_id', 'a', 'human', adapters);

    const updateCall = calls[calls.length - 1]!;
    expect(updateCall.sql).toContain('human_fork_count = human_fork_count + 1');
    expect(updateCall.params).toEqual(['src_id']);
  });
});

describe('forkSkill — atomic source, bot author', () => {
  it('bumps agent_fork_count when authorType is bot', async () => {
    const { pool, calls } = scriptedPool([
      { rows: [SOURCE_ATOMIC] },
      { rows: [FORK_ROW] },
      { rows: [] },
    ]);
    const { adapters } = makeAdapters(pool);
    await forkSkill('src_id', 'bot_id', 'bot', adapters);

    const updateCall = calls[calls.length - 1]!;
    expect(updateCall.sql).toContain('agent_fork_count = agent_fork_count + 1');
    expect(updateCall.params).toEqual(['src_id']);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Composition source
// ──────────────────────────────────────────────────────────────────────────────

describe('forkSkill — composition source', () => {
  it('copies composition_steps for auto-composite skill_type', async () => {
    const src = { ...SOURCE_ATOMIC, skill_type: 'auto-composite' };
    const { pool, calls } = scriptedPool([
      { rows: [src] }, // SELECT source
      { rows: [FORK_ROW] }, // INSERT fork
      { rows: [] }, // INSERT composition_steps
      { rows: [] }, // UPDATE human_fork_count
    ]);
    const { adapters } = makeAdapters(pool);
    await forkSkill('src_id', 'a', 'human', adapters);

    // Third call should be the composition_steps copy
    expect(calls[2]!.sql).toContain('INSERT INTO composition_steps');
    expect(calls[2]!.sql).toContain('SELECT $1, step_order');
    expect(calls[2]!.params).toEqual(['fork_id', 'src_id']);
  });

  it('copies composition_skill_ids when present on composition source', async () => {
    const src = {
      ...SOURCE_ATOMIC,
      skill_type: 'pipeline',
      composition_skill_ids: ['a', 'b', 'c'],
    };
    const { pool, calls } = scriptedPool([
      { rows: [src] },
      { rows: [FORK_ROW] },
      { rows: [] }, // INSERT composition_steps
      { rows: [] }, // UPDATE composition_skill_ids
      { rows: [] }, // UPDATE human_fork_count
    ]);
    const { adapters } = makeAdapters(pool);
    await forkSkill('src_id', 'a', 'human', adapters);

    expect(calls[3]!.sql).toContain(
      'UPDATE skills SET composition_skill_ids',
    );
    expect(calls[3]!.params).toEqual([['a', 'b', 'c'], 'fork_id']);
  });

  it('skips composition_skill_ids update when source has none', async () => {
    const src = {
      ...SOURCE_ATOMIC,
      skill_type: 'composition',
      composition_skill_ids: null,
    };
    const { pool, calls } = scriptedPool([
      { rows: [src] },
      { rows: [FORK_ROW] },
      { rows: [] }, // steps copy
      { rows: [] }, // fork_count bump (no composition_skill_ids update between)
    ]);
    const { adapters } = makeAdapters(pool);
    await forkSkill('src_id', 'a', 'human', adapters);
    // Only 4 queries — no composition_skill_ids UPDATE
    expect(calls).toHaveLength(4);
  });

  it('does NOT copy composition_steps for atomic source', async () => {
    const { pool, calls } = scriptedPool([
      { rows: [SOURCE_ATOMIC] },
      { rows: [FORK_ROW] },
      { rows: [] },
    ]);
    const { adapters } = makeAdapters(pool);
    await forkSkill('src_id', 'a', 'human', adapters);
    expect(calls).toHaveLength(3); // SELECT + INSERT + UPDATE — no step copy
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// INSERT shape
// ──────────────────────────────────────────────────────────────────────────────

describe('forkSkill — INSERT skill shape', () => {
  it('appends "(fork)" to name, sets skill_type=forked and status=draft', async () => {
    const { pool, calls } = scriptedPool([
      { rows: [SOURCE_ATOMIC] },
      { rows: [FORK_ROW] },
      { rows: [] },
    ]);
    const { adapters } = makeAdapters(pool);
    await forkSkill('src_id', 'author_x', 'human', adapters);

    const insertCall = calls[1]!;
    expect(insertCall.sql).toContain("'forked', 'draft'");
    expect(insertCall.sql).toContain("'direct', 'unverified'");
    // Params: name is [0], slug is [1]
    expect(insertCall.params![0]).toBe('rust-lint (fork)');
    // authorId is at position 10 (0-indexed), authorType at 11
    expect(insertCall.params![10]).toBe('author_x');
    expect(insertCall.params![11]).toBe('human');
    // forked_from at 12
    expect(insertCall.params![12]).toBe('rust-lint@2.3.0');
    // forked_by at 13 = authorId
    expect(insertCall.params![13]).toBe('author_x');
    // trust_score at 15
    expect(insertCall.params![15]).toBe(BASE_TRUST['mcp-registry']);
  });

  it('stringifies schema_json when present, passes null otherwise', async () => {
    const src = { ...SOURCE_ATOMIC, schema_json: { a: 1 } };
    const { pool, calls } = scriptedPool([
      { rows: [src] },
      { rows: [FORK_ROW] },
      { rows: [] },
    ]);
    const { adapters } = makeAdapters(pool);
    await forkSkill('src_id', 'a', 'human', adapters);
    // schema_json param is at index 4 (name,slug,description,readme,schema_json)
    expect(calls[1]!.params![4]).toBe(JSON.stringify({ a: 1 }));
  });

  it('passes null schema_json when source has none', async () => {
    const src = { ...SOURCE_ATOMIC, schema_json: null };
    const { pool, calls } = scriptedPool([
      { rows: [src] },
      { rows: [FORK_ROW] },
      { rows: [] },
    ]);
    const { adapters } = makeAdapters(pool);
    await forkSkill('src_id', 'a', 'human', adapters);
    expect(calls[1]!.params![4]).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Errors + resilience
// ──────────────────────────────────────────────────────────────────────────────

describe('forkSkill — errors & resilience', () => {
  it('throws NotFoundError when source not found or not published', async () => {
    const { pool } = scriptedPool([{ rows: [] }]);
    const { adapters } = makeAdapters(pool);
    await expect(
      forkSkill('src_id', 'a', 'human', adapters),
    ).rejects.toThrow(NotFoundError);
    await expect(
      forkSkill('src_id', 'a', 'human', adapters),
    ).rejects.toThrow(/not found or not published/);
  });

  it('swallows queue send failure and still returns the fork', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { pool } = scriptedPool([
      { rows: [SOURCE_ATOMIC] },
      { rows: [FORK_ROW] },
      { rows: [] },
    ]);
    const adapters: CompositionAdapters = {
      pool,
      embedQueue: throwingQueue<EmbedQueueMessage>(),
      scanQueue: throwingQueue<CogniumScanQueueMessage>(),
    };
    const out = await forkSkill('src_id', 'a', 'human', adapters);
    expect(out.id).toBe('fork_id');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
