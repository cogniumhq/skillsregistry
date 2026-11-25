// ══════════════════════════════════════════════════════════════════════════════
// publishComposition — transition a draft composition to published
// ══════════════════════════════════════════════════════════════════════════════
//
// Ported verbatim from mothership `src/composition/publish.ts`. Guards:
//
//   - Composition must exist and be a composition-type skill.
//   - Composition must be in `draft` (not already published/archived/etc).
//   - Every step's target skill must still be `published` — publishing a
//     composition that points at a revoked step would ship a broken plan.
//
// Once published, the composition is enqueued for embedding when the caller
// passes its embed queue (best-effort, as in fork/copy/compose). Search reads
// `skill_embeddings` only, so a composition published without an embed is
// invisible to it. The queue is optional so existing callers keep compiling;
// every publishing caller should pass it, and should then not enqueue its own
// embed after the call: this is the one embed message per publish.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { QueueAdapter, SqlPool } from '../adapters/index.js';
import type { EmbedQueueMessage } from './adapters.js';
import { NotFoundError, ValidationError } from './errors.js';
import { isCompositeSkillType } from './skill-types.js';

export async function publishComposition(
  compositionId: string,
  pool: SqlPool,
  adapters: { embedQueue?: QueueAdapter<EmbedQueueMessage> } = {},
): Promise<{ id: string; slug: string; status: string }> {
  // Verify skill exists and is a draft composition/pipeline
  const skill = await pool.query<{
    id: string;
    slug: string;
    status: string;
    skill_type: string;
  }>(
    `SELECT id, slug, status, skill_type FROM skills WHERE id = $1`,
    [compositionId],
  );

  if (!skill.rows[0]) {
    throw new NotFoundError(`Composition ${compositionId} not found`);
  }

  if (!isCompositeSkillType(skill.rows[0].skill_type)) {
    throw new ValidationError(`Skill ${compositionId} is not a composition`);
  }

  if (skill.rows[0].status !== 'draft') {
    throw new ValidationError(
      `Composition ${compositionId} is in '${skill.rows[0].status}' state, expected 'draft'`,
    );
  }

  // Validate all steps still point to published skills
  const steps = await pool.query<{
    skill_id: string;
    status: string;
    name: string;
  }>(
    `SELECT cs.skill_id, s.status, s.name
     FROM composition_steps cs
     JOIN skills s ON s.id = cs.skill_id
     WHERE cs.composition_id = $1`,
    [compositionId],
  );

  const unpublished = steps.rows.filter((r) => r.status !== 'published');
  if (unpublished.length > 0) {
    const details = unpublished.map((r) => `${r.name} (${r.status})`).join(', ');
    throw new ValidationError(
      `Cannot publish: the following step skills are not published: ${details}`,
    );
  }

  // Transition to published
  const result = await pool.query<{ id: string; slug: string; status: string }>(
    `UPDATE skills
     SET status = 'published', published_at = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING id, slug, status`,
    [compositionId],
  );

  const row = result.rows[0]!;

  // Embed it now that it is published (best-effort: a failed enqueue is
  // logged, and the backfill job finds it later).
  if (adapters.embedQueue) {
    try {
      await adapters.embedQueue.send({ skillId: row.id, action: 'embed' });
    } catch (err) {
      console.error(`publishComposition: embed enqueue failed for ${row.id}`, err);
    }
  }

  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
  };
}
