// ══════════════════════════════════════════════════════════════════════════════
// extendComposition — fork a published composition and append new steps
// ══════════════════════════════════════════════════════════════════════════════
//
// Ported verbatim from mothership `src/composition/extend.ts`. Business
// flow:
//
//   1. Verify source is a composition-type skill in `published` state.
//   2. Validate every new step's skill is also published.
//   3. Fork the source (delegates to `forkSkill` — inherits trust reset).
//   4. Append new steps at the end (preserving existing step order).
//   5. Recompute trust_score = min(all step trusts) + union capabilities.
//
// The trust recompute here does NOT apply the 0.9 composition penalty —
// mothership behavior preserved (extend keeps the fork's initial trust
// as the ceiling; per-step MIN is the correction).
//
// ══════════════════════════════════════════════════════════════════════════════

import type { ForkResult } from '../types.js';
import type { CompositionAdapters } from './adapters.js';
import type { ExtendInput } from './schema.js';
import { forkSkill } from './fork.js';
import { NotFoundError, ValidationError } from './errors.js';

const COMPOSITION_TYPES = [
  'auto-composite',
  'human-composite',
  'composition',
  'pipeline',
];

export async function extendComposition(
  compositionId: string,
  newSteps: ExtendInput['steps'],
  authorId: string,
  authorType: 'human' | 'bot',
  adapters: CompositionAdapters,
): Promise<ForkResult> {
  const { pool } = adapters;

  // Verify source is a composition/pipeline
  const source = await pool.query<{ skill_type: string }>(
    `SELECT skill_type FROM skills WHERE id = $1 AND status = 'published'`,
    [compositionId],
  );

  if (!source.rows[0]) {
    throw new NotFoundError(`Composition ${compositionId} not found or not published`);
  }

  if (!COMPOSITION_TYPES.includes(source.rows[0].skill_type)) {
    throw new ValidationError(`Skill ${compositionId} is not a composition`);
  }

  // Validate new step skill IDs exist and are published
  const newSkillIds = newSteps.map((s) => s.skillId);
  const skills = await pool.query<{ id: string }>(
    `SELECT id FROM skills WHERE id = ANY($1::uuid[]) AND status = 'published'`,
    [newSkillIds],
  );

  if (skills.rows.length !== newSkillIds.length) {
    const foundIds = new Set(skills.rows.map((r) => r.id));
    const missing = newSkillIds.filter((id) => !foundIds.has(id));
    throw new ValidationError(`Skills not found or not published: ${missing.join(', ')}`);
  }

  // Fork the composition first
  const fork = await forkSkill(compositionId, authorId, authorType, adapters);

  // Get current max step_order
  const maxOrder = await pool.query<{ max_order: number }>(
    `SELECT COALESCE(MAX(step_order), 0) AS max_order
     FROM composition_steps WHERE composition_id = $1`,
    [fork.id],
  );

  let nextOrder = (maxOrder.rows[0]?.max_order ?? 0) + 1;

  // Append new steps
  for (const step of newSteps) {
    await pool.query(
      `INSERT INTO composition_steps (
        composition_id, step_order, skill_id, step_name, input_mapping, on_error
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        fork.id,
        nextOrder++,
        step.skillId,
        step.stepName || null,
        step.inputMapping ? JSON.stringify(step.inputMapping) : null,
        step.onError || 'fail',
      ],
    );
  }

  // Recompute trust_score and capabilities_required on the fork
  const allSteps = await pool.query<{
    trust_score: string | number;
    capabilities_required: string[] | null;
  }>(
    `SELECT s.trust_score, s.capabilities_required
     FROM composition_steps cs
     JOIN skills s ON s.id = cs.skill_id
     WHERE cs.composition_id = $1`,
    [fork.id],
  );

  const trustScore = Math.min(
    ...allSteps.rows.map((r) => parseFloat(String(r.trust_score)) || 0),
  );

  const capabilitiesSet = new Set<string>();
  for (const row of allSteps.rows) {
    if (row.capabilities_required) {
      for (const cap of row.capabilities_required) {
        capabilitiesSet.add(cap);
      }
    }
  }

  await pool.query(
    `UPDATE skills SET trust_score = $1, capabilities_required = $2 WHERE id = $3`,
    [trustScore, Array.from(capabilitiesSet), fork.id],
  );

  return fork;
}
