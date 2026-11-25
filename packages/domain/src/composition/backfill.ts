// ══════════════════════════════════════════════════════════════════════════════
// Composition embed backfill — one-time repair for composites never embedded
// ══════════════════════════════════════════════════════════════════════════════
//
// Before composites were enqueued for embedding on every publish path, a
// published composite could end up with no `skill_embeddings` row, which makes
// it invisible to both search paths (they join on `skill_embeddings`). This
// finds those rows and enqueues one embed each, through the same queue the
// publish paths use; the embed consumer indexes each under
// `loadCompositionIndexText`.
//
// Idempotent: a composite that already has an embedding row is never listed,
// and the embed consumer replaces a skill's rows rather than adding to them.
// Run it as a job (an admin route or a script with the node's queue); dry run
// first. Nothing here runs it.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { QueueAdapter, SqlPool } from '../adapters/index.js';
import type { EmbedQueueMessage } from './adapters.js';
import { COMPOSITION_SKILL_TYPES } from './skill-types.js';

/** A published composite with no embedding row. */
export interface UnembeddedComposition {
  id: string;
  slug: string;
  version: string;
  skillType: string;
}

/** Published composites with no `skill_embeddings` row, oldest first. */
export async function findUnembeddedCompositions(
  pool: SqlPool,
  opts: { limit?: number } = {},
): Promise<UnembeddedComposition[]> {
  const result = await pool.query<{ id: string; slug: string; version: string; skill_type: string }>(
    `SELECT s.id, s.slug, s.version, s.skill_type
     FROM skills s
     WHERE s.status = 'published'
       AND s.skill_type = ANY($1::text[])
       AND NOT EXISTS (SELECT 1 FROM skill_embeddings se WHERE se.skill_id = s.id)
     ORDER BY s.created_at
     LIMIT $2`,
    [[...COMPOSITION_SKILL_TYPES], opts.limit ?? 1000],
  );
  return result.rows.map((r) => ({ id: r.id, slug: r.slug, version: r.version, skillType: r.skill_type }));
}

/**
 * Enqueue one embed per published composite with no embedding row. With
 * `dryRun` (the default) it only lists them. Returns what it found and how
 * many it enqueued.
 */
export async function enqueueCompositionEmbedBackfill(
  pool: SqlPool,
  embedQueue: QueueAdapter<EmbedQueueMessage>,
  opts: { dryRun?: boolean; limit?: number } = {},
): Promise<{ found: UnembeddedComposition[]; enqueued: number }> {
  const found = await findUnembeddedCompositions(pool, { limit: opts.limit });
  if (opts.dryRun ?? true) return { found, enqueued: 0 };
  let enqueued = 0;
  for (const c of found) {
    await embedQueue.send({ skillId: c.id, action: 'embed' });
    enqueued += 1;
  }
  return { found, enqueued };
}
