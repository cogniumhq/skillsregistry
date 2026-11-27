// ══════════════════════════════════════════════════════════════════════════════
// Composite search text — the one builder for what a composite is indexed under
// ══════════════════════════════════════════════════════════════════════════════
//
// Search (vector and keyword) reads `skill_embeddings` only, so a skill with
// no embedding row can never be found. Atomic skills are indexed from their
// `agent_summary`; a composite has none, and an LLM summary of its
// description cannot name its steps. A composite is therefore indexed from
// deterministic text built out of what it already carries. No model call.
//
// ONE BUILDER. `buildCompositeSummary` produces the same text, byte for byte,
// as the hosted service's deployed composite builder (same function name,
// same input field names, same output): the description, a fixed workflow
// clause, the step names in order, the distinct step skill slugs with any
// `@version` stripped, and the required capabilities. It lives here so the
// hosted service can import it from this package instead of keeping its own
// copy. `compositeIndexableText` adds the `${name} — ${slug}. ` prefix the
// hosted embed pipeline puts in front of every summary, so the stored
// `source_text` matches as well.
//
// STEP SOURCES. The inline `workflow_definition` DAG (`steps[].id` or
// `name`, `skillRef` or `skillSlug`) when it has steps, else the
// `composition_steps` rows (step name, step skill slug).
//
// PRIVACY. A composite's text is searchable by everyone who can see the
// composite, so it names a step's skill only when that skill is visible to
// the same audience (`isStepVisibleToComposite`): a public skill, or, for a
// tenant-private composite, a private skill of the same tenant. Any other
// step is described by its own step name (part of the composite, written by
// its author) or as "private step", never by the skill's slug. Step skills'
// summaries are never included. `loadCompositionIndexText` applies this.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { SqlPool } from '../adapters/index.js';
import { NotFoundError } from './errors.js';

/** One step as the composite text names it (the hosted service's `CompositeStepInput`). */
export interface CompositeStep {
  /** The step's name (step id / step name, or a generic label). */
  name: string;
  /** The skill the step runs, version-stripped. Absent when not visible to the composite's audience. */
  skillSlug?: string;
}

/** What `buildCompositeSummary` reads (structurally a subset of the hosted service's `SkillInput`). */
export interface CompositeSummaryInput {
  description?: string | null;
  capabilitiesRequired?: readonly string[] | null;
  /** The inline DAG (`{ steps: [...] }`), as stored in `skills.workflow_definition`. */
  workflowDefinition?: unknown;
  /** Steps from `composition_steps`, used when the DAG has none. */
  compositionSteps?: readonly CompositeStep[];
}

/** The label of a step whose skill is not visible to the composite's audience and has no step name. */
export const PRIVATE_STEP_LABEL = 'private step';

/**
 * Strip a trailing `@version` from a skill ref. `cognium-git@1.0.2` →
 * `cognium-git`; scoped refs keep their leading `@`: `@cognium/git@1.0.2` →
 * `@cognium/git`.
 */
export function stripVersion(ref: string): string {
  const at = ref.lastIndexOf('@');
  if (at <= 0) return ref;
  return ref.slice(0, at);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** A DAG step before its label falls back to the ref: what the author named it, and what it runs. */
interface RawWorkflowStep {
  label?: string;
  ref?: string;
}

function rawWorkflowSteps(workflowDefinition: unknown): RawWorkflowStep[] {
  let def = workflowDefinition;
  if (typeof def === 'string') {
    try {
      def = JSON.parse(def);
    } catch {
      return [];
    }
  }
  const rawSteps = asRecord(def)?.['steps'];
  if (!Array.isArray(rawSteps)) return [];
  const steps: RawWorkflowStep[] = [];
  for (const raw of rawSteps) {
    const step = asRecord(raw);
    if (!step) continue;
    const label = asNonEmptyString(step['id']) ?? asNonEmptyString(step['name']);
    const ref = asNonEmptyString(step['skillRef']) ?? asNonEmptyString(step['skillSlug']);
    if (!label && !ref) continue;
    steps.push({ label, ref });
  }
  return steps;
}

/**
 * The ordered steps of an inline `workflow_definition` DAG. Defensive: the
 * column is untyped jsonb, so a malformed definition yields [] rather than
 * throwing inside an embed consumer. This does no visibility filtering;
 * `loadCompositionIndexText` does.
 */
export function extractWorkflowSteps(workflowDefinition: unknown): CompositeStep[] {
  return rawWorkflowSteps(workflowDefinition).map(({ label, ref }) => ({
    name: label ?? ref!,
    skillSlug: ref ? stripVersion(ref) : undefined,
  }));
}

/** The composite's steps: the inline DAG when it has any, else `compositionSteps`. */
export function resolveCompositeSteps(input: CompositeSummaryInput): CompositeStep[] {
  const fromWorkflow = extractWorkflowSteps(input.workflowDefinition);
  if (fromWorkflow.length > 0) return fromWorkflow;
  return [...(input.compositionSteps ?? [])];
}

/**
 * The searchable body of a composite (pure, deterministic). Never empty: a
 * composite with no readable steps and no description still yields the
 * workflow clause.
 *
 * It renders whatever steps it is given; callers indexing a composite read
 * them through `loadCompositionIndexText`, which hides step skills the
 * composite's audience cannot see.
 */
export function buildCompositeSummary(input: CompositeSummaryInput): string {
  const steps = resolveCompositeSteps(input);
  const parts: string[] = [];

  const description = input.description?.trim();
  if (description) {
    parts.push(description.endsWith('.') ? description : `${description}.`);
  }
  parts.push('Use this workflow to run a multi-step composition of skills.');

  if (steps.length > 0) {
    parts.push(`Runs ${steps.length} step${steps.length === 1 ? '' : 's'}: ${steps.map((s) => s.name).join(', ')}.`);
    // Deduped, order-preserving: one skill often serves several steps.
    const slugs = Array.from(new Set(steps.map((s) => s.skillSlug).filter((s): s is string => !!s)));
    if (slugs.length > 0) parts.push(`Composed of skills: ${slugs.join(', ')}.`);
  }

  if (input.capabilitiesRequired?.length) {
    parts.push(`Requires ${input.capabilitiesRequired.join(', ')} capabilities.`);
  }

  return parts.join(' ');
}

/** The full text stored and embedded for a composite: the `${name} — ${slug}. ` prefix, then the body. */
export function compositeIndexableText(name: string, slug: string, body: string): string {
  return `${name} — ${slug}. ${body}`;
}

/** Who can see a skill: its visibility band and owning tenant. */
export interface SkillAudience {
  visibility: string | null;
  tenantId: string | null;
}

/**
 * Whether a step skill may be named in a composite's searchable text: it must
 * be visible to everyone who can see the composite. A public skill always is.
 * For a composite that is itself tenant-scoped (`private` / `tenant_private`
 * / `tenant_internal`), a `private` or `tenant_private` skill of the same
 * tenant is too. Everything else is not: any non-public skill under a public
 * or unlisted composite, another tenant's skill, a `tenant_internal` or
 * `unlisted` skill (narrower than its tenant), and any row with no tenant.
 */
export function isStepVisibleToComposite(composite: SkillAudience, step: SkillAudience): boolean {
  if (step.visibility === 'public') return true;
  const compositeTenantScoped =
    composite.visibility === 'private' ||
    composite.visibility === 'tenant_private' ||
    composite.visibility === 'tenant_internal';
  if (!compositeTenantScoped) return false;
  if (!composite.tenantId || step.tenantId !== composite.tenantId) return false;
  return step.visibility === 'private' || step.visibility === 'tenant_private';
}

/**
 * Read a composite's indexable text from the database, with step skills its
 * audience cannot see described generically. A DAG step's ref is named only
 * when it resolves (by version-stripped slug) to a skill visible to the
 * composite's audience; an unresolved ref is treated as not visible.
 */
export async function loadCompositionIndexText(pool: SqlPool, compositionId: string): Promise<string> {
  const result = await pool.query<{
    name: string;
    slug: string;
    description: string | null;
    capabilities_required: string[] | null;
    workflow_definition: unknown;
    visibility: string | null;
    tenant_id: string | null;
  }>(
    `SELECT name, slug, description, capabilities_required, workflow_definition, visibility, tenant_id
     FROM skills WHERE id = $1`,
    [compositionId],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError(`Composition ${compositionId} not found`);
  const composite: SkillAudience = { visibility: row.visibility, tenantId: row.tenant_id };

  let steps: CompositeStep[];
  const dag = rawWorkflowSteps(row.workflow_definition);
  if (dag.length > 0) {
    const slugs = Array.from(new Set(dag.flatMap((s) => (s.ref ? [stripVersion(s.ref)] : []))));
    const visible = new Set<string>();
    if (slugs.length > 0) {
      const refs = await pool.query<{ slug: string; visibility: string | null; tenant_id: string | null }>(
        `SELECT slug, visibility, tenant_id FROM skills WHERE slug = ANY($1::text[])`,
        [slugs],
      );
      for (const r of refs.rows) {
        if (isStepVisibleToComposite(composite, { visibility: r.visibility, tenantId: r.tenant_id })) visible.add(r.slug);
      }
    }
    steps = dag.map(({ label, ref }) => {
      const slug = ref ? stripVersion(ref) : undefined;
      if (slug && visible.has(slug)) return { name: label ?? ref!, skillSlug: slug };
      return { name: label ?? PRIVATE_STEP_LABEL };
    });
  } else {
    const rows = await pool.query<{
      step_name: string | null;
      slug: string | null;
      visibility: string | null;
      tenant_id: string | null;
    }>(
      `SELECT cs.step_name, s.slug, s.visibility, s.tenant_id
       FROM composition_steps cs
       LEFT JOIN skills s ON s.id = cs.skill_id
       WHERE cs.composition_id = $1
       ORDER BY cs.step_order`,
      [compositionId],
    );
    steps = rows.rows.flatMap((r): CompositeStep[] => {
      const stepName = asNonEmptyString(r.step_name);
      if (r.slug && isStepVisibleToComposite(composite, { visibility: r.visibility, tenantId: r.tenant_id })) {
        return [{ name: stepName ?? r.slug, skillSlug: r.slug }];
      }
      if (!r.slug && !stepName) return []; // a dangling row with nothing to name
      return [{ name: stepName ?? PRIVATE_STEP_LABEL }];
    });
  }

  const body = buildCompositeSummary({
    description: row.description,
    capabilitiesRequired: row.capabilities_required,
    compositionSteps: steps,
  });
  return compositeIndexableText(row.name, row.slug, body);
}
