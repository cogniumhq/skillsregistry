// ══════════════════════════════════════════════════════════════════════════════
// copySkill — clone a published skill with fresh identity, no lineage
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import { copySkill } from './copy.js';
import { NotFoundError } from './errors.js';
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
      return {
        rows: next?.rows ?? [],
        rowCount: next?.rowCount ?? next?.rows.length ?? 0,
      };
    }),
    connect: vi.fn(),
  } as unknown as SqlPool;
  return { pool, calls };
}

function stubQueue<T>() {
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

function makeAdapters(pool: SqlPool) {
  const embed = stubQueue<EmbedQueueMessage>();
  const scan = stubQueue<CogniumScanQueueMessage>();
  return {
    adapters: { pool, embedQueue: embed.q, scanQueue: scan.q } as CompositionAdapters,
    embedSends: embed.sends,
    scanSends: scan.sends,
  };
}

const SOURCE = {
  id: 'src_id',
  slug: 'awesome-skill',
  version: '1.2.3',
  name: 'Awesome Skill',
  description: 'does things',
  readme: '# awesome',
  schema_json: null,
  execution_layer: 'wasm',
  tags: ['a', 'b'],
  categories: ['c'],
  ecosystem: 'js',
  license: 'MIT',
  capabilities_required: ['fs:read'],
  skill_type: 'atomic',
};

const COPY_ROW = {
  id: 'copy_id',
  slug: 'awesome-skill-copy-xyz789',
  version: '1.0.0',
  status: 'draft',
};

// ──────────────────────────────────────────────────────────────────────────────
// Happy path
// ──────────────────────────────────────────────────────────────────────────────

describe('copySkill — trust + lineage semantics', () => {
  it('returns trustScore=0.5 and forkedFrom="" (no lineage)', async () => {
    const { pool } = scriptedPool([
      { rows: [SOURCE] },
      { rows: [COPY_ROW] },
      { rows: [] }, // human_copy_count bump
    ]);
    const { adapters } = makeAdapters(pool);
    const out = await copySkill('src_id', 'a', 'human', adapters);
    expect(out.trustScore).toBe(0.5);
    expect(out.forkedFrom).toBe('');
    expect(out.id).toBe('copy_id');
    expect(out.slug).toBe('awesome-skill-copy-xyz789');
    expect(out.status).toBe('draft');
  });

  it('sets skill_type=atomic and trust=0.5 in INSERT', async () => {
    const { pool, calls } = scriptedPool([
      { rows: [SOURCE] },
      { rows: [COPY_ROW] },
      { rows: [] },
    ]);
    const { adapters } = makeAdapters(pool);
    await copySkill('src_id', 'a', 'human', adapters);
    const insert = calls[1]!;
    expect(insert.sql).toContain("'atomic', 'draft'");
    expect(insert.sql).toContain('0.5, $13');
  });

  it('appends "(copy)" to name', async () => {
    const { pool, calls } = scriptedPool([
      { rows: [SOURCE] },
      { rows: [COPY_ROW] },
      { rows: [] },
    ]);
    const { adapters } = makeAdapters(pool);
    await copySkill('src_id', 'a', 'human', adapters);
    expect(calls[1]!.params![0]).toBe('Awesome Skill (copy)');
  });

  it('stringifies schema_json when present', async () => {
    const src = { ...SOURCE, schema_json: { x: 1 } };
    const { pool, calls } = scriptedPool([
      { rows: [src] },
      { rows: [COPY_ROW] },
      { rows: [] },
    ]);
    const { adapters } = makeAdapters(pool);
    await copySkill('src_id', 'a', 'human', adapters);
    expect(calls[1]!.params![4]).toBe(JSON.stringify({ x: 1 }));
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Copy-count bumps
// ──────────────────────────────────────────────────────────────────────────────

describe('copySkill — copy-count bumps', () => {
  it('bumps human_copy_count when human copies', async () => {
    const { pool, calls } = scriptedPool([
      { rows: [SOURCE] },
      { rows: [COPY_ROW] },
      { rows: [] },
    ]);
    const { adapters } = makeAdapters(pool);
    await copySkill('src_id', 'a', 'human', adapters);
    const bump = calls[calls.length - 1]!;
    expect(bump.sql).toContain('human_copy_count = human_copy_count + 1');
    expect(bump.params).toEqual(['src_id']);
  });

  it('does NOT bump any counter when bot copies (silent)', async () => {
    const { pool, calls } = scriptedPool([
      { rows: [SOURCE] },
      { rows: [COPY_ROW] },
    ]);
    const { adapters } = makeAdapters(pool);
    await copySkill('src_id', 'bot', 'bot', adapters);
    // 2 queries: SELECT + INSERT — no bump.
    expect(calls).toHaveLength(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Composition source
// ──────────────────────────────────────────────────────────────────────────────

describe('copySkill — composition source', () => {
  it('copies composition_steps for composition source', async () => {
    const src = { ...SOURCE, skill_type: 'human-composite' };
    const { pool, calls } = scriptedPool([
      { rows: [src] },
      { rows: [COPY_ROW] },
      { rows: [] }, // steps copy
      { rows: [] }, // human_copy bump
    ]);
    const { adapters } = makeAdapters(pool);
    await copySkill('src_id', 'a', 'human', adapters);
    expect(calls[2]!.sql).toContain('INSERT INTO composition_steps');
    expect(calls[2]!.params).toEqual(['copy_id', 'src_id']);
  });

  it('skips composition_steps copy for atomic source', async () => {
    const { pool, calls } = scriptedPool([
      { rows: [SOURCE] },
      { rows: [COPY_ROW] },
      { rows: [] },
    ]);
    const { adapters } = makeAdapters(pool);
    await copySkill('src_id', 'a', 'human', adapters);
    expect(calls).toHaveLength(3);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Errors + resilience
// ──────────────────────────────────────────────────────────────────────────────

describe('copySkill — errors & resilience', () => {
  it('throws NotFoundError when source not found or not published', async () => {
    const { pool } = scriptedPool([{ rows: [] }]);
    const { adapters } = makeAdapters(pool);
    await expect(copySkill('src_id', 'a', 'human', adapters)).rejects.toThrow(
      NotFoundError,
    );
  });

  it('swallows queue failure and still returns the copy', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { pool } = scriptedPool([
      { rows: [SOURCE] },
      { rows: [COPY_ROW] },
      { rows: [] },
    ]);
    const throwing: QueueAdapter<unknown> = {
      send: vi.fn(async () => {
        throw new Error('q down');
      }),
      sendBatch: vi.fn(),
    };
    const adapters: CompositionAdapters = {
      pool,
      embedQueue: throwing as QueueAdapter<EmbedQueueMessage>,
      scanQueue: throwing as QueueAdapter<CogniumScanQueueMessage>,
    };
    const out = await copySkill('src_id', 'a', 'human', adapters);
    expect(out.id).toBe('copy_id');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
