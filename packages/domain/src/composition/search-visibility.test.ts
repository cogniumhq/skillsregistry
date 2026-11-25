// ══════════════════════════════════════════════════════════════════════════════
// A published composite is returned by search — to its audience only
// ══════════════════════════════════════════════════════════════════════════════
//
// Both search paths read `skill_embeddings` (vector KNN, then keyword
// full-text) and join `skills`; a skill with no embedding row is never
// returned. This walks the whole path against a small in-memory model of
// those tables (the repo's tests use no real Postgres):
//
//   draft composite → publishComposition (enqueues one embed)
//     → the embed consumer indexes it under loadCompositionIndexText
//     → PgVectorProvider.search returns it, matched on its step text.
//
// The model applies the provider's own WHERE clauses: the embedding tenant
// scope (`se.tenant_id IN ($1, 'default')`), the status exclusions, and the
// 4-band visibility rule. It fails loudly if the provider stops emitting
// them, so the tenant and visibility assertions below cannot pass vacuously.
//
// Guarded: a tenant-private composite is found by its own tenant only; a
// public composite's text never names a private step's skill or its summary;
// a composite published without an embed stays invisible.
//
// ══════════════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import type { SqlPool } from '../adapters/sql.js';
import { PgVectorProvider } from '../providers/pgvector-provider.js';
import type { EmbedQueueMessage } from './adapters.js';
import { loadCompositionIndexText } from './index-text.js';
import { publishComposition } from './publish.js';

interface SkillRow {
  id: string;
  name: string;
  slug: string;
  version: string;
  description: string | null;
  agent_summary: string | null;
  status: string;
  skill_type: string;
  workflow_definition: unknown;
  visibility: string;
  tenant_id: string;
}

interface StepRow {
  composition_id: string;
  step_order: number;
  skill_id: string;
  step_name: string | null;
}

const TENANT_SCOPE = "se.tenant_id IN ($1, 'default')";
const DEFAULT_VISIBILITY =
  "(s.visibility = 'public' OR (s.visibility IN ('private', 'tenant_private', 'tenant_internal') AND s.tenant_id = $1))";
const NOT_UNLISTED = "s.visibility <> 'unlisted'";

/** The tables search reads, and composition_steps; answers each query by its shape. */
function memoryDb(skills: SkillRow[], steps: StepRow[]) {
  const byId = new Map(skills.map((s) => [s.id, s]));
  const embeddings = new Map<string, { tenant_id: string; source_text: string }>();

  async function query(sql: string, params: readonly unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> {
    const rows = answer(sql, params);
    return { rows, rowCount: rows.length };
  }

  /** The provider's search WHERE clauses, applied to one embedding row + its skill. */
  function searchFilter(s: string, params: readonly unknown[]) {
    for (const clause of [TENANT_SCOPE, DEFAULT_VISIBILITY, NOT_UNLISTED, 's.status NOT IN (']) {
      if (!s.includes(clause)) throw new Error(`memoryDb: search no longer filters on ${clause}\n${s}`);
    }
    const tenant = params[0] as string;
    const blocked = new Set<unknown>();
    for (const m of s.matchAll(/s\.status NOT IN \(([^)]*)\)/g)) {
      for (const p of m[1]!.split(',')) blocked.add(params[Number(p.trim().slice(1)) - 1]);
    }
    return (e: { tenant_id: string }, k: SkillRow | undefined): k is SkillRow =>
      !!k &&
      (e.tenant_id === tenant || e.tenant_id === 'default') &&
      !blocked.has(k.status) &&
      (k.visibility === 'public' || (['private', 'tenant_private', 'tenant_internal'].includes(k.visibility) && k.tenant_id === tenant)) &&
      k.visibility !== 'unlisted';
  }

  function answer(sql: string, params: readonly unknown[]): unknown[] {
    const s = sql.replace(/\s+/g, ' ');
    // publishComposition: the composition row
    if (s.includes('SELECT id, slug, status, skill_type FROM skills WHERE id = $1')) {
      const r = byId.get(params[0] as string);
      return r ? [{ id: r.id, slug: r.slug, status: r.status, skill_type: r.skill_type }] : [];
    }
    // publishComposition: every step skill must be published
    if (s.includes('SELECT cs.skill_id, s.status, s.name FROM composition_steps cs JOIN skills s')) {
      return steps
        .filter((st) => st.composition_id === params[0])
        .map((st) => ({ skill_id: st.skill_id, status: byId.get(st.skill_id)!.status, name: byId.get(st.skill_id)!.name }));
    }
    if (s.includes("UPDATE skills SET status = 'published'")) {
      const r = byId.get(params[0] as string)!;
      r.status = 'published';
      return [{ id: r.id, slug: r.slug, status: r.status }];
    }
    // loadCompositionIndexText: the composite
    if (s.includes('SELECT name, slug, description, capabilities_required, workflow_definition, visibility, tenant_id FROM skills WHERE id = $1')) {
      const r = byId.get(params[0] as string);
      return r ? [{ ...r, capabilities_required: [] }] : [];
    }
    // loadCompositionIndexText: its steps, with each step skill's audience
    if (s.includes('SELECT cs.step_name, s.slug, s.visibility, s.tenant_id FROM composition_steps cs LEFT JOIN skills s')) {
      return steps
        .filter((st) => st.composition_id === params[0])
        .sort((a, b) => a.step_order - b.step_order)
        .map((st) => {
          const k = byId.get(st.skill_id);
          return { step_name: st.step_name, slug: k?.slug ?? null, visibility: k?.visibility ?? null, tenant_id: k?.tenant_id ?? null };
        });
    }
    // search: vector KNN over skill_embeddings INNER JOIN skills
    if (s.includes('WITH knn AS') && s.includes('FROM skill_embeddings se')) {
      const keep = searchFilter(s, params);
      return [...embeddings.entries()]
        .filter(([id, e]) => keep(e, byId.get(id)))
        .map(([id, e]) => ({ skill_id: id, score: 0.5, match_source: 'agent_summary', match_text: e.source_text, trust_score: '0.5' }));
    }
    // search: keyword full-text over skill_embeddings INNER JOIN skills
    if (s.includes('plainto_tsquery') && s.includes('FROM skill_embeddings se INNER JOIN skills s')) {
      const keep = searchFilter(s, params);
      const q = String(params[params.length - 1]).toLowerCase().split(/\s+/);
      return [...embeddings.entries()]
        .filter(([id, e]) => keep(e, byId.get(id)) && q.every((w) => e.source_text.toLowerCase().includes(w)))
        .map(([id]) => ({ skill_id: id, raw_score: 1, normalized_score: 1, keyword_hits: q.length }));
    }
    // search: metadata for the fused candidates
    if (s.includes('SELECT id, name, slug, version, agent_summary, trust_score,')) {
      const ids = params[0] as string[];
      return ids.map((id) => byId.get(id)!).map((r) => ({
        id: r.id, name: r.name, slug: r.slug, version: r.version, agent_summary: r.agent_summary, trust_score: '0.5',
        execution_layer: 'composite', capabilities_required: [], status: r.status, skill_type: r.skill_type,
        verification_tier: 'scanned', trust_badge: null, forked_from: null, run_count: 0, last_run_at: null,
        revoked_reason: null, remediation_message: null, remediation_url: null, replacement_skill_id: null,
        publisher_key_id: null, signature_verified_at: null, signature_failure_reason: null,
      }));
    }
    throw new Error(`memoryDb: unexpected query\n${s}`);
  }

  // PgVectorProvider.index() writes through a client in a transaction.
  const client = {
    async query(sql: string, params: readonly unknown[] = []) {
      const s = sql.replace(/\s+/g, ' ');
      if (s.startsWith('INSERT INTO skill_embeddings')) {
        embeddings.set(params[0] as string, { tenant_id: params[1] as string, source_text: params[3] as string });
      } else if (s.startsWith('DELETE FROM skill_embeddings')) embeddings.delete(params[0] as string);
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };

  const pool = { query, connect: async () => client } as unknown as SqlPool;
  return { pool, embeddings, byId };
}

const embedding = () => Array.from({ length: 512 }, (_, i) => (i % 7) / 7);

const PRIVATE_SLUG = 'acme/secret-scan';
const PRIVATE_SUMMARY = 'Proprietary detector for acme signing keys.';

function fixtures() {
  const atomic = (id: string, slug: string, summary: string, visibility = 'public', tenant_id = 'default'): SkillRow => ({
    id, name: id, slug, version: '1.0.0', description: null, agent_summary: summary, status: 'published', skill_type: 'atomic',
    workflow_definition: null, visibility, tenant_id,
  });
  const skills: SkillRow[] = [
    atomic('sk_clone', '@cognium/git', 'Clones a repository at a branch.'),
    atomic('sk_scan', '@cognium/cognium-scan', 'Understands a repository: layers, findings and a recovered spec.'),
    atomic('sk_secret', PRIVATE_SLUG, PRIVATE_SUMMARY, 'tenant_private', 'tA'),
    // A public composite (published by tenant A into the public catalog) with one of A's private steps.
    { id: 'cmp_pub', name: 'Connect and understand', slug: '@cognium/wf-connect-understand', version: '0.2.0', description: 'Connect a repository and understand it.', agent_summary: null, status: 'draft', skill_type: 'human-composite', workflow_definition: { steps: [] }, visibility: 'public', tenant_id: 'default' },
    // Tenant A's own composite.
    { id: 'cmp_a', name: 'Acme triage', slug: 'acme/wf-triage', version: '1.0.0', description: 'Triage a repository for leaked keys.', agent_summary: null, status: 'draft', skill_type: 'human-composite', workflow_definition: null, visibility: 'tenant_private', tenant_id: 'tA' },
  ];
  const steps: StepRow[] = [
    { composition_id: 'cmp_pub', step_order: 1, skill_id: 'sk_clone', step_name: 'clone' },
    { composition_id: 'cmp_pub', step_order: 2, skill_id: 'sk_secret', step_name: null },
    { composition_id: 'cmp_pub', step_order: 3, skill_id: 'sk_scan', step_name: 'understand' },
    { composition_id: 'cmp_a', step_order: 1, skill_id: 'sk_clone', step_name: 'clone' },
    { composition_id: 'cmp_a', step_order: 2, skill_id: 'sk_secret', step_name: 'detect' },
  ];
  return memoryDb(skills, steps);
}

/**
 * What an embed consumer does with a message for a composite: index it under
 * `loadCompositionIndexText`, in the composite's own tenant (as the node's
 * `SkillsClient` and the hosted consumer both do: `tenant_id` of the row).
 */
async function consume(pool: SqlPool, byId: Map<string, SkillRow>, msg: EmbedQueueMessage): Promise<void> {
  const row = byId.get(msg.skillId)!;
  const text = await loadCompositionIndexText(pool, msg.skillId);
  await new PgVectorProvider({ pool }).index(
    {
      id: row.id, name: row.name, slug: row.slug, version: row.version, source: 'registry', description: row.description ?? '',
      tags: [], trustScore: 0.5, executionLayer: 'composite', tenantId: row.tenant_id,
    },
    { agentSummary: { text, embedding: embedding() }, embedderIdentity: 'test@512', storedDims: 512 },
  );
}

async function publishAndIndexAll() {
  const db = fixtures();
  const sent: EmbedQueueMessage[] = [];
  const embedQueue = { send: async (m: EmbedQueueMessage) => void sent.push(m), sendBatch: async () => {} };
  await publishComposition('cmp_pub', db.pool, { embedQueue });
  await publishComposition('cmp_a', db.pool, { embedQueue });
  // One embed message per published composite version.
  expect(sent).toEqual([{ skillId: 'cmp_pub', action: 'embed' }, { skillId: 'cmp_a', action: 'embed' }]);
  for (const m of sent) await consume(db.pool, db.byId, m);
  return db;
}

async function search(pool: SqlPool, tenantId: string, query = 'repository') {
  const result = await new PgVectorProvider({ pool }).search(query, embedding(), { tenantId }, { includeMatchText: true });
  return result.results;
}

describe('a published composite is returned by search', () => {
  it('publish → embed enqueued → indexed under its step text → search returns it, on its steps', async () => {
    const { pool, embeddings } = await publishAndIndexAll();
    expect(embeddings.get('cmp_pub')!.source_text).toContain('Composed of skills: @cognium/git, @cognium/cognium-scan.');

    const hit = (await search(pool, 'default', 'understand repository')).find((r) => r.skillId === 'cmp_pub');
    expect(hit).toBeDefined();
    // Found by the keyword path too, on its step text, not only by vector nearness.
    expect(hit!.fullTextScore).toBeGreaterThan(0);
    expect(hit!.matchText).toContain('Runs 3 steps: clone, private step, understand.');
  });

  it('a tenant_private composite is found by its own tenant only — not by another tenant, not anonymously', async () => {
    const { pool } = await publishAndIndexAll();
    const forA = await search(pool, 'tA');
    const forB = await search(pool, 'tB');
    const anonymous = await search(pool, 'default');

    expect(forA.map((r) => r.skillId)).toContain('cmp_a');
    expect(forB.map((r) => r.skillId)).not.toContain('cmp_a');
    expect(anonymous.map((r) => r.skillId)).not.toContain('cmp_a');
    // The public composite is found by everyone.
    for (const results of [forA, forB, anonymous]) expect(results.map((r) => r.skillId)).toContain('cmp_pub');
    // Within its own tenant the composite may name the tenant's private step.
    expect(forA.find((r) => r.skillId === 'cmp_a')!.matchText).toContain(`Composed of skills: @cognium/git, ${PRIVATE_SLUG}.`);
  });

  it('a public composite with a private step returns no private slug or summary, to anyone', async () => {
    const { pool, embeddings } = await publishAndIndexAll();
    const stored = embeddings.get('cmp_pub')!.source_text;
    expect(stored).not.toContain(PRIVATE_SLUG);
    expect(stored).not.toContain('secret-scan');
    expect(stored).not.toContain(PRIVATE_SUMMARY);

    for (const tenant of ['tA', 'tB', 'default']) {
      const hit = (await search(pool, tenant)).find((r) => r.skillId === 'cmp_pub')!;
      expect(hit.matchText).toBeDefined();
      expect(hit.matchText).not.toContain(PRIVATE_SLUG);
      expect(hit.matchText).not.toContain('Proprietary');
      // Nor can the private step be found through the public composite by keyword.
      expect((await search(pool, tenant, 'secret-scan')).map((r) => r.fullTextScore > 0 && r.skillId)).not.toContain('cmp_pub');
      expect((await search(pool, tenant, 'proprietary detector')).map((r) => r.fullTextScore > 0 && r.skillId)).not.toContain('cmp_pub');
    }
  });

  it('the defect: published without an embed, the composite is invisible to search', async () => {
    const { pool } = fixtures();
    await publishComposition('cmp_pub', pool); // no queue: nothing enqueued, no embedding row
    expect((await search(pool, 'default')).find((r) => r.skillId === 'cmp_pub')).toBeUndefined();
  });
});
