import { describe, it, expect } from 'vitest';
import { computeMetrics, buildEvalResult, formatMetrics } from './metrics.js';
import type { FindSkillResponse } from '@skillsregistry/domain';
import type { EvalFixture } from './fixtures.js';

describe('Eval Metrics', () => {
  const mockFixture: EvalFixture = {
    id: 'test-001',
    query: 'test query',
    expectedSkillId: '550e8400-e29b-41d4-a716-446655440001',
    pattern: 'direct',
  };

  const createMockResponse = (skillId: string, score: number, tier: 1 | 2 | 3 = 1): FindSkillResponse => ({
    results: [
      {
        id: skillId,
        name: 'Test Skill',
        slug: 'test-skill',
        version: '1.0.0',
        agentSummary: 'Test description',
        score,
        matchSource: 'vector',
        trustScore: 0.9,
        verificationTier: 'unverified',
        trustBadge: null,
        status: 'published',
        executionLayer: 'local',
        capabilitiesRequired: [],
        skillType: 'atomic',
        runCount: 0,
        runtimeEnv: 'api',
        visibility: 'public',
        shareUrl: 'https://skillsregistry.net/skills/test-skill',
      },
    ],
    confidence: tier === 1 ? 'high' : tier === 2 ? 'medium' : 'low_enriched',
    enriched: tier === 3,
    meta: {
      matchSources: ['vector'],
      tier,
      latencyMs: 100,
      cacheHit: false,
      llmInvoked: tier === 3,
    },
  });

  describe('buildEvalResult', () => {
    it('should detect rank 1 hit', () => {
      const response = createMockResponse(mockFixture.expectedSkillId, 0.9);
      const result = buildEvalResult(mockFixture, response, 50);

      expect(result.foundInTop1).toBe(true);
      expect(result.foundInTop5).toBe(true);
      expect(result.correctSkillRank).toBe(1);
      expect(result.latencyMs).toBe(50);
    });

    it('should detect rank 3 hit', () => {
      const response = createMockResponse('other-skill', 0.9);
      response.results.push(
        {
          id: 'another-skill',
          name: 'Another',
          slug: 'another',
          version: '1.0.0',
          agentSummary: 'Test',
          score: 0.8,
          matchSource: 'vector',
          trustScore: 0.9,
          verificationTier: 'unverified',
          trustBadge: null,
          status: 'published',
          executionLayer: 'local',
          capabilitiesRequired: [],
          skillType: 'atomic',
          runCount: 0,
          runtimeEnv: 'api',
          visibility: 'public',
          shareUrl: 'https://skillsregistry.net/skills/another',
        },
        {
          id: mockFixture.expectedSkillId,
          name: 'Expected',
          slug: 'expected',
          version: '1.0.0',
          agentSummary: 'Test',
          score: 0.7,
          matchSource: 'vector',
          trustScore: 0.9,
          verificationTier: 'unverified',
          trustBadge: null,
          status: 'published',
          executionLayer: 'local',
          capabilitiesRequired: [],
          skillType: 'atomic',
          runCount: 0,
          runtimeEnv: 'api',
          visibility: 'public',
          shareUrl: 'https://skillsregistry.net/skills/expected',
        }
      );

      const result = buildEvalResult(mockFixture, response, 100);

      expect(result.foundInTop1).toBe(false);
      expect(result.foundInTop5).toBe(true);
      expect(result.correctSkillRank).toBe(3);
    });

    it('should detect miss', () => {
      const response = createMockResponse('other-skill', 0.9);
      const result = buildEvalResult(mockFixture, response, 75);

      expect(result.foundInTop1).toBe(false);
      expect(result.foundInTop5).toBe(false);
      expect(result.correctSkillRank).toBeNull();
    });
  });

  describe('computeMetrics', () => {
    it('should compute perfect metrics', () => {
      const results = [
        buildEvalResult(mockFixture, createMockResponse(mockFixture.expectedSkillId, 0.9, 1), 50),
        buildEvalResult(mockFixture, createMockResponse(mockFixture.expectedSkillId, 0.8, 1), 60),
      ];

      const metrics = computeMetrics(results);

      expect(metrics.recall1).toBe(1.0);
      expect(metrics.recall5).toBe(1.0);
      expect(metrics.mrr).toBe(1.0);
      expect(metrics.avgTopScore).toBeCloseTo(0.85, 2);
      expect(metrics.tierDistribution[1]).toBe(2);
      expect(metrics.tierDistribution[2]).toBe(0);
      expect(metrics.tierDistribution[3]).toBe(0);

      // Phase 2: tier accuracy
      expect(metrics.tierAccuracy[1].accuracy).toBe(1.0);
      expect(metrics.tierAccuracy[1].total).toBe(2);
    });

    it('should compute 50% recall@1', () => {
      const results = [
        buildEvalResult(mockFixture, createMockResponse(mockFixture.expectedSkillId, 0.9, 1), 50),
        buildEvalResult(mockFixture, createMockResponse('other-skill', 0.8, 2), 100),
      ];

      const metrics = computeMetrics(results);

      expect(metrics.recall1).toBe(0.5);
      expect(metrics.recall5).toBe(0.5);
    });

    it('should compute MRR correctly', () => {
      const response1 = createMockResponse(mockFixture.expectedSkillId, 0.9, 1);
      const response2 = createMockResponse('other-skill', 0.9, 1);
      response2.results.push({
        id: mockFixture.expectedSkillId,
        name: 'Expected',
        slug: 'expected',
        version: '1.0.0',
        agentSummary: 'Test',
        score: 0.8,
        matchSource: 'vector',
        trustScore: 0.9,
        verificationTier: 'unverified',
        trustBadge: null,
        status: 'published',
        executionLayer: 'local',
        capabilitiesRequired: [],
        skillType: 'atomic',
        runCount: 0,
        runtimeEnv: 'api',
        visibility: 'public',
        shareUrl: 'https://skillsregistry.net/skills/expected',
      });

      const results = [
        buildEvalResult(mockFixture, response1, 50), // Rank 1
        buildEvalResult(mockFixture, response2, 60), // Rank 2
      ];

      const metrics = computeMetrics(results);

      // MRR = (1/1 + 1/2) / 2 = 0.75
      expect(metrics.mrr).toBeCloseTo(0.75, 2);
    });

    it('should handle empty results', () => {
      const metrics = computeMetrics([]);

      expect(metrics.recall1).toBe(0);
      expect(metrics.recall5).toBe(0);
      expect(metrics.mrr).toBe(0);
      expect(metrics.avgTopScore).toBe(0);
    });

    it('should compute tier distribution', () => {
      const results = [
        buildEvalResult(mockFixture, createMockResponse(mockFixture.expectedSkillId, 0.9, 1), 50),
        buildEvalResult(mockFixture, createMockResponse(mockFixture.expectedSkillId, 0.8, 2), 100),
        buildEvalResult(mockFixture, createMockResponse(mockFixture.expectedSkillId, 0.7, 2), 110),
        buildEvalResult(mockFixture, createMockResponse(mockFixture.expectedSkillId, 0.6, 3), 500),
      ];

      const metrics = computeMetrics(results);

      expect(metrics.tierDistribution[1]).toBe(1);
      expect(metrics.tierDistribution[2]).toBe(2);
      expect(metrics.tierDistribution[3]).toBe(1);

      // Phase 2: latency by tier
      expect(metrics.latencyByTier[1].p50).toBe(50);
      expect(metrics.latencyByTier[3].p50).toBe(500);
    });

    it('should compute by-pattern metrics', () => {
      const fixture1 = { ...mockFixture, pattern: 'direct' as const };
      const fixture2 = { ...mockFixture, pattern: 'problem' as const };

      const results = [
        buildEvalResult(fixture1, createMockResponse(fixture1.expectedSkillId, 0.9), 50),
        buildEvalResult(fixture2, createMockResponse('other-skill', 0.8), 60),
      ];

      const metrics = computeMetrics(results);

      expect(metrics.byPattern.direct.recall5).toBe(1.0);
      expect(metrics.byPattern.problem.recall5).toBe(0.0);
    });

    it('should compute tier accuracy', () => {
      const results = [
        buildEvalResult(mockFixture, createMockResponse(mockFixture.expectedSkillId, 0.9, 1), 50),
        buildEvalResult(mockFixture, createMockResponse('other-skill', 0.8, 1), 55),
        buildEvalResult(mockFixture, createMockResponse(mockFixture.expectedSkillId, 0.7, 2), 100),
      ];

      const metrics = computeMetrics(results);

      expect(metrics.tierAccuracy[1].total).toBe(2);
      expect(metrics.tierAccuracy[1].correct).toBe(1);
      expect(metrics.tierAccuracy[1].accuracy).toBe(0.5);
      expect(metrics.tierAccuracy[2].total).toBe(1);
      expect(metrics.tierAccuracy[2].correct).toBe(1);
      expect(metrics.tierAccuracy[2].accuracy).toBe(1.0);
    });

    it('should compute LLM fallback lift', () => {
      const tier3Response = createMockResponse(mockFixture.expectedSkillId, 0.6, 3);
      const results = [
        buildEvalResult(mockFixture, createMockResponse(mockFixture.expectedSkillId, 0.9, 1), 50),
        buildEvalResult(mockFixture, tier3Response, 500),
      ];

      const metrics = computeMetrics(results);

      expect(metrics.llmFallbackLift.tier3.total).toBe(1);
      expect(metrics.llmFallbackLift.tier3.enrichedImproved).toBe(1);
      expect(metrics.llmFallbackLift.tier3.liftRate).toBe(1.0);
    });
  });

  describe('formatMetrics', () => {
    it('should format metrics as string', () => {
      const metrics = {
        recall1: 0.938,
        recall5: 1.0,
        mrr: 0.969,
        avgTopScore: 0.474,
        tierDistribution: { 1: 10, 2: 15, 3: 5 },
        byPattern: {
          direct: { recall5: 1.0, mrr: 1.0 },
          problem: { recall5: 0.95, mrr: 0.85 },
        },
        tierAccuracy: {
          1: { total: 10, correct: 9, accuracy: 0.9 },
          2: { total: 15, correct: 10, accuracy: 0.667 },
          3: { total: 5, correct: 2, accuracy: 0.4 },
        },
        latencyByTier: {
          1: { p50: 45, p95: 80, p99: 95 },
          2: { p50: 120, p95: 200, p99: 250 },
          3: { p50: 800, p95: 1200, p99: 1500 },
        },
        llmFallbackLift: {
          tier2: { total: 15, enrichedImproved: 5, liftRate: 0.333 },
          tier3: { total: 5, enrichedImproved: 3, liftRate: 0.6 },
        },
        matchSourceDistribution: {
          agent_summary: { count: 20, correctAtRank1: 15, avgScore: 0.52 },
          alt_query_0: { count: 10, correctAtRank1: 8, avgScore: 0.55 },
        },
      };

      const formatted = formatMetrics(metrics);

      expect(formatted).toContain('93.8%'); // recall1
      expect(formatted).toContain('100.0%'); // recall5
      expect(formatted).toContain('0.969'); // mrr
      expect(formatted).toContain('direct');
      expect(formatted).toContain('problem');
      expect(formatted).toContain('Accuracy Per Tier');
      expect(formatted).toContain('Latency Per Tier');
      expect(formatted).toContain('LLM Fallback Lift');
      expect(formatted).toContain('Match Source Distribution');
      expect(formatted).toContain('agent_summary');
      expect(formatted).toContain('alt_query_0');
    });
  });
});
