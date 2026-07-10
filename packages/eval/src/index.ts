// ══════════════════════════════════════════════════════════════════════════════
// @skillsregistry/eval — search quality eval suite
// ══════════════════════════════════════════════════════════════════════════════

export {
  evalFixtures,
  validateFixtures,
  getFixtureStats,
  type EvalFixture,
} from './fixtures.js';

export {
  computeMetrics,
  buildEvalResult,
  formatMetrics,
  findSkillRank,
  type EvalMetrics,
  type EvalResult,
} from './metrics.js';

export {
  runEvalSuite,
  formatSummary,
  getFailedQueries,
  formatFailedQueries,
  type EvalRunResult,
  type RunEvalOptions,
} from './runner.js';

export {
  buildEvalSeedSkills,
  evalSeedSkills,
  type EvalSeedSkill,
} from './seed-skills.js';

export { evalCanonicalSkillIds } from './fixtures.js';
