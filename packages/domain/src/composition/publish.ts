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
// ══════════════════════════════════════════════════════════════════════════════

import type { SqlPool } from '../adapters/index.js';
import { NotFoundError, ValidationError } from './errors.js';

const COMPOSITION_TYPES = [
  'auto-composite',
  'human-composite',
  'composition',
  'pipeline',
];

export async function publishComposition(
  compositionId: string,
  pool: SqlPool,
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

  if (!COMPOSITION_TYPES.includes(skill.rows[0].skill_type)) {
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
  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
  };
}
