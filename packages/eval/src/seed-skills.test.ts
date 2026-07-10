import { describe, expect, it } from 'vitest';
import { evalCanonicalSkillIds, evalFixtures } from './fixtures.js';
import { buildEvalSeedSkills, evalSeedSkills } from './seed-skills.js';

describe('eval seed skills', () => {
  it('builds one entry per canonical eval skill id', () => {
    expect(evalSeedSkills).toHaveLength(Object.keys(evalCanonicalSkillIds).length);
    expect(evalSeedSkills).toHaveLength(40);
  });

  it('covers every fixture expectedSkillId', () => {
    const seeded = new Set(evalSeedSkills.map((s) => s.id));
    for (const fixture of evalFixtures) {
      expect(seeded.has(fixture.expectedSkillId)).toBe(true);
    }
  });

  it('uses unique slugs and stable ids', () => {
    const slugs = evalSeedSkills.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const skill of evalSeedSkills) {
      expect(skill.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(skill.agentSummary.length).toBeGreaterThan(0);
      expect(skill.description.length).toBeGreaterThan(0);
    }
  });

  it('rebuilds identically', () => {
    expect(buildEvalSeedSkills()).toEqual(evalSeedSkills);
  });
});
