---
"@skillsregistry/domain": minor
---

Composites are embedded, so search can find them.

- `publishComposition(id, pool, { embedQueue })` enqueues the published composition for embedding. The queue argument is optional, so existing callers still compile, but every publishing caller should pass it: search reads `skill_embeddings` only.
- `extendComposition` sends exactly one embed message per extend, after the new steps are in. It calls `forkSkill` with the new `{ enqueueEmbed: false }` option, so the fork is not embedded from its shorter, pre-extension step list. `forkSkill` still enqueues by default.
- **Callers must drop their own post-call embed enqueue** after `publishComposition` (when they pass `embedQueue`) and after `extendComposition`. Each now sends the one embed message for that composite version, and an extra enqueue in the route only duplicates the work.
- New `buildCompositeSummary` / `loadCompositionIndexText`: the one composite search-text builder. Its output matches the hosted service's deployed composite text byte for byte: the description, a workflow clause, the step names in order, the distinct step skill slugs with any `@version` stripped, and the required capabilities. `compositeIndexableText` adds the `name — slug. ` prefix. Steps come from the inline `workflow_definition` DAG, or from `composition_steps` when the DAG has none. No model call. An embed consumer should index a composite under `loadCompositionIndexText(pool, id)`.
- Privacy: `loadCompositionIndexText` names a step's skill only when that skill is visible to the composite's audience (`isStepVisibleToComposite`). That means a public skill, or, for a tenant-private composite, a private skill of the same tenant. Any other step is listed by its own step name, or as "private step". Step skills' summaries are never included.
- `COMPOSITION_SKILL_TYPES` and `isCompositeSkillType` are exported from one place, and every composition guard uses them.
- New `findUnembeddedCompositions` / `enqueueCompositionEmbedBackfill`: a one-time repair job for published composites that have no embedding row. It's a dry run by default.
