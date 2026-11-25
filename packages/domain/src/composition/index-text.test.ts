import { describe, expect, it, vi } from 'vitest';
import type { SqlPool } from '../adapters/sql.js';
import { NotFoundError } from './errors.js';
import {
  COMPOSITION_INDEX_TEXT_MAX,
  compositionIndexText,
  loadCompositionIndexText,
  stepsOfWorkflowDefinition,
} from './index-text.js';

function scriptedPool(script: Array<{ rows: unknown[] }>) {
  let i = 0;
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const pool = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      const rows = script[i++]?.rows ?? [];
      return { rows, rowCount: rows.length };
    }),
    connect: vi.fn(),
  } as unknown as SqlPool;
  return { pool, calls };
}

describe('compositionIndexText', () => {
  it('names the composite, its description, then each step with the skill it runs and that skill\'s summary', () => {
    expect(
      compositionIndexText({
        name: 'Connect and understand',
        description: 'Connect a repository\\n and understand it.',
        steps: [
          { name: 'clone', skill: '@cognium/git', summary: 'Clones a repository at a branch. Shallow by default.' },
          { name: 'understand', skill: '@cognium/cognium-scan', summary: null },
        ],
      }),
    ).toBe(
      [
        'Connect and understand',
        'Connect a repository\\n and understand it.',
        'Steps (2):',
        '1. clone — runs @cognium/git — Clones a repository at a branch.',
        '2. understand — runs @cognium/cognium-scan',
      ].join('\n'),
    );
  });

  it('is deterministic, and bounded', () => {
    const input = { name: 'n', description: 'd'.repeat(10_000), steps: [] };
    expect(compositionIndexText(input)).toBe(compositionIndexText(input));
    expect(compositionIndexText(input).length).toBe(COMPOSITION_INDEX_TEXT_MAX);
  });

  it('a step with nothing known still counts as a step', () => {
    expect(compositionIndexText({ name: 'n', description: null, steps: [{ name: null, skill: null, summary: null }] })).toBe('n\nSteps (1):\n1. step');
  });
});

describe('stepsOfWorkflowDefinition', () => {
  it('reads the inline DAG steps (title or id, skillRef, description), as an object or JSON text', () => {
    const dag = { steps: [{ id: 'clone', skillRef: '@cognium/git@1.0.0' }, { id: 'scan', title: 'Understand', skillRef: '@cognium/cognium-scan@1.0.1', description: 'Layers and findings.' }] };
    const want = [
      { name: 'clone', skill: '@cognium/git@1.0.0', summary: null },
      { name: 'Understand', skill: '@cognium/cognium-scan@1.0.1', summary: 'Layers and findings.' },
    ];
    expect(stepsOfWorkflowDefinition(dag)).toEqual(want);
    expect(stepsOfWorkflowDefinition(JSON.stringify(dag))).toEqual(want);
  });

  it('anything else reads as no steps', () => {
    for (const v of [null, undefined, 'not json', { steps: 'x' }, { nope: [] }]) expect(stepsOfWorkflowDefinition(v)).toEqual([]);
  });
});

describe('loadCompositionIndexText', () => {
  it('uses composition_steps with each step skill\'s slug and summary, in step order', async () => {
    const { pool, calls } = scriptedPool([
      { rows: [{ name: 'C', description: null, workflow_definition: { steps: [{ id: 'ignored', skillRef: 'x' }] } }] },
      { rows: [{ step_name: 'clone', slug: '@cognium/git', agent_summary: 'Clones.', description: 'ignored' }, { step_name: null, slug: '@cognium/scan', agent_summary: null, description: 'Scans.' }] },
    ]);
    expect(await loadCompositionIndexText(pool, 'cmp_1')).toBe('C\nSteps (2):\n1. clone — runs @cognium/git — Clones.\n2. runs @cognium/scan — Scans.');
    expect(calls[1]!.sql).toContain('ORDER BY cs.step_order');
  });

  it('falls back to the inline DAG when the row has no step rows', async () => {
    const { pool } = scriptedPool([
      { rows: [{ name: 'C', description: 'Desc.', workflow_definition: { steps: [{ id: 'clone', skillRef: '@cognium/git@1.0.0' }] } }] },
      { rows: [] },
    ]);
    expect(await loadCompositionIndexText(pool, 'cmp_1')).toBe('C\nDesc.\nSteps (1):\n1. clone — runs @cognium/git@1.0.0');
  });

  it('a missing composition is NotFound', async () => {
    const { pool } = scriptedPool([{ rows: [] }]);
    await expect(loadCompositionIndexText(pool, 'nope')).rejects.toThrow(NotFoundError);
  });
});
