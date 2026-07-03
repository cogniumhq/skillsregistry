// ══════════════════════════════════════════════════════════════════════════════
// createComposition — build an auto-composite from an ordered step list
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import { createComposition } from './compose.js';
import { ValidationError } from './errors.js';
import type { SqlPool } from '../adapters/sql.js';
import type { QueueAdapter } from '../adapters/queue.js';
import type {
  CompositionAdapters,
  EmbedQueueMessage,
  CogniumScanQueueMessage,
} from './adapters.js';
import type { CompositionInput } from '../types.js';

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
    embedSends: embed.sends,
    scanSends: scan.sends,
  };
}

function baseInput(overrides: Partial<CompositionInput> = {}): CompositionInput {
  return {
    name: 'My Pipeline',
    description: 'multi-step pipeline',
    authorId: 'author_1',
    authorType: 'human',
    steps: [
      { skillId: 'skill_a', stepName: 'A' },
      { skillId: 'skill_b', stepName: 'B' },
    ],
    ...overrides,
  };
}

const publishedRows = [
  { id: 'skill_a', trust_score: '0.80', capabilities_required: ['fs:read'] },
  { id: 'skill_b', trust_score: '0.70', capabilities_required: ['net:http', 'fs:read'] },
];

const COMP_ROW = { id: 'comp_id', slug: 'my-pipeline-abc123' };

// ──────────────────────────────────────────────────────────────────────────────
// Trust math
// ──────────────────────────────────────────────────────────────────────────────

describe('createComposition — trust math', () => {
  it('trust = min(step trusts) × 0.9 rounded to 2 decimals', async () => {
    const { pool, calls } = scriptedPool([
      { rows: publishedRows },
      { rows: [COMP_ROW] },
      { rows: [] },
      { rows: [] },
    ]);
    const { adapters } = makeAdapters(pool);
    await createComposition(baseInput(), adapters);
    // trust = min(0.80, 0.70) × 0.90 = 0.63
    const insert = calls[1]!;
    expect(insert.params![6]).toBe(0.63);
  });

  it('rounds via Math.round × 100 / 100', async () => {
    const rows = [
      { id: 'a', trust_score: '0.85', capabilities_required: null },
      { id: 'b', trust_score: '0.85', capabilities_required: null },
    ];
    const { pool, calls } = scriptedPool([
      { rows },
      { rows: [COMP_ROW] },
      { rows: [] },
      { rows: [] },
    ]);
    const { adapters } = makeAdapters(pool);
    await createComposition(
      baseInput({ steps: [{ skillId: 'a' }, { skillId: 'b' }] }),
      adapters,
    );
    // 0.85 * 0.9 = 0.765 → round → 0.77
    expect(calls[1]!.params![6]).toBe(0.77);
  });

  it('parseFloat "0" when trust_score is missing/invalid → trust 0', async () => {
    const rows = [
      { id: 'a', trust_score: 'oops', capabilities_required: null },
      { id: 'b', trust_score: '0.90', capabilities_required: null },
    ];
    const { pool, calls } = scriptedPool([
      { rows },
      { rows: [COMP_ROW] },
      { rows: [] },
      { rows: [] },
    ]);
    const { adapters } = makeAdapters(pool);
    await createComposition(
      baseInput({ steps: [{ skillId: 'a' }, { skillId: 'b' }] }),
      adapters,
    );
    expect(calls[1]!.params![6]).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Capability union
// ──────────────────────────────────────────────────────────────────────────────

describe('createComposition — capabilities union', () => {
  it('unions capabilities across all step skills and deduplicates', async () => {
    const { pool, calls } = scriptedPool([
      { rows: publishedRows },
      { rows: [COMP_ROW] },
      { rows: [] },
      { rows: [] },
    ]);
    const { adapters } = makeAdapters(pool);
    await createComposition(baseInput(), adapters);
    const caps = calls[1]!.params![7] as string[];
    expect(caps).toHaveLength(2);
    expect(new Set(caps)).toEqual(new Set(['fs:read', 'net:http']));
  });

  it('handles null capabilities_required rows', async () => {
    const rows = [
      { id: 'a', trust_score: '0.9', capabilities_required: null },
      { id: 'b', trust_score: '0.9', capabilities_required: ['x'] },
    ];
    const { pool, calls } = scriptedPool([
      { rows },
      { rows: [COMP_ROW] },
      { rows: [] },
      { rows: [] },
    ]);
    const { adapters } = makeAdapters(pool);
    await createComposition(
      baseInput({ steps: [{ skillId: 'a' }, { skillId: 'b' }] }),
      adapters,
    );
    expect(calls[1]!.params![7]).toEqual(['x']);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Slug generation
// ──────────────────────────────────────────────────────────────────────────────

describe('createComposition — slug', () => {
  it('uses supplied slug verbatim', async () => {
    const { pool, calls } = scriptedPool([
      { rows: publishedRows },
      { rows: [COMP_ROW] },
      { rows: [] },
      { rows: [] },
    ]);
    const { adapters } = makeAdapters(pool);
    await createComposition(baseInput({ slug: 'my-custom-slug' }), adapters);
    expect(calls[1]!.params![1]).toBe('my-custom-slug');
  });

  it('generates slug = kebab(name) + nanoid(6) when none supplied', async () => {
    const { pool, calls } = scriptedPool([
      { rows: publishedRows },
      { rows: [COMP_ROW] },
      { rows: [] },
      { rows: [] },
    ]);
    const { adapters } = makeAdapters(pool);
    await createComposition(
      baseInput({ name: 'My Awesome Pipeline' }),
      adapters,
    );
    const slug = calls[1]!.params![1] as string;
    // kebab of 'My Awesome Pipeline' -> 'my-awesome-pipeline-<6-char nanoid>'.
    // nanoid alphabet is [A-Za-z0-9_-].
    expect(slug).toMatch(/^my-awesome-pipeline-[A-Za-z0-9_-]{6}$/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Step insertion
// ──────────────────────────────────────────────────────────────────────────────

describe('createComposition — step insertion', () => {
  it('inserts steps with step_order 1..N and honors stepName / onError defaults', async () => {
    const { pool, calls } = scriptedPool([
      { rows: publishedRows },
      { rows: [COMP_ROW] },
      { rows: [] }, // step 1 insert
      { rows: [] }, // step 2 insert
    ]);
    const { adapters } = makeAdapters(pool);
    await createComposition(
      baseInput({
        steps: [
          { skillId: 'skill_a' }, // no stepName, no onError → 'fail'
          {
            skillId: 'skill_b',
            stepName: 'Bee',
            inputMapping: { in: 'out' },
            onError: 'skip',
          },
        ],
      }),
      adapters,
    );

    const step1 = calls[2]!;
    expect(step1.sql).toContain('INSERT INTO composition_steps');
    // params order: composition_id, step_order, skill_id, step_name, input_mapping, on_error
    expect(step1.params).toEqual(['comp_id', 1, 'skill_a', null, null, 'fail']);

    const step2 = calls[3]!;
    expect(step2.params).toEqual([
      'comp_id',
      2,
      'skill_b',
      'Bee',
      JSON.stringify({ in: 'out' }),
      'skip',
    ]);
  });

  it('passes composition_skill_ids array (positional param 8) to the skills INSERT', async () => {
    const { pool, calls } = scriptedPool([
      { rows: publishedRows },
      { rows: [COMP_ROW] },
      { rows: [] },
      { rows: [] },
    ]);
    const { adapters } = makeAdapters(pool);
    await createComposition(baseInput(), adapters);
    expect(calls[1]!.params![8]).toEqual(['skill_a', 'skill_b']);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Validation errors
// ──────────────────────────────────────────────────────────────────────────────

describe('createComposition — validation', () => {
  it('throws ValidationError listing missing skill IDs', async () => {
    // Only 'skill_a' comes back — 'skill_b' is missing
    const rows = [{ id: 'skill_a', trust_score: '0.8', capabilities_required: null }];
    const { pool } = scriptedPool([{ rows }]);
    const { adapters } = makeAdapters(pool);
    await expect(createComposition(baseInput(), adapters)).rejects.toThrow(
      ValidationError,
    );
    await expect(createComposition(baseInput(), adapters)).rejects.toThrow(
      /skill_b/,
    );
  });

  it('sends first query with id=ANY(uuid[]) and status=published guard', async () => {
    const { pool, calls } = scriptedPool([{ rows: publishedRows }, { rows: [COMP_ROW] }, { rows: [] }, { rows: [] }]);
    const { adapters } = makeAdapters(pool);
    await createComposition(baseInput(), adapters);
    expect(calls[0]!.sql).toContain('id = ANY($1::uuid[])');
    expect(calls[0]!.sql).toContain("status = 'published'");
    expect(calls[0]!.params).toEqual([['skill_a', 'skill_b']]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Queue best-effort
// ──────────────────────────────────────────────────────────────────────────────

describe('createComposition — queue best-effort', () => {
  it('sends embed + scan messages after insert', async () => {
    const { pool } = scriptedPool([
      { rows: publishedRows },
      { rows: [COMP_ROW] },
      { rows: [] },
      { rows: [] },
    ]);
    const { adapters, embedSends, scanSends } = makeAdapters(pool);
    await createComposition(baseInput(), adapters);
    expect(embedSends).toEqual([{ skillId: 'comp_id', action: 'embed' }]);
    expect(scanSends[0]!.skillId).toBe('comp_id');
    expect(scanSends[0]!.priority).toBe('normal');
  });

  it('swallows queue send failure and still returns the composition', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { pool } = scriptedPool([
      { rows: publishedRows },
      { rows: [COMP_ROW] },
      { rows: [] },
      { rows: [] },
    ]);
    const throwing: QueueAdapter<unknown> = {
      send: vi.fn(async () => {
        throw new Error('q');
      }),
      sendBatch: vi.fn(),
    };
    const adapters: CompositionAdapters = {
      pool,
      embedQueue: throwing as QueueAdapter<EmbedQueueMessage>,
      scanQueue: throwing as QueueAdapter<CogniumScanQueueMessage>,
    };
    const out = await createComposition(baseInput(), adapters);
    expect(out.id).toBe('comp_id');
    expect(out.slug).toBe('my-pipeline-abc123');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('sets skill_type=auto-composite and execution_layer=composite', async () => {
    const { pool, calls } = scriptedPool([
      { rows: publishedRows },
      { rows: [COMP_ROW] },
      { rows: [] },
      { rows: [] },
    ]);
    const { adapters } = makeAdapters(pool);
    await createComposition(baseInput(), adapters);
    expect(calls[1]!.sql).toContain("'auto-composite'");
    expect(calls[1]!.sql).toContain("'composite'");
  });
});
