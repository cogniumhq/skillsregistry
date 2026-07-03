// ══════════════════════════════════════════════════════════════════════════════
// publishComposition — draft → published guarded transition
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import { publishComposition } from './publish.js';
import { NotFoundError, ValidationError } from './errors.js';
import type { SqlPool } from '../adapters/sql.js';

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

const DRAFT_COMPOSITION = {
  id: 'comp_id',
  slug: 'my-comp',
  status: 'draft',
  skill_type: 'auto-composite',
};

const PUBLISHED_STEP_ROWS = [
  { skill_id: 'a', status: 'published', name: 'skill A' },
  { skill_id: 'b', status: 'published', name: 'skill B' },
];

const PUBLISHED_RETURN = { id: 'comp_id', slug: 'my-comp', status: 'published' };

// ──────────────────────────────────────────────────────────────────────────────
// Happy path
// ──────────────────────────────────────────────────────────────────────────────

describe('publishComposition — happy path', () => {
  it('transitions draft → published and returns the row', async () => {
    const { pool, calls } = scriptedPool([
      { rows: [DRAFT_COMPOSITION] },
      { rows: PUBLISHED_STEP_ROWS },
      { rows: [PUBLISHED_RETURN] },
    ]);
    const out = await publishComposition('comp_id', pool);
    expect(out).toEqual(PUBLISHED_RETURN);
    // UPDATE query is last
    expect(calls[2]!.sql).toContain("status = 'published'");
    expect(calls[2]!.sql).toContain('published_at = NOW()');
    expect(calls[2]!.sql).toContain('updated_at = NOW()');
    expect(calls[2]!.params).toEqual(['comp_id']);
  });

  it('accepts all four composition types', async () => {
    for (const skillType of [
      'auto-composite',
      'human-composite',
      'composition',
      'pipeline',
    ]) {
      const { pool } = scriptedPool([
        { rows: [{ ...DRAFT_COMPOSITION, skill_type: skillType }] },
        { rows: PUBLISHED_STEP_ROWS },
        { rows: [PUBLISHED_RETURN] },
      ]);
      const out = await publishComposition('comp_id', pool);
      expect(out.status).toBe('published');
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Guards
// ──────────────────────────────────────────────────────────────────────────────

describe('publishComposition — guards', () => {
  it('throws NotFoundError when composition does not exist', async () => {
    const { pool } = scriptedPool([{ rows: [] }]);
    await expect(publishComposition('missing', pool)).rejects.toThrow(
      NotFoundError,
    );
  });

  it('throws ValidationError when skill is not a composition type', async () => {
    const { pool } = scriptedPool([
      { rows: [{ ...DRAFT_COMPOSITION, skill_type: 'atomic' }] },
    ]);
    let caught: unknown;
    try {
      await publishComposition('comp_id', pool);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as Error).message).toMatch(/not a composition/);
  });

  it('throws ValidationError when composition is not in draft state', async () => {
    const { pool } = scriptedPool([
      { rows: [{ ...DRAFT_COMPOSITION, status: 'published' }] },
    ]);
    let caught: unknown;
    try {
      await publishComposition('comp_id', pool);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as Error).message).toMatch(/'published'/);
    expect((caught as Error).message).toMatch(/expected 'draft'/);
  });

  it('throws ValidationError when a step skill is not published (lists details)', async () => {
    const { pool } = scriptedPool([
      { rows: [DRAFT_COMPOSITION] },
      {
        rows: [
          { skill_id: 'a', status: 'published', name: 'skill A' },
          { skill_id: 'b', status: 'archived', name: 'skill B' },
          { skill_id: 'c', status: 'draft', name: 'skill C' },
        ],
      },
    ]);
    let caught: unknown;
    try {
      await publishComposition('comp_id', pool);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as Error).message).toMatch(/skill B \(archived\)/);
    expect((caught as Error).message).toMatch(/skill C \(draft\)/);
    // The published-status skill should NOT be in the error
    expect((caught as Error).message).not.toMatch(/skill A/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SQL shape
// ──────────────────────────────────────────────────────────────────────────────

describe('publishComposition — SQL shape', () => {
  it('SELECTs skill by id (no status guard — publish() checks state itself)', async () => {
    const { pool, calls } = scriptedPool([{ rows: [] }]);
    await expect(publishComposition('comp_id', pool)).rejects.toThrow(
      NotFoundError,
    );
    expect(calls[0]!.sql).toContain('WHERE id = $1');
    expect(calls[0]!.params).toEqual(['comp_id']);
  });

  it('joins composition_steps to skills to fetch step names + statuses', async () => {
    const { pool, calls } = scriptedPool([
      { rows: [DRAFT_COMPOSITION] },
      { rows: PUBLISHED_STEP_ROWS },
      { rows: [PUBLISHED_RETURN] },
    ]);
    await publishComposition('comp_id', pool);
    expect(calls[1]!.sql).toContain('composition_steps cs');
    expect(calls[1]!.sql).toContain('JOIN skills s ON s.id = cs.skill_id');
    expect(calls[1]!.sql).toContain('WHERE cs.composition_id = $1');
    expect(calls[1]!.params).toEqual(['comp_id']);
  });
});
