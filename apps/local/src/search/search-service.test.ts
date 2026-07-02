// ══════════════════════════════════════════════════════════════════════════════
// SearchService — projection tests (unit, no I/O).
// ══════════════════════════════════════════════════════════════════════════════
//
// The service is thin — it forwards to `ConfidenceGate.findSkill` and
// projects the domain response into the wire contract. These tests focus
// on the projection since the gate is exercised in the domain package.
// ══════════════════════════════════════════════════════════════════════════════

import { describe, expect, it, vi } from 'vitest';
import type { NodeAfterResponse } from '../adapters/index.js';
import type { ConfidenceGate } from '@skillsregistry/domain/intelligence';
import type { FindSkillResponse, SkillResult } from '@skillsregistry/domain/types';
import { SearchService, projectResponse } from './search-service.js';

function makeSkill(overrides: Partial<SkillResult> = {}): SkillResult {
  return {
    id: 'skill-1',
    name: 'demo',
    slug: 'demo',
    version: '1.0.0',
    agentSummary: 'a demo skill',
    trustScore: 0.75,
    verificationTier: 'B',
    trustBadge: null,
    status: 'published',
    executionLayer: 'sandboxed',
    capabilitiesRequired: [],
    skillType: 'canonical',
    runtimeEnv: 'api',
    visibility: 'public',
    runCount: 0,
    score: 0.9,
    matchSource: 'vector',
    shareUrl: 'https://example.com/demo',
    publisherKeyId: null,
    signatureVerifiedAt: null,
    signatureFailureReason: null,
    ...overrides,
  } as SkillResult;
}

function makeDomain(overrides: Partial<FindSkillResponse> = {}): FindSkillResponse {
  return {
    results: [makeSkill()],
    confidence: 'high',
    enriched: false,
    meta: {
      matchSources: ['vector'],
      latencyMs: 42,
      tier: 1,
      cacheHit: false,
      llmInvoked: false,
    },
    ...overrides,
  };
}

describe('projectResponse', () => {
  it('maps agentSummary → description and preserves score', () => {
    const wire = projectResponse(makeDomain());
    expect(wire.skills).toHaveLength(1);
    expect(wire.skills[0]!.description).toBe('a demo skill');
    expect(wire.skills[0]!.score).toBe(0.9);
  });

  it('sets source=local on both the skill and meta', () => {
    const wire = projectResponse(makeDomain());
    expect(wire.skills[0]!.source).toBe('local');
    expect(wire.meta.source).toBe('local');
  });

  it('maps meta.cacheHit → cached and meta.llmInvoked → deepSearchUsed', () => {
    const wire = projectResponse(
      makeDomain({
        meta: {
          matchSources: ['vector'],
          latencyMs: 5,
          tier: 2,
          cacheHit: true,
          llmInvoked: true,
        },
      }),
    );
    expect(wire.meta.cached).toBe(true);
    expect(wire.meta.deepSearchUsed).toBe(true);
    expect(wire.meta.tier).toBe(2);
  });

  it('confidence equals the top skill score, clamped to 0..1', () => {
    const wire = projectResponse(
      makeDomain({ results: [makeSkill({ score: 1.5 })] }),
    );
    expect(wire.meta.confidence).toBe(1);
  });

  it('confidence = 0 when results is empty', () => {
    const wire = projectResponse(makeDomain({ results: [] }));
    expect(wire.skills).toHaveLength(0);
    expect(wire.meta.confidence).toBe(0);
  });

  it('signals is always emitted as [] for the local node', () => {
    const wire = projectResponse(makeDomain());
    expect(wire.meta.signals).toEqual([]);
  });

  it('category is nulled since SkillResult does not carry it', () => {
    const wire = projectResponse(makeDomain());
    expect(wire.skills[0]!.category).toBeNull();
  });

  it('publisher-signing fields default to null when absent', () => {
    const wire = projectResponse(
      makeDomain({
        results: [
          makeSkill({
            publisherKeyId: undefined,
            signatureVerifiedAt: undefined,
            signatureFailureReason: undefined,
          }),
        ],
      }),
    );
    expect(wire.skills[0]!.publisherKeyId).toBeNull();
    expect(wire.skills[0]!.signatureVerifiedAt).toBeNull();
    expect(wire.skills[0]!.signatureFailureReason).toBeNull();
  });
});

describe('SearchService.search', () => {
  const noopAfter = {} as unknown as NodeAfterResponse;

  it('delegates to gate.findSkill with tenantId + mapped options', async () => {
    const findSkill = vi.fn(async () => makeDomain());
    const gate = { findSkill } as unknown as ConfidenceGate;
    const svc = new SearchService({ gate, afterResponse: noopAfter });

    const result = await svc.search('query text', {
      tenantId: 'tenant-x',
      limit: 5,
      appetite: 'strict',
      tags: ['ai', 'ml'],
      category: 'nlp',
      runtimeEnv: ['api'],
      visibility: 'public',
      portable: true,
    });

    expect(findSkill).toHaveBeenCalledTimes(1);
    const [q, tenantId, options] = findSkill.mock.calls[0]!;
    expect(q).toBe('query text');
    expect(tenantId).toBe('tenant-x');
    expect(options).toMatchObject({
      limit: 5,
      appetite: 'strict',
      tags: ['ai', 'ml'],
      category: 'nlp',
      runtimeEnv: ['api'],
      visibility: 'public',
      portable: true,
    });
    expect(result.skills).toHaveLength(1);
    expect(result.meta.source).toBe('local');
  });

  it('propagates errors from the gate', async () => {
    const gate = {
      findSkill: async () => {
        throw new Error('embedder down');
      },
    } as unknown as ConfidenceGate;
    const svc = new SearchService({ gate, afterResponse: noopAfter });
    await expect(svc.search('x', { tenantId: 'local' })).rejects.toThrow(
      'embedder down',
    );
  });
});
