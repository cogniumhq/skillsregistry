// ══════════════════════════════════════════════════════════════════════════════
// Composition index text — what a composite is embedded and searched by
// ══════════════════════════════════════════════════════════════════════════════
//
// Search (vector and keyword) reads `skill_embeddings` only, so a skill with
// no embedding row can never be found. Atomic skills are indexed from their
// `agent_summary`; a composite has none, and an LLM summary of its
// description cannot name its steps. A composite is therefore indexed from
// deterministic text built out of what it already carries:
//
//   - its name and description;
//   - one line per step, in order: the step's name or id, the skill it runs
//     (slug), and that skill's own one-line summary when it is known.
//
// Steps come from `composition_steps` (joined to the step skills) and, when
// the row has none, from the inline `workflow_definition` DAG (`steps[].id`,
// `skillRef`, `title`, `description`). No model call at ingest.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { SqlPool } from '../adapters/index.js';
import { NotFoundError } from './errors.js';

/** One step as the index text names it. */
export interface CompositionIndexStep {
  /** The step's own name (or id). */
  name: string | null;
  /** The skill the step runs: a slug, `slug@version`, or a dynamic query. */
  skill: string | null;
  /** The step skill's one-line summary, when known. */
  summary: string | null;
}

/** What the index text is built from. */
export interface CompositionIndexInput {
  name: string;
  description: string | null;
  steps: readonly CompositionIndexStep[];
}

/** Upper bound on the text, well inside any embedder's input window. */
export const COMPOSITION_INDEX_TEXT_MAX = 4000;

/** The first sentence (or line) of a summary, trimmed to keep each step on one short line. */
function firstSentence(text: string | null | undefined, max = 160): string | null {
  if (!text) return null;
  const line = text.replace(/\s+/g, ' ').trim();
  if (!line) return null;
  const end = line.search(/[.!?](\s|$)/);
  const sentence = end >= 0 ? line.slice(0, end + 1) : line;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

/**
 * The text a composite is embedded under (pure, deterministic): its name,
 * its description, then its steps in order.
 */
export function compositionIndexText(input: CompositionIndexInput): string {
  const lines: string[] = [input.name.trim()];
  const description = input.description?.replace(/\s+/g, ' ').trim();
  if (description) lines.push(description);
  if (input.steps.length > 0) {
    lines.push(`Steps (${input.steps.length}):`);
    input.steps.forEach((step, i) => {
      const parts = [step.name?.trim(), step.skill?.trim() ? `runs ${step.skill.trim()}` : null, firstSentence(step.summary)]
        .filter((p): p is string => !!p);
      lines.push(`${i + 1}. ${parts.join(' — ') || 'step'}`);
    });
  }
  const text = lines.join('\n');
  return text.length > COMPOSITION_INDEX_TEXT_MAX ? text.slice(0, COMPOSITION_INDEX_TEXT_MAX) : text;
}

/** The steps of an inline `workflow_definition` DAG, as the index text names them. */
export function stepsOfWorkflowDefinition(definition: unknown): CompositionIndexStep[] {
  const raw = typeof definition === 'string' ? safeParse(definition) : definition;
  const steps = (raw as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((s): CompositionIndexStep[] => {
    if (!s || typeof s !== 'object') return [];
    const step = s as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
    return [{ name: str(step['title']) ?? str(step['id']), skill: str(step['skillRef']), summary: str(step['description']) }];
  });
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Read a composite's index text from the database: the skill row, its
 * `composition_steps` with each step skill's slug and summary, or the inline
 * DAG's steps when it has no step rows.
 */
export async function loadCompositionIndexText(pool: SqlPool, compositionId: string): Promise<string> {
  const skill = await pool.query<{ name: string; description: string | null; workflow_definition: unknown }>(
    `SELECT name, description, workflow_definition FROM skills WHERE id = $1`,
    [compositionId],
  );
  const row = skill.rows[0];
  if (!row) throw new NotFoundError(`Composition ${compositionId} not found`);
  const steps = await pool.query<{
    step_name: string | null;
    slug: string | null;
    agent_summary: string | null;
    description: string | null;
  }>(
    `SELECT cs.step_name, s.slug, s.agent_summary, s.description
     FROM composition_steps cs
     LEFT JOIN skills s ON s.id = cs.skill_id
     WHERE cs.composition_id = $1
     ORDER BY cs.step_order`,
    [compositionId],
  );
  const fromRows: CompositionIndexStep[] = steps.rows.map((r) => ({
    name: r.step_name,
    skill: r.slug,
    summary: r.agent_summary ?? r.description,
  }));
  return compositionIndexText({
    name: row.name,
    description: row.description,
    steps: fromRows.length > 0 ? fromRows : stepsOfWorkflowDefinition(row.workflow_definition),
  });
}
