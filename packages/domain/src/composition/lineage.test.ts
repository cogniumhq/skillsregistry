// ══════════════════════════════════════════════════════════════════════════════
// Lineage queries — getAncestry / getForks / getDependents
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import { getAncestry, getForks, getDependents } from './lineage.js';
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

// ──────────────────────────────────────────────────────────────────────────────
// getAncestry
// ──────────────────────────────────────────────────────────────────────────────

describe('getAncestry', () => {
  it('returns the recursive walk in depth-ascending order', async () => {
    const { pool, calls } = scriptedPool([
      {
        rows: [
          { id: 'self', slug: 's', name: 'S', version: '1.0.0', depth: 0 },
          { id: 'parent', slug: 'p', name: 'P', version: '1.0.0', depth: 1 },
          { id: 'grandp', slug: 'g', name: 'G', version: '2.0.0', depth: 2 },
        ],
      },
    ]);
    const out = await getAncestry('self', pool);
    expect(out).toHaveLength(3);
    expect(out[0]!.depth).toBe(0);
    expect(out[2]!.depth).toBe(2);
    expect(calls[0]!.sql).toContain('WITH RECURSIVE ancestry');
    expect(calls[0]!.sql).toContain(
      "s.slug || '@' || s.version = a.forked_from",
    );
    expect(calls[0]!.sql).toContain('ORDER BY depth ASC');
    expect(calls[0]!.params).toEqual(['self']);
  });

  it('defaults depth to 0 when nullish', async () => {
    const { pool } = scriptedPool([
      {
        rows: [
          { id: 'x', slug: 'x', name: 'X', version: '1', depth: null },
        ],
      },
    ]);
    const out = await getAncestry('x', pool);
    expect(out[0]!.depth).toBe(0);
  });

  it('returns [] when skill has no ancestors', async () => {
    const { pool } = scriptedPool([{ rows: [] }]);
    const out = await getAncestry('nope', pool);
    expect(out).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getForks
// ──────────────────────────────────────────────────────────────────────────────

describe('getForks', () => {
  it('resolves source slug@version then queries forked_from', async () => {
    const { pool, calls } = scriptedPool([
      { rows: [{ slug: 'rust-lint', version: '2.0.0' }] },
      {
        rows: [
          {
            id: 'f1',
            slug: 'rust-lint-fork-abc',
            name: 'rust-lint (fork)',
            author_type: 'human',
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
      },
    ]);
    const out = await getForks('src_id', pool);
    // First call: resolve slug@version
    expect(calls[0]!.sql).toContain('SELECT slug, version FROM skills');
    expect(calls[0]!.params).toEqual(['src_id']);
    // Second call: forks lookup
    expect(calls[1]!.sql).toContain('WHERE forked_from = $1');
    expect(calls[1]!.sql).toContain('ORDER BY created_at DESC');
    expect(calls[1]!.params).toEqual(['rust-lint@2.0.0']);
    expect(out).toEqual([
      {
        id: 'f1',
        slug: 'rust-lint-fork-abc',
        name: 'rust-lint (fork)',
        authorType: 'human',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ]);
  });

  it('returns [] when source skill does not exist', async () => {
    const { pool, calls } = scriptedPool([{ rows: [] }]);
    const out = await getForks('missing', pool);
    expect(out).toEqual([]);
    // Should skip the second query entirely
    expect(calls).toHaveLength(1);
  });

  it('returns [] when source exists but has no forks', async () => {
    const { pool } = scriptedPool([
      { rows: [{ slug: 's', version: '1.0.0' }] },
      { rows: [] },
    ]);
    const out = await getForks('src', pool);
    expect(out).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getDependents
// ──────────────────────────────────────────────────────────────────────────────

describe('getDependents', () => {
  it('returns compositions containing the skill as a step, ordered by name ASC', async () => {
    const { pool, calls } = scriptedPool([
      {
        rows: [
          {
            composition_id: 'c1',
            composition_slug: 'alpha-pipe',
            composition_name: 'Alpha Pipeline',
            step_order: 3,
          },
          {
            composition_id: 'c2',
            composition_slug: 'beta-pipe',
            composition_name: 'Beta Pipeline',
            step_order: 1,
          },
        ],
      },
    ]);
    const out = await getDependents('used_skill', pool);
    expect(calls[0]!.sql).toContain('composition_steps cs');
    expect(calls[0]!.sql).toContain('JOIN skills s ON s.id = cs.composition_id');
    expect(calls[0]!.sql).toContain('WHERE cs.skill_id = $1');
    expect(calls[0]!.sql).toContain('ORDER BY s.name ASC');
    expect(calls[0]!.params).toEqual(['used_skill']);
    expect(out).toEqual([
      {
        compositionId: 'c1',
        compositionSlug: 'alpha-pipe',
        compositionName: 'Alpha Pipeline',
        stepOrder: 3,
      },
      {
        compositionId: 'c2',
        compositionSlug: 'beta-pipe',
        compositionName: 'Beta Pipeline',
        stepOrder: 1,
      },
    ]);
  });

  it('returns [] when nobody uses the skill', async () => {
    const { pool } = scriptedPool([{ rows: [] }]);
    const out = await getDependents('unused', pool);
    expect(out).toEqual([]);
  });
});
