// ══════════════════════════════════════════════════════════════════════════════
// @skillsregistry/domain — runtime-agnostic business logic
// ══════════════════════════════════════════════════════════════════════════════
//
// This package holds the SkillsRegistry domain layer — search intelligence,
// composition, resilience, scoring policy — expressed against a small set of
// adapter interfaces. Consumers (mothership Worker, local Node app) provide
// concrete adapters at boot; the domain code has no direct dependency on
// any runtime, driver, or framework.
//
// Sub-modules land incrementally per `.specifica/mvp/tasks.md` T-1.4a → T-1.4f.
// Only the adapter interfaces ship in the initial scaffold.
//
// ══════════════════════════════════════════════════════════════════════════════

export * from './adapters/index.js';
export * from './resilience/index.js';
