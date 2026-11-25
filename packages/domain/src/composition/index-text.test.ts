import { describe, expect, it, vi } from 'vitest';
import type { SqlPool } from '../adapters/sql.js';
import { NotFoundError } from './errors.js';
import {
  PRIVATE_STEP_LABEL,
  buildCompositeSummary,
  compositeIndexableText,
  extractWorkflowSteps,
  isStepVisibleToComposite,
  loadCompositionIndexText,
  resolveCompositeSteps,
  stripVersion,
} from './index-text.js';
import { COMPOSITION_SKILL_TYPES, isCompositeSkillType } from './skill-types.js';

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

// The hosted service's real DAG shape (a published composite), used to pin
// the text byte for byte to what its deployed builder produces.
const DAG = {
  steps: [
    { id: 'clone-repo', skillRef: 'cognium-git@1.0.2' },
    { id: 'read-manifests', skillRef: 'cognium-dependency-audit@1.0.0' },
    { id: 'query-osv', skillRef: 'cognium-dependency-audit@1.0.0' },
    { id: 'check-licenses', skillRef: 'cognium-dependency-audit@1.0.0' },
    { id: 'format-report', skillRef: 'cognium-markdown-format@1.0.0' },
    { id: 'open-pr', skillRef: 'cognium-github@1.0.0' },
  ],
};

describe('COMPOSITION_SKILL_TYPES / isCompositeSkillType', () => {
  it('recognises every composition type and nothing else', () => {
    for (const t of COMPOSITION_SKILL_TYPES) expect(isCompositeSkillType(t)).toBe(true);
    for (const t of ['atomic', 'forked', 'x', null, undefined]) expect(isCompositeSkillType(t)).toBe(false);
  });
});

describe('buildCompositeSummary — the hosted service\'s text, byte for byte', () => {
  it('description, workflow clause, step names in order, distinct version-stripped slugs', () => {
    expect(buildCompositeSummary({ description: 'audit dependencies for vulnerabilities and license problems', workflowDefinition: DAG })).toBe(
      'audit dependencies for vulnerabilities and license problems.' +
        ' Use this workflow to run a multi-step composition of skills.' +
        ' Runs 6 steps: clone-repo, read-manifests, query-osv, check-licenses, format-report, open-pr.' +
        ' Composed of skills: cognium-git, cognium-dependency-audit, cognium-markdown-format, cognium-github.',
    );
  });

  it('composition_steps fallback, capabilities, singular step', () => {
    expect(
      buildCompositeSummary({ description: 'Scans.', compositionSteps: [{ name: 'scan', skillSlug: 'cognium-scan' }], capabilitiesRequired: ['fs', 'net'] }),
    ).toBe('Scans. Use this workflow to run a multi-step composition of skills. Runs 1 step: scan. Composed of skills: cognium-scan. Requires fs, net capabilities.');
  });

  it('is never empty, and carries no step skill summaries', () => {
    expect(buildCompositeSummary({ description: '', workflowDefinition: null, compositionSteps: [] })).toBe(
      'Use this workflow to run a multi-step composition of skills.',
    );
  });

  it('the indexable text adds the `name — slug. ` prefix', () => {
    expect(compositeIndexableText('Audit', 'wf-audit', 'Body.')).toBe('Audit — wf-audit. Body.');
  });
});

describe('extractWorkflowSteps / resolveCompositeSteps', () => {
  it('reads id or name, skillRef or skillSlug; strips @version; scoped refs keep their @', () => {
    expect(
      extractWorkflowSteps({ steps: [{ id: 'a', skillRef: '@cognium/git@1.0.2' }, { name: 'b', skillSlug: 'x' }, { skillRef: 'only-ref@2.0.0' }, { other: 1 }] }),
    ).toEqual([
      { name: 'a', skillSlug: '@cognium/git' },
      { name: 'b', skillSlug: 'x' },
      { name: 'only-ref@2.0.0', skillSlug: 'only-ref' },
    ]);
    expect(stripVersion('@cognium/git')).toBe('@cognium/git');
  });

  it('accepts the DAG as JSON text; anything malformed reads as no steps', () => {
    expect(extractWorkflowSteps(JSON.stringify(DAG))).toHaveLength(6);
    for (const v of [null, undefined, 'not json', [], { steps: 'x' }, { nope: [] }]) expect(extractWorkflowSteps(v)).toEqual([]);
  });

  it('prefers the DAG, falls back to composition steps', () => {
    expect(resolveCompositeSteps({ workflowDefinition: DAG, compositionSteps: [{ name: 'z' }] })[0]!.name).toBe('clone-repo');
    expect(resolveCompositeSteps({ workflowDefinition: null, compositionSteps: [{ name: 'z' }] })).toEqual([{ name: 'z' }]);
  });
});

describe('isStepVisibleToComposite', () => {
  const pub = { visibility: 'public', tenantId: 'tA' };
  const privA = { visibility: 'tenant_private', tenantId: 'tA' };
  it('a public step is visible to any composite', () => {
    expect(isStepVisibleToComposite(pub, pub)).toBe(true);
    expect(isStepVisibleToComposite(privA, pub)).toBe(true);
  });
  it('a non-public step is never visible under a public or unlisted composite', () => {
    for (const v of ['private', 'tenant_private', 'tenant_internal', 'unlisted']) {
      expect(isStepVisibleToComposite(pub, { visibility: v, tenantId: 'tA' })).toBe(false);
      expect(isStepVisibleToComposite({ visibility: 'unlisted', tenantId: 'tA' }, { visibility: v, tenantId: 'tA' })).toBe(false);
    }
  });
  it('under a tenant-private composite: same-tenant private steps only', () => {
    expect(isStepVisibleToComposite(privA, privA)).toBe(true);
    expect(isStepVisibleToComposite(privA, { visibility: 'private', tenantId: 'tA' })).toBe(true);
    expect(isStepVisibleToComposite(privA, { visibility: 'tenant_private', tenantId: 'tB' })).toBe(false);
    expect(isStepVisibleToComposite(privA, { visibility: 'tenant_internal', tenantId: 'tA' })).toBe(false);
    expect(isStepVisibleToComposite(privA, { visibility: 'unlisted', tenantId: 'tA' })).toBe(false);
    expect(isStepVisibleToComposite({ visibility: 'tenant_private', tenantId: null }, { visibility: 'tenant_private', tenantId: null })).toBe(false);
  });
});

describe('loadCompositionIndexText', () => {
  const composite = (over: Record<string, unknown> = {}) => ({
    name: 'C', slug: 'wf-c', description: 'Desc', capabilities_required: [], workflow_definition: null, visibility: 'public', tenant_id: 'tA', ...over,
  });

  it('composition_steps: names visible step skills; a private step by its step name or generically; never a summary', async () => {
    const { pool, calls } = scriptedPool([
      { rows: [composite()] },
      {
        rows: [
          { step_name: 'clone', slug: '@cognium/git', visibility: 'public', tenant_id: 'default' },
          { step_name: 'secret-sauce', slug: 'acme/internal-scan', visibility: 'tenant_private', tenant_id: 'tA' },
          { step_name: null, slug: 'acme/other', visibility: 'private', tenant_id: 'tA' },
          { step_name: null, slug: null, visibility: null, tenant_id: null },
        ],
      },
    ]);
    const text = await loadCompositionIndexText(pool, 'cmp_1');
    expect(text).toBe(
      `C — wf-c. Desc. Use this workflow to run a multi-step composition of skills. Runs 3 steps: clone, secret-sauce, ${PRIVATE_STEP_LABEL}. Composed of skills: @cognium/git.`,
    );
    expect(text).not.toContain('acme/');
    expect(calls[1]!.sql).toContain('ORDER BY cs.step_order');
    expect(calls[1]!.sql).not.toContain('agent_summary');
  });

  it('a tenant-private composite names its own tenant\'s private steps', async () => {
    const { pool } = scriptedPool([
      { rows: [composite({ visibility: 'tenant_private' })] },
      { rows: [{ step_name: 'scan', slug: 'acme/internal-scan', visibility: 'tenant_private', tenant_id: 'tA' }, { step_name: 'x', slug: 'other/priv', visibility: 'tenant_private', tenant_id: 'tB' }] },
    ]);
    const text = await loadCompositionIndexText(pool, 'cmp_1');
    expect(text).toContain('Composed of skills: acme/internal-scan.');
    expect(text).not.toContain('other/priv');
  });

  it('DAG: a ref is named only when it resolves to a visible skill (unresolved counts as not visible)', async () => {
    const { pool, calls } = scriptedPool([
      { rows: [composite({ workflow_definition: { steps: [{ id: 'clone', skillRef: 'cognium-git@1.0.2' }, { id: 'p', skillRef: 'acme/priv@1.0.0' }, { skillRef: 'acme/priv@1.0.0' }, { id: 'u', skillRef: 'ghost@1.0.0' }] } })] },
      { rows: [{ slug: 'cognium-git', visibility: 'public', tenant_id: 'default' }, { slug: 'acme/priv', visibility: 'tenant_private', tenant_id: 'tA' }] },
    ]);
    const text = await loadCompositionIndexText(pool, 'cmp_1');
    expect(text).toBe(
      `C — wf-c. Desc. Use this workflow to run a multi-step composition of skills. Runs 4 steps: clone, p, ${PRIVATE_STEP_LABEL}, u. Composed of skills: cognium-git.`,
    );
    expect(calls[1]!.params).toEqual([['cognium-git', 'acme/priv', 'ghost']]);
    expect(calls).toHaveLength(2); // the DAG wins; composition_steps is not read
  });

  it('a missing composition is NotFound', async () => {
    const { pool } = scriptedPool([{ rows: [] }]);
    await expect(loadCompositionIndexText(pool, 'nope')).rejects.toThrow(NotFoundError);
  });
});
