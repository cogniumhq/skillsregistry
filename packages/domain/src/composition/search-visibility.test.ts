// ══════════════════════════════════════════════════════════════════════════════
// A published composite is returned by search
// ══════════════════════════════════════════════════════════════════════════════
//
// Both search paths read `skill_embeddings` (vector KNN, then keyword
// full-text) and join `skills`; a skill with no embedding row is never
// returned. This walks the whole path against a small in-memory model of
// those two tables (the repo's tests use no real Postgres):
//
//   draft composite → publishComposition (enqueues an embed)
//     → the embed consumer indexes it under loadCompositionIndexText
//     → PgVectorProvider.search returns it, matched on its step text.
//
// And the defect it guards: a composite published without an embed stays
// invisible to search.
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
}

/** The two tables search reads, and composition_steps; answers each query by its shape. */
function memoryDb(skills: SkillRow[], steps: Array<{ composition_id: string; step_order: number; skill_id: string; step_name: string | null }>) {
  const byId = new Map(skills.map((s) => [s.id, s]));
  const embeddings = new Map<string, { source_text: string }>();

  async function query(sql: string, params: readonly unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> {
    const rows = answer(sql, params);
    return { rows, rowCount: rows.length };
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
    // loadCompositionIndexText
    if (s.includes('SELECT name, description, workflow_definition FROM skills WHERE id = $1')) {
      const r = byId.get(params[0] as string);
      return r ? [{ name: r.name, description: r.description, workflow_definition: r.workflow_definition }] : [];
    }
    if (s.includes('SELECT cs.step_name, s.slug, s.agent_summary, s.description FROM composition_steps cs LEFT JOIN skills s')) {
      return steps
        .filter((st) => st.composition_id === params[0])
        .sort((a, b) => a.step_order - b.step_order)
        .map((st) => {
          const k = byId.get(st.skill_id);
          return { step_name: st.step_name, slug: k?.slug ?? null, agent_summary: k?.agent_summary ?? null, description: k?.description ?? null };
        });
    }
    // search: vector KNN over skill_embeddings INNER JOIN skills (published only here)
    if (s.includes('WITH knn AS') && s.includes('FROM skill_embeddings se')) {
      return [...embeddings.entries()]
        .filter(([id]) => byId.get(id)?.status === 'published')
        .map(([id, e]) => ({ skill_id: id, score: 0.5, match_source: 'agent_summary', match_text: e.source_text, trust_score: '0.5' }));
    }
    // search: keyword full-text over skill_embeddings INNER JOIN skills
    if (s.includes('plainto_tsquery') && s.includes('FROM skill_embeddings se INNER JOIN skills s')) {
      const q = String(params[params.length - 1]).toLowerCase().split(/\s+/);
      return [...embeddings.entries()]
        .filter(([id, e]) => byId.get(id)?.status === 'published' && q.every((w) => e.source_text.toLowerCase().includes(w)))
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
      if (s.startsWith('INSERT INTO skill_embeddings')) embeddings.set(params[0] as string, { source_text: params[3] as string });
      else if (s.startsWith('DELETE FROM skill_embeddings')) embeddings.delete(params[0] as string);
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };

  const pool = { query, connect: async () => client } as unknown as SqlPool;
  return { pool, embeddings };
}

const embedding = () => Array.from({ length: 512 }, (_, i) => (i % 7) / 7);

function fixtures() {
  const skills: SkillRow[] = [
    { id: 'sk_clone', name: 'Git clone', slug: '@cognium/git', version: '1.0.0', description: null, agent_summary: 'Clones a repository at a branch.', status: 'published', skill_type: 'atomic', workflow_definition: null },
    { id: 'sk_scan', name: 'Scan', slug: '@cognium/cognium-scan', version: '1.0.1', description: null, agent_summary: 'Understands a repository: layers, findings and a recovered spec.', status: 'published', skill_type: 'atomic', workflow_definition: null },
    { id: 'cmp_1', name: 'Connect and understand', slug: '@cognium/wf-connect-understand', version: '0.2.0', description: 'Connect a repository and understand it.', agent_summary: null, status: 'draft', skill_type: 'human-composite', workflow_definition: { steps: [] } },
  ];
  const steps = [
    { composition_id: 'cmp_1', step_order: 1, skill_id: 'sk_clone', step_name: 'clone' },
    { composition_id: 'cmp_1', step_order: 2, skill_id: 'sk_scan', step_name: 'understand' },
  ];
  return memoryDb(skills, steps);
}

/** What a node's embed consumer does with a message for a composite: index it under its index text. */
async function consume(pool: SqlPool, msg: EmbedQueueMessage): Promise<void> {
  const text = await loadCompositionIndexText(pool, msg.skillId);
  await new PgVectorProvider({ pool }).index(
    {
      id: msg.skillId, name: 'Connect and understand', slug: '@cognium/wf-connect-understand', version: '0.2.0',
      source: 'registry', description: 'Connect a repository and understand it.', agentSummary: text, tags: [],
      trustScore: 0.5, executionLayer: 'composite', tenantId: 'public',
    },
    { agentSummary: { text, embedding: embedding() }, embedderIdentity: 'test@512', storedDims: 512 },
  );
}

describe('a published composite is returned by search', () => {
  it('publish → embed enqueued → indexed under its step text → search returns it', async () => {
    const { pool, embeddings } = fixtures();
    const sent: EmbedQueueMessage[] = [];
    await publishComposition('cmp_1', pool, { embedQueue: { send: async (m) => void sent.push(m) } });
    expect(sent).toEqual([{ skillId: 'cmp_1', action: 'embed' }]);

    for (const m of sent) await consume(pool, m);
    expect(embeddings.get('cmp_1')!.source_text).toContain('runs @cognium/cognium-scan');

    const result = await new PgVectorProvider({ pool }).search('understand repository', embedding(), { tenantId: 'public' }, { includeMatchText: true });
    const hit = result.results.find((r) => r.skillId === 'cmp_1');
    expect(hit).toBeDefined();
    // Found by the keyword path too, on its step text, not only by vector nearness.
    expect(hit!.fullTextScore).toBeGreaterThan(0);
    expect(hit!.matchText).toContain('understand — runs @cognium/cognium-scan');
  });

  it('the defect: published without an embed, the composite is invisible to search', async () => {
    const { pool } = fixtures();
    await publishComposition('cmp_1', pool); // no queue: nothing enqueued, no embedding row
    const result = await new PgVectorProvider({ pool }).search('understand repository', embedding(), { tenantId: 'public' });
    expect(result.results.find((r) => r.skillId === 'cmp_1')).toBeUndefined();
  });
});
