// ══════════════════════════════════════════════════════════════════════════════
// Composition skill types — the one list every composition guard uses
// ══════════════════════════════════════════════════════════════════════════════
//
// A skill of one of these types is a composition (it runs other skills as
// steps) rather than an atomic skill. publish / extend / fork / copy /
// get-composition / the embed backfill / the composite search text all guard
// on this list; keep it here only.
//
// ══════════════════════════════════════════════════════════════════════════════

/** The composition skill types. */
export const COMPOSITION_SKILL_TYPES = ['auto-composite', 'human-composite', 'composition', 'pipeline'] as const;

export type CompositionSkillType = (typeof COMPOSITION_SKILL_TYPES)[number];

const COMPOSITION_TYPE_SET: ReadonlySet<string> = new Set(COMPOSITION_SKILL_TYPES);

/** Whether `skillType` is a composition type. */
export function isCompositeSkillType(skillType: string | null | undefined): skillType is CompositionSkillType {
  return skillType != null && COMPOSITION_TYPE_SET.has(skillType);
}
