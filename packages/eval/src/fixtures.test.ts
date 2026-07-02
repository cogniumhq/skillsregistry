import { describe, it, expect } from 'vitest';
import { evalFixtures, validateFixtures, getFixtureStats } from './fixtures.js';

describe('Eval Fixtures', () => {
  describe('validateFixtures', () => {
    it('should validate all fixtures successfully', () => {
      const result = validateFixtures();
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should have at least 80 fixtures', () => {
      expect(evalFixtures.length).toBeGreaterThanOrEqual(80);
    });

    it('should have no duplicate IDs', () => {
      const ids = evalFixtures.map((f) => f.id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size);
    });

    it('should have all required patterns', () => {
      const patterns: Array<'direct' | 'problem' | 'business' | 'alternate' | 'composition'> = ['direct', 'problem', 'business', 'alternate', 'composition'];
      const fixturePatterns = new Set(evalFixtures.map((f) => f.pattern));

      for (const pattern of patterns) {
        expect(fixturePatterns.has(pattern)).toBe(true);
      }
    });

    it('should have valid skill IDs (UUID format)', () => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      for (const fixture of evalFixtures) {
        expect(fixture.expectedSkillId).toMatch(uuidRegex);
      }
    });

    it('should have non-empty queries', () => {
      for (const fixture of evalFixtures) {
        expect(fixture.query).toBeTruthy();
        expect(fixture.query.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getFixtureStats', () => {
    it('should return correct total count', () => {
      const stats = getFixtureStats();
      expect(stats.total).toBe(evalFixtures.length);
    });

    it('should count patterns correctly', () => {
      const stats = getFixtureStats();

      expect(stats.byPattern.direct).toBeGreaterThan(0);
      expect(stats.byPattern.problem).toBeGreaterThan(0);
      expect(stats.byPattern.business).toBeGreaterThan(0);
      expect(stats.byPattern.alternate).toBeGreaterThan(0);
      expect(stats.byPattern.composition).toBeGreaterThan(0);

      // Sum should equal total
      const sum = Object.values(stats.byPattern).reduce((a, b) => a + b, 0);
      expect(sum).toBe(stats.total);
    });

    it('should count unique skills correctly', () => {
      const stats = getFixtureStats();
      const uniqueSkills = new Set(evalFixtures.map((f) => f.expectedSkillId));
      expect(stats.uniqueSkills).toBe(uniqueSkills.size);
    });

    it('should count by skill correctly', () => {
      const stats = getFixtureStats();

      // Each skill should have at least one fixture
      expect(Object.keys(stats.bySkill).length).toBe(stats.uniqueSkills);

      // Sum of skill counts should equal total
      const sum = Object.values(stats.bySkill).reduce((a, b) => a + b, 0);
      expect(sum).toBe(stats.total);
    });
  });

  describe('Fixture Structure', () => {
    it('should have all required fields', () => {
      for (const fixture of evalFixtures) {
        expect(fixture).toHaveProperty('id');
        expect(fixture).toHaveProperty('query');
        expect(fixture).toHaveProperty('expectedSkillId');
        expect(fixture).toHaveProperty('pattern');
      }
    });

    it('should have valid pattern values', () => {
      const validPatterns = ['direct', 'problem', 'business', 'alternate', 'composition'];

      for (const fixture of evalFixtures) {
        expect(validPatterns).toContain(fixture.pattern);
      }
    });
  });
});
