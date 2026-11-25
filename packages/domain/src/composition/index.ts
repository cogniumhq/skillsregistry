// ══════════════════════════════════════════════════════════════════════════════
// Composition — barrel
// ══════════════════════════════════════════════════════════════════════════════

export {
  type CompositionAdapters,
  type EmbedQueueMessage,
  type CogniumScanQueueMessage,
} from './adapters.js';

export { NotFoundError, ValidationError } from './errors.js';

export {
  forkInputSchema,
  copyInputSchema,
  compositionInputSchema,
  extendInputSchema,
  type ForkInput,
  type CopyInput,
  type CompositionInputBody,
  type ExtendInput,
} from './schema.js';

export { forkSkill, type ForkOptions } from './fork.js';
export { copySkill } from './copy.js';
export { createComposition } from './compose.js';
export { extendComposition } from './extend.js';
export { publishComposition } from './publish.js';
export {
  COMPOSITION_SKILL_TYPES,
  isCompositeSkillType,
  type CompositionSkillType,
} from './skill-types.js';
export {
  buildCompositeSummary,
  compositeIndexableText,
  extractWorkflowSteps,
  isStepVisibleToComposite,
  loadCompositionIndexText,
  resolveCompositeSteps,
  stripVersion,
  PRIVATE_STEP_LABEL,
  type CompositeStep,
  type CompositeSummaryInput,
  type SkillAudience,
} from './index-text.js';
export {
  enqueueCompositionEmbedBackfill,
  findUnembeddedCompositions,
  type UnembeddedComposition,
} from './backfill.js';
export { getAncestry, getForks, getDependents } from './lineage.js';
export {
  getCompositionBySlug,
  type CompositionStep,
  type CompositionDetail,
  type GetCompositionResult,
  type GetCompositionOptions,
} from './get-composition.js';
