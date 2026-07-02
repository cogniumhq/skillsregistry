// ══════════════════════════════════════════════════════════════════════════════
// copySkill — clone a published skill with a fresh identity, no lineage
// ══════════════════════════════════════════════════════════════════════════════
//
// Ported verbatim from mothership `src/composition/copy.ts`. Distinct from
// `forkSkill`:
//
//   - No lineage: `forked_from` stays NULL; the copy starts fresh.
//   - Trust resets to a hard `0.5` (not source-provenance-based).
//   - Only humans bump the source's `human_copy_count`; bot copies are
//     recorded silently for velocity metrics elsewhere.
//   - Composition sources still get their `composition_steps` copied.
//
// ══════════════════════════════════════════════════════════════════════════════

import { nanoid } from 'nanoid';
import type { ForkResult } from '../types.js';
import type { CompositionAdapters } from './adapters.js';
import { NotFoundError } from './errors.js';

const COMPOSITION_TYPES = [
  'auto-composite',
  'human-composite',
  'composition',
  'pipeline',
];

export async function copySkill(
  sourceId: string,
  authorId: string,
  authorType: 'human' | 'bot',
  adapters: CompositionAdapters,
): Promise<ForkResult> {
  const { pool, embedQueue, scanQueue } = adapters;

  const source = await pool.query(
    `SELECT * FROM skills WHERE id = $1 AND status = 'published'`,
    [sourceId],
  );

  if (!source.rows[0]) {
    throw new NotFoundError(`Skill ${sourceId} not found or not published`);
  }

  const s = source.rows[0] as Record<string, unknown>;
  const slug = `${s['slug'] as string}-copy-${nanoid(6)}`;

  const copy = await pool.query<{
    id: string;
    slug: string;
    version: string;
    status: string;
  }>(
    `INSERT INTO skills (
      name, slug, version, skill_type, status,
      description, readme, schema_json, execution_layer,
      tags, categories, ecosystem, license,
      author_id, author_type,
      trust_score, capabilities_required,
      source, verification_tier
    ) VALUES (
      $1, $2, '1.0.0', 'atomic', 'draft',
      $3, $4, $5, $6,
      $7, $8, $9, $10,
      $11, $12,
      0.5, $13,
      'direct', 'unverified'
    ) RETURNING id, slug, version, status`,
    [
      `${s['name'] as string} (copy)`,
      slug,
      s['description'],
      s['readme'],
      s['schema_json'] ? JSON.stringify(s['schema_json']) : null,
      s['execution_layer'],
      s['tags'],
      s['categories'],
      s['ecosystem'],
      s['license'],
      authorId,
      authorType,
      s['capabilities_required'],
    ],
  );

  const copyRow = copy.rows[0]!;

  // Copy composition steps if source is a composition
  const sourceType = (s['skill_type'] as string | null) ?? 'atomic';
  if (COMPOSITION_TYPES.includes(sourceType)) {
    await pool.query(
      `INSERT INTO composition_steps (composition_id, step_order, skill_id, step_name, input_mapping, condition, on_error)
       SELECT $1, step_order, skill_id, step_name, input_mapping, condition, on_error
       FROM composition_steps WHERE composition_id = $2`,
      [copyRow.id, sourceId],
    );
  }

  // Increment human_copy_count on source (human action only)
  if (authorType === 'human') {
    await pool.query(
      `UPDATE skills SET human_copy_count = human_copy_count + 1 WHERE id = $1`,
      [sourceId],
    );
  }

  // Enqueue for embedding and security scanning (best-effort)
  try {
    await embedQueue.send({ skillId: copyRow.id, action: 'embed' });
    await scanQueue.send({
      skillId: copyRow.id,
      priority: 'normal',
      timestamp: Date.now(),
    });
  } catch (queueErr) {
    console.error(
      `[COPY] Queue send failed for ${copyRow.id}: ${(queueErr as Error).message}`,
    );
  }

  return {
    id: copyRow.id,
    slug: copyRow.slug,
    version: copyRow.version,
    forkedFrom: '', // copy has no lineage
    trustScore: 0.5,
    status: copyRow.status as ForkResult['status'],
  };
}
