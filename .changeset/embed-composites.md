---
"@skillsregistry/domain": minor
---

Composites are embedded, so search can find them.

- `publishComposition(id, pool, { embedQueue })` enqueues the published composition for embedding. The queue argument is optional, so existing callers still compile, but every publishing caller should pass it: search reads `skill_embeddings` only.
- `extendComposition` enqueues the fork for embedding again once its new steps are in. `forkSkill`'s embed ran before them, so the vector covered the shorter step list.
- New `compositionIndexText` / `loadCompositionIndexText`: the deterministic text a composite is embedded under. It holds the composite's name and description, then one line per step: the step's name, the skill it runs, and that skill's own summary. Steps come from `composition_steps`, or from the inline `workflow_definition` DAG when there are no step rows. No model call. An embed consumer should use this as the composite's `agentSummary` text, since composites have none of their own.
- New `findUnembeddedCompositions` / `enqueueCompositionEmbedBackfill`: a one-time repair job for published composites that have no embedding row. It's a dry run by default.
