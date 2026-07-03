// ══════════════════════════════════════════════════════════════════════════════
// extendComposition — fork a composition + append new steps
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import { extendComposition } from './extend.js';
import { NotFoundError, ValidationError } from './errors.js';
import type { SqlPool } from '../adapters/sql.js';
import type { QueueAdapter } from '../adapters/queue.js';
import type {
  CompositionAdapters,
  EmbedQueueMessage,
  CogniumScanQueueMessage,
} from './adapters.js';
import type { ExtendInput } from './schema.js';

// ──────────────────────────────────────────────────────────────────────────────
// Doubles
// ──────────────────────────────────────────────────────────────────────────────

interface Call {
  sql: string;
  params?: unknown[];
}

function scriptedPool(script: Array<{ rows: unknown[]; rowCount?: number }>) {
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
    sendBatch: vi.fn(),
  };
  return { q, sends };
}

function makeAdapters(pool: SqlPool) {
  const embed = stubQueue<EmbedQueueMessage>();
  const scan = stubQueue<CogniumScanQueueMessage>();
  return {
    adapters: { pool, embedQueue: embed.q, scanQueue: scan.q } as CompositionAdapters,
  };
}

// Full source row shape needed by forkSkill inside extend
const COMPOSITION_SOURCE = {
  id: 'src_id',
  skill_type: 'auto-composite',
  slug: 'pipeline-a',
  version: '1.0.0',
  name: 'Pipeline A',
  description: 'a pipeline',
  readme: null,
  schema_json: null,
  execution_layer: 'composite',
  tags: ['x'],
  categories: ['c'],
  ecosystem: null,
  license: 'MIT',
  capabilities_required: ['fs:read'],
  source: 'manual',
  root_source: 'manual',
  composition_skill_ids: ['step_a', 'step_b'],
};

const FORK_ROW = {
  id: 'fork_id',
  slug: 'pipeline-a-fork-abc123',
  version: '1.0.0',
  status: 'draft',
};

const publishedNewSteps = [{ id: 'new_step_a' }, { id: 'new_step_b' }];

function baseInput(steps?: ExtendInput['steps']): ExtendInput['steps'] {
  return steps ?? [{ skillId: 'new_step_a' }, { skillId: 'new_step_b' }];
}

// ──────────────────────────────────────────────────────────────────────────────
// Happy path
// ──────────────────────────────────────────────────────────────────────────────

describe('extendComposition — happy path', () => {
  it('appends new steps at MAX(step_order)+1 and recomputes trust=MIN(step trusts)', async () => {
    const { pool, calls } = scriptedPool([
      // 1) Verify source is composition
      { rows: [{ skill_type: 'auto-composite' }] },
      // 2) Validate new step IDs published
      { rows: publishedNewSteps },
      // ── forkSkill invocation ──
      // 3) SELECT * FROM skills WHERE id (fork's source lookup)
      { rows: [COMPOSITION_SOURCE] },
      // 4) INSERT skill (fork row)
      { rows: [FORK_ROW] },
      // 5) INSERT composition_steps SELECT ... (steps copy since source is composition)
      { rows: [] },
      // 6) UPDATE composition_skill_ids (source has them)
      { rows: [] },
      // 7) UPDATE human_fork_count
      { rows: [] },
      // ── back to extend ──
      // 8) MAX(step_order)
      { rows: [{ max_order: 2 }] },
      // 9) INSERT new_step_a
      { rows: [] },
      // 10) INSERT new_step_b
      { rows: [] },
      // 11) SELECT trust_score, capabilities_required
      {
        rows: [
          { trust_score: '0.90', capabilities_required: ['fs:read'] },
          { trust_score: '0.60', capabilities_required: ['net:http'] },
          { trust_score: '0.75', capabilities_required: null },
          { trust_score: '0.85', capabilities_required: ['fs:read'] },
        ],
      },
      // 12) UPDATE skills SET trust_score, capabilities
      { rows: [] },
    ]);
    const { adapters } = makeAdapters(pool);
    const out = await extendComposition('src_id', baseInput(), 'a', 'human', adapters);

    expect(out.id).toBe('fork_id');
    expect(out.slug).toBe('pipeline-a-fork-abc123');

    // MAX(step_order) call
    const maxCall = calls[7]!;
    expect(maxCall.sql).toContain('COALESCE(MAX(step_order), 0)');
    expect(maxCall.params).toEqual(['fork_id']);

    // Step inserts — step_order 3 then 4
    expect(calls[8]!.params).toEqual([
      'fork_id',
      3,
      'new_step_a',
      null,
      null,
      'fail',
    ]);
    expect(calls[9]!.params).toEqual([
      'fork_id',
      4,
      'new_step_b',
      null,
      null,
      'fail',
    ]);

    // Trust recompute: MIN(0.9, 0.6, 0.75, 0.85) = 0.6 (NO ×0.9 penalty)
    const updateCall = calls[11]!;
    expect(updateCall.sql).toContain('UPDATE skills SET trust_score');
    expect(updateCall.params![0]).toBe(0.6);
    // Capabilities union
    const caps = updateCall.params![1] as string[];
    expect(new Set(caps)).toEqual(new Set(['fs:read', 'net:http']));
    expect(updateCall.params![2]).toBe('fork_id');
  });

  it('starts numbering at 1 when composition has no steps yet (MAX returns 0)', async () => {
    // Setup: source composition has no existing steps
    const { pool, calls } = scriptedPool([
      { rows: [{ skill_type: 'composition' }] },
      { rows: [{ id: 'new_step_a' }] },
      { rows: [COMPOSITION_SOURCE] },
      { rows: [FORK_ROW] },
      { rows: [] }, // step copy (composition source)
      { rows: [] }, // composition_skill_ids UPDATE
      { rows: [] }, // fork_count bump
      { rows: [{ max_order: 0 }] },
      { rows: [] }, // step INSERT
      { rows: [{ trust_score: '0.5', capabilities_required: null }] },
      { rows: [] },
    ]);
    const { adapters } = makeAdapters(pool);
    await extendComposition(
      'src_id',
      [{ skillId: 'new_step_a' }],
      'a',
      'human',
      adapters,
    );
    // First appended step should be step_order = 1
    expect(calls[8]!.params![1]).toBe(1);
  });

  it('honors stepName, inputMapping, and onError overrides', async () => {
    const { pool, calls } = scriptedPool([
      { rows: [{ skill_type: 'auto-composite' }] },
      { rows: [{ id: 'new_step_a' }] },
      { rows: [COMPOSITION_SOURCE] },
      { rows: [FORK_ROW] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ max_order: 5 }] },
      { rows: [] },
      { rows: [{ trust_score: '0.5', capabilities_required: null }] },
      { rows: [] },
    ]);
    const { adapters } = makeAdapters(pool);
    await extendComposition(
      'src_id',
      [
        {
          skillId: 'new_step_a',
          stepName: 'MyStep',
          inputMapping: { a: 'b' },
          onError: 'skip',
        },
      ],
      'a',
      'human',
      adapters,
    );
    expect(calls[8]!.params).toEqual([
      'fork_id',
      6, // MAX 5 + 1
      'new_step_a',
      'MyStep',
      JSON.stringify({ a: 'b' }),
      'skip',
    ]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────────────────────────────────────

describe('extendComposition — errors', () => {
  it('throws NotFoundError when source not found or not published', async () => {
    const { pool } = scriptedPool([{ rows: [] }]);
    const { adapters } = makeAdapters(pool);
    await expect(
      extendComposition('bad_id', baseInput(), 'a', 'human', adapters),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ValidationError when source is not a composition type', async () => {
    const { pool } = scriptedPool([{ rows: [{ skill_type: 'atomic' }] }]);
    const { adapters } = makeAdapters(pool);
    let caught: unknown;
    try {
      await extendComposition('src_id', baseInput(), 'a', 'human', adapters);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as Error).message).toMatch(/not a composition/);
  });

  it('throws ValidationError listing missing new step skill IDs', async () => {
    const { pool } = scriptedPool([
      { rows: [{ skill_type: 'auto-composite' }] },
      { rows: [{ id: 'new_step_a' }] }, // missing new_step_b
    ]);
    const { adapters } = makeAdapters(pool);
    let caught: unknown;
    try {
      await extendComposition('src_id', baseInput(), 'a', 'human', adapters);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as Error).message).toMatch(/new_step_b/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SQL guards
// ──────────────────────────────────────────────────────────────────────────────

describe('extendComposition — SQL guards', () => {
  it('validates source is published via WHERE id = $1 AND status = published', async () => {
    const { pool, calls } = scriptedPool([{ rows: [] }]);
    const { adapters } = makeAdapters(pool);
    await expect(
      extendComposition('src_id', baseInput(), 'a', 'human', adapters),
    ).rejects.toThrow(NotFoundError);
    expect(calls[0]!.sql).toContain("status = 'published'");
    expect(calls[0]!.params).toEqual(['src_id']);
  });

  it('validates new step ids via id=ANY(uuid[]) AND status=published', async () => {
    const { pool, calls } = scriptedPool([
      { rows: [{ skill_type: 'auto-composite' }] },
      { rows: [] }, // no matches
    ]);
    const { adapters } = makeAdapters(pool);
    await expect(
      extendComposition('src_id', baseInput(), 'a', 'human', adapters),
    ).rejects.toThrow(ValidationError);
    expect(calls[1]!.sql).toContain('id = ANY($1::uuid[])');
    expect(calls[1]!.sql).toContain("status = 'published'");
  });
});
