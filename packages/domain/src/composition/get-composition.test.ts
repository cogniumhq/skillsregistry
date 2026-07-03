// ══════════════════════════════════════════════════════════════════════════════
// getCompositionBySlug — shared composition-detail loader
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import { getCompositionBySlug } from './get-composition.js';
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

function baseSkillRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'comp_id',
    name: 'My Comp',
    slug: 'my-comp',
    version: '1.0.0',
    description: 'multi-step',
    agent_summary: 'agent hint',
    skill_type: 'auto-composite',
    status: 'published',
    visibility: 'public',
    tenant_id: null,
    trust_score: '0.72',
    verification_tier: 'verified',
    trust_badge: 'green',
    trust_tier: 'A',
    trust_score_v2: 0.72,
    cognium_scanned_at: new Date('2026-01-15T10:00:00Z'),
    content_safety_passed: true,
    category: 'dev-tools',
    categories: ['dev-tools', 'lint'],
    tags: ['rust', 'ci'],
    ecosystem: 'rust',
    language: 'rust',
    license: 'MIT',
    source: 'manual',
    source_url: 'https://example.com',
    created_at: new Date('2025-12-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    published_at: new Date('2026-01-15T00:00:00Z'),
    ...overrides,
  };
}

const STEPS = [
  {
    id: 'step1',
    step_order: 1,
    skill_id: 'sk_a',
    step_name: 'Lint',
    input_mapping: { in: 'code' },
    on_error: 'fail',
    skill_name: 'Rust Lint',
    skill_slug: 'rust-lint',
  },
  {
    id: 'step2',
    step_order: 2,
    skill_id: 'sk_b',
    step_name: null,
    input_mapping: null,
    on_error: null,
    skill_name: 'Rust Test',
    skill_slug: 'rust-test',
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// Not-found paths
// ──────────────────────────────────────────────────────────────────────────────

describe('getCompositionBySlug — not found', () => {
  it('returns { found: false } when no skill matches the slug', async () => {
    const { pool, calls } = scriptedPool([{ rows: [] }]);
    const out = await getCompositionBySlug(pool, 'missing');
    expect(out).toEqual({ found: false });
    // Only the skill lookup runs — steps query is skipped
    expect(calls).toHaveLength(1);
  });

  it('filters by skill_type ANY(composition types)', async () => {
    const { pool, calls } = scriptedPool([{ rows: [] }]);
    await getCompositionBySlug(pool, 'missing');
    expect(calls[0]!.sql).toContain('skill_type = ANY($2::text[])');
    const types = calls[0]!.params![1] as string[];
    expect(new Set(types)).toEqual(
      new Set(['auto-composite', 'human-composite', 'composition', 'pipeline']),
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Visibility rules
// ──────────────────────────────────────────────────────────────────────────────

describe('getCompositionBySlug — visibility', () => {
  it('returns public compositions to any tenant', async () => {
    const { pool } = scriptedPool([
      { rows: [baseSkillRow({ visibility: 'public' })] },
      { rows: STEPS },
    ]);
    const out = await getCompositionBySlug(pool, 'my-comp');
    expect(out.found).toBe(true);
  });

  it('hides private compositions from default tenant', async () => {
    const { pool } = scriptedPool([
      {
        rows: [
          baseSkillRow({ visibility: 'private', tenant_id: 'tenant_x' }),
        ],
      },
    ]);
    const out = await getCompositionBySlug(pool, 'my-comp', 'default');
    expect(out).toEqual({ found: false });
  });

  it('hides private compositions from a different tenant', async () => {
    const { pool } = scriptedPool([
      {
        rows: [
          baseSkillRow({ visibility: 'private', tenant_id: 'tenant_x' }),
        ],
      },
    ]);
    const out = await getCompositionBySlug(pool, 'my-comp', 'tenant_y');
    expect(out).toEqual({ found: false });
  });

  it('surfaces private compositions to their owning tenant', async () => {
    const { pool } = scriptedPool([
      {
        rows: [
          baseSkillRow({ visibility: 'private', tenant_id: 'tenant_x' }),
        ],
      },
      { rows: STEPS },
    ]);
    const out = await getCompositionBySlug(pool, 'my-comp', 'tenant_x');
    expect(out.found).toBe(true);
  });

  it('hides unlisted compositions with NULL tenant_id from everyone (fail-closed)', async () => {
    const { pool } = scriptedPool([
      {
        rows: [
          baseSkillRow({ visibility: 'unlisted', tenant_id: null }),
        ],
      },
    ]);
    const out = await getCompositionBySlug(pool, 'my-comp', 'tenant_x');
    expect(out).toEqual({ found: false });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Happy-path projection
// ──────────────────────────────────────────────────────────────────────────────

describe('getCompositionBySlug — projection', () => {
  it('maps snake_case columns to camelCase on the response', async () => {
    const { pool } = scriptedPool([
      { rows: [baseSkillRow()] },
      { rows: STEPS },
    ]);
    const out = await getCompositionBySlug(pool, 'my-comp');
    expect(out.found).toBe(true);
    if (!out.found) return;
    const d = out.data;
    expect(d.id).toBe('comp_id');
    expect(d.name).toBe('My Comp');
    expect(d.trustScore).toBe(0.72);
    expect(d.trustTier).toBe('A');
    expect(d.trustScoreV2).toBe(0.72);
    expect(d.cogniumScanned).toBe(true); // scanned_at present
    expect(d.contentSafetyPassed).toBe(true);
    expect(d.categories).toEqual(['dev-tools', 'lint']);
    expect(d.tags).toEqual(['rust', 'ci']);
    expect(d.sourceUrl).toBe('https://example.com');
    expect(d.createdAt).toBe('2025-12-01T00:00:00.000Z');
    expect(d.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(d.publishedAt).toBe('2026-01-15T00:00:00.000Z');
  });

  it('composes shareUrl from default host + slug', async () => {
    const { pool } = scriptedPool([
      { rows: [baseSkillRow()] },
      { rows: STEPS },
    ]);
    const out = await getCompositionBySlug(pool, 'my-comp');
    if (!out.found) throw new Error('expected found');
    expect(out.data.shareUrl).toBe('https://skillsregistry.net/skills/my-comp');
  });

  it('honors custom shareUrlHost option', async () => {
    const { pool } = scriptedPool([
      { rows: [baseSkillRow()] },
      { rows: STEPS },
    ]);
    const out = await getCompositionBySlug(pool, 'my-comp', 'default', {
      shareUrlHost: 'https://my.local',
    });
    if (!out.found) throw new Error('expected found');
    expect(out.data.shareUrl).toBe('https://my.local/skills/my-comp');
  });

  it('returns ordered steps with snake→camel mapping', async () => {
    const { pool, calls } = scriptedPool([
      { rows: [baseSkillRow()] },
      { rows: STEPS },
    ]);
    const out = await getCompositionBySlug(pool, 'my-comp');
    if (!out.found) throw new Error('expected found');
    expect(out.data.steps).toHaveLength(2);
    expect(out.data.steps[0]!.stepOrder).toBe(1);
    expect(out.data.steps[0]!.skillId).toBe('sk_a');
    expect(out.data.steps[0]!.skillName).toBe('Rust Lint');
    expect(out.data.steps[0]!.skillSlug).toBe('rust-lint');
    expect(out.data.steps[0]!.stepName).toBe('Lint');
    expect(out.data.steps[0]!.inputMapping).toEqual({ in: 'code' });
    expect(out.data.steps[0]!.onError).toBe('fail');
    // Row 2 has nulls for step_name / input_mapping / on_error
    expect(out.data.steps[1]!.stepName).toBeNull();
    expect(out.data.steps[1]!.inputMapping).toBeNull();
    expect(out.data.steps[1]!.onError).toBeNull();
    // Query was step_order-ordered on composition_id=comp_id
    expect(calls[1]!.sql).toContain('WHERE cs.composition_id = $1');
    expect(calls[1]!.sql).toContain('ORDER BY cs.step_order');
    expect(calls[1]!.params).toEqual(['comp_id']);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Null coercions
// ──────────────────────────────────────────────────────────────────────────────

describe('getCompositionBySlug — null coercions', () => {
  it('substitutes defaults for nullable fields', async () => {
    const { pool } = scriptedPool([
      {
        rows: [
          baseSkillRow({
            description: null,
            agent_summary: null,
            // Keep visibility='public' so we exercise projection defaults
            // — visibility=null is separately covered by the fail-closed rule.
            tenant_id: null,
            verification_tier: null,
            trust_badge: null,
            trust_tier: null,
            trust_score_v2: null,
            cognium_scanned_at: null,
            content_safety_passed: null,
            category: null,
            categories: null,
            tags: null,
            ecosystem: null,
            language: null,
            license: null,
            source_url: null,
            created_at: null,
            updated_at: null,
            published_at: null,
          }),
        ],
      },
      { rows: [] },
    ]);
    const out = await getCompositionBySlug(pool, 'my-comp');
    if (!out.found) throw new Error('expected found');
    const d = out.data;
    expect(d.description).toBeNull();
    expect(d.agentSummary).toBeNull();
    expect(d.visibility).toBe('public');
    expect(d.verificationTier).toBe('unverified');
    expect(d.categories).toEqual([]);
    expect(d.tags).toEqual([]);
    expect(d.cogniumScanned).toBe(false);
    expect(d.createdAt).toBeNull();
    expect(d.publishedAt).toBeNull();
  });

  it('parseFloat trust_score falls back to 0 when unparseable', async () => {
    const { pool } = scriptedPool([
      { rows: [baseSkillRow({ trust_score: 'oops' })] },
      { rows: [] },
    ]);
    const out = await getCompositionBySlug(pool, 'my-comp');
    if (!out.found) throw new Error('expected found');
    expect(out.data.trustScore).toBe(0);
  });

  it('coerces non-Date timestamp values via String()', async () => {
    const { pool } = scriptedPool([
      {
        rows: [
          baseSkillRow({
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-02-01T00:00:00Z',
            published_at: '2026-03-01T00:00:00Z',
          }),
        ],
      },
      { rows: [] },
    ]);
    const out = await getCompositionBySlug(pool, 'my-comp');
    if (!out.found) throw new Error('expected found');
    expect(out.data.createdAt).toBe('2026-01-01T00:00:00Z');
    expect(out.data.updatedAt).toBe('2026-02-01T00:00:00Z');
    expect(out.data.publishedAt).toBe('2026-03-01T00:00:00Z');
  });
});
