import { describe, expect, it, vi } from 'vitest';
import type { SqlPool } from '../adapters/sql.js';
import type { QueueAdapter } from '../adapters/queue.js';
import type { EmbedQueueMessage } from './adapters.js';
import { COMPOSITION_SKILL_TYPES, enqueueCompositionEmbedBackfill, findUnembeddedCompositions } from './backfill.js';

const ROWS = [
  { id: 'c1', slug: '@cognium/wf-a', version: '0.2.0', skill_type: 'human-composite' },
  { id: 'c2', slug: 'tenant/wf-b', version: '1.0.0', skill_type: 'pipeline' },
];

function pool(rows: unknown[]) {
  const query = vi.fn(async () => ({ rows, rowCount: rows.length }));
  return { pool: { query, connect: vi.fn() } as unknown as SqlPool, query };
}

function queue() {
  const send = vi.fn(async (_m: EmbedQueueMessage) => {});
  return { q: { send, sendBatch: vi.fn() } as QueueAdapter<EmbedQueueMessage>, send };
}

describe('findUnembeddedCompositions', () => {
  it('lists published composites of every composition type that have no embedding row', async () => {
    const { pool: p, query } = pool(ROWS);
    expect(await findUnembeddedCompositions(p)).toEqual([
      { id: 'c1', slug: '@cognium/wf-a', version: '0.2.0', skillType: 'human-composite' },
      { id: 'c2', slug: 'tenant/wf-b', version: '1.0.0', skillType: 'pipeline' },
    ]);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("s.status = 'published'");
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM skill_embeddings se WHERE se.skill_id = s.id)');
    expect(params).toEqual([[...COMPOSITION_SKILL_TYPES], 1000]);
  });
});

describe('enqueueCompositionEmbedBackfill', () => {
  it('dry run by default: lists, enqueues nothing', async () => {
    const { q, send } = queue();
    const out = await enqueueCompositionEmbedBackfill(pool(ROWS).pool, q);
    expect(out.found).toHaveLength(2);
    expect(out.enqueued).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('with dryRun: false, enqueues one embed per composite found', async () => {
    const { q, send } = queue();
    const out = await enqueueCompositionEmbedBackfill(pool(ROWS).pool, q, { dryRun: false });
    expect(out.enqueued).toBe(2);
    expect(send.mock.calls.map((c) => c[0])).toEqual([
      { skillId: 'c1', action: 'embed' },
      { skillId: 'c2', action: 'embed' },
    ]);
  });

  it('nothing to repair: nothing enqueued', async () => {
    const { q, send } = queue();
    expect(await enqueueCompositionEmbedBackfill(pool([]).pool, q, { dryRun: false })).toEqual({ found: [], enqueued: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});
