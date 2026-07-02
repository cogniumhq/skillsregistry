// ══════════════════════════════════════════════════════════════════════════════
// forkSkill — create a `forked` skill row derived from a published source
// ══════════════════════════════════════════════════════════════════════════════
//
// Ported verbatim from mothership `src/composition/fork.ts` behind the
// `CompositionAdapters` port. Business rules preserved:
//
//   - Only publishable sources can be forked.
//   - Fork inherits trust from `root_source` via `BASE_TRUST` (source
//     provenance floor). Falls back to `0.40` for unknown sources.
//   - `forked_from` stores `slug@version` for lineage traversal.
//   - Composition sources copy their `composition_steps` + composed IDs.
//   - Human vs bot forks bump distinct counters on the source row.
//   - Embed + scan enqueues are best-effort; failure is logged and
//     swallowed so the fork itself always succeeds.
//
// ══════════════════════════════════════════════════════════════════════════════

import { nanoid } from 'nanoid';
import type { ForkResult } from '../types.js';
import { BASE_TRUST } from '../scoring/policy.js';
import type { CompositionAdapters } from './adapters.js';
import { NotFoundError } from './errors.js';

const COMPOSITION_TYPES = [
  'auto-composite',
  'human-composite',
  'composition',
  'pipeline',
];

export async function forkSkill(
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
  const slug = `${s['slug'] as string}-fork-${nanoid(6)}`;

  // v5.0: Trust reset uses root_source for base trust floor
  const rootSource = (s['root_source'] as string | null) ?? (s['source'] as string);
  const trustScore = BASE_TRUST[rootSource] ?? 0.40;

  // v5.0: forked_from stores slug@version reference
  const forkedFrom = `${s['slug'] as string}@${(s['version'] as string | null) ?? '1.0.0'}`;

  const fork = await pool.query<{
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
      forked_from, forked_by, root_source,
      trust_score, capabilities_required,
      source, verification_tier
    ) VALUES (
      $1, $2, '1.0.0', 'forked', 'draft',
      $3, $4, $5, $6,
      $7, $8, $9, $10,
      $11, $12,
      $13, $14, $15,
      $16, $17,
      'direct', 'unverified'
    ) RETURNING id, slug, version, status`,
    [
      `${s['name'] as string} (fork)`,
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
      forkedFrom,
      authorId,
      rootSource,
      trustScore,
      s['capabilities_required'],
    ],
  );

  const forkRow = fork.rows[0]!;

  // If source is a composition, copy its steps and composition_skill_ids
  const sourceType = (s['skill_type'] as string | null) ?? 'atomic';
  if (COMPOSITION_TYPES.includes(sourceType)) {
    await pool.query(
      `INSERT INTO composition_steps (composition_id, step_order, skill_id, step_name, input_mapping, condition, on_error)
       SELECT $1, step_order, skill_id, step_name, input_mapping, condition, on_error
       FROM composition_steps WHERE composition_id = $2`,
      [forkRow.id, sourceId],
    );
    if (s['composition_skill_ids']) {
      await pool.query(
        `UPDATE skills SET composition_skill_ids = $1 WHERE id = $2`,
        [s['composition_skill_ids'], forkRow.id],
      );
    }
  }

  // Increment source fork count based on author type
  if (authorType === 'human') {
    await pool.query(
      `UPDATE skills SET human_fork_count = human_fork_count + 1 WHERE id = $1`,
      [sourceId],
    );
  } else {
    await pool.query(
      `UPDATE skills SET agent_fork_count = agent_fork_count + 1 WHERE id = $1`,
      [sourceId],
    );
  }

  // Enqueue for embedding and security scanning (best-effort)
  try {
    await embedQueue.send({ skillId: forkRow.id, action: 'embed' });
    await scanQueue.send({
      skillId: forkRow.id,
      priority: 'normal',
      timestamp: Date.now(),
    });
  } catch (queueErr) {
    console.error(
      `[FORK] Queue send failed for ${forkRow.id}: ${(queueErr as Error).message}`,
    );
  }

  return {
    id: forkRow.id,
    slug: forkRow.slug,
    version: forkRow.version,
    forkedFrom,
    trustScore,
    status: forkRow.status as ForkResult['status'],
  };
}
