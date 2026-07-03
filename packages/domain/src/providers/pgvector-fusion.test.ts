// ══════════════════════════════════════════════════════════════════════════════
// PgVectorProvider — fusion mode tests (linear vs RRF)
// ══════════════════════════════════════════════════════════════════════════════
//
// Ported from mothership `tests/providers/pgvector-fusion.test.ts`. Adapted
// for the local API surface: the runtime-agnostic constructor takes
// `PgVectorProviderOptions` (typed pool + explicit fusion/threshold knobs)
// instead of `Env` + env-var parsing. Case-insensitive FUSION_MODE parsing
// belongs to the mothership consumer, not the domain package — so those
// tests are elided here and moved upstream when the runtime rebinds.
//
// The `fuseScores` method is private; we bracket-access it, same as the
// mothership. No DB round-trips — the pool is a dead stub.
//
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import { PgVectorProvider, type PgVectorProviderOptions } from './pgvector-provider.js';
import type { SqlPool } from '../adapters/sql.js';

// Minimal dead-pool stub — `fuseScores` never touches it.
function makePool(): SqlPool {
  return {
    query: vi.fn(),
    connect: vi.fn(),
  } as unknown as SqlPool;
}

function makeProvider(opts: Partial<PgVectorProviderOptions> = {}): PgVectorProvider {
  return new PgVectorProvider({ pool: makePool(), ...opts });
}

// ── Fixture builders ────────────────────────────────────────────────────────

const VEC = (id: string, score: number, trustScore = 0.5) => ({
  skillId: id,
  score,
  matchSource: 'agent_summary',
  matchText: `text-${id}`,
  trustScore,
});

const FT = (id: string, score: number, keywordHits = 1) => ({
  skillId: id,
  score,
  keywordHits,
});

// Bracket-access the private method (test-only affordance — same pattern as mothership).
function callFuse(
  provider: PgVectorProvider,
  vec: ReturnType<typeof VEC>[],
  ft: ReturnType<typeof FT>[],
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (provider as any).fuseScores(vec, ft);
}

// ══════════════════════════════════════════════════════════════════════════════
// Linear (default) fusion
// ══════════════════════════════════════════════════════════════════════════════

describe('PgVectorProvider — linear fusion (default)', () => {
  it('defaults to linear mode when fusionMode is unset', () => {
    const p = makeProvider();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((p as any).fusionMode).toBe('linear');
  });

  it('applies weighted blend: 0.7·vector + 0.3·fullText', () => {
    const p = makeProvider();
    const vec = [VEC('a', 0.9), VEC('b', 0.6)];
    const ft = [FT('a', 0.8), FT('b', 0.4)];

    const result = callFuse(p, vec, ft);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ skillId: 'a', fusedScore: expect.closeTo(0.87, 6) });
    expect(result[1]).toMatchObject({ skillId: 'b', fusedScore: expect.closeTo(0.54, 6) });
  });

  it('drops FTS-only candidates (legacy intersect-on-vector semantic)', () => {
    const p = makeProvider();
    const vec = [VEC('a', 0.9)];
    const ft = [FT('a', 0.8), FT('z', 0.99)]; // z is FTS-only

    const result = callFuse(p, vec, ft);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(result.map((r: any) => r.skillId)).toEqual(['a']);
  });

  it('respects custom vectorWeight / fullTextWeight', () => {
    const p = makeProvider({ vectorWeight: 0.5, fullTextWeight: 0.5 });
    const vec = [VEC('a', 0.4)];
    const ft = [FT('a', 0.8)];

    const result = callFuse(p, vec, ft);

    // 0.5 * 0.4 + 0.5 * 0.8 = 0.60
    expect(result[0].fusedScore).toBeCloseTo(0.6, 6);
  });

  it('carries vector match metadata into the fused row', () => {
    const p = makeProvider();
    const vec = [{ ...VEC('a', 0.5), matchSource: 'skill_md', matchText: 'blob' }];
    const ft = [FT('a', 0.5, 3)];

    const result = callFuse(p, vec, ft);

    expect(result[0]).toMatchObject({
      skillId: 'a',
      matchSource: 'skill_md',
      matchText: 'blob',
      keywordHits: 3,
      trustScore: 0.5,
    });
  });

  it('defaults keywordHits to 0 when vector row has no FTS match', () => {
    const p = makeProvider();
    const vec = [VEC('a', 0.9)];
    const ft: ReturnType<typeof FT>[] = []; // no FTS at all

    const result = callFuse(p, vec, ft);

    expect(result[0]).toMatchObject({
      skillId: 'a',
      fullTextScore: 0,
      keywordHits: 0,
    });
  });

  it('sorts results descending by fusedScore', () => {
    const p = makeProvider();
    // Feed unsorted input; expect descending output
    const vec = [VEC('a', 0.3), VEC('b', 0.9), VEC('c', 0.6)];
    const ft = [FT('a', 0.3), FT('b', 0.9), FT('c', 0.6)];

    const result = callFuse(p, vec, ft);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(result.map((r: any) => r.skillId)).toEqual(['b', 'c', 'a']);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RRF fusion
// ══════════════════════════════════════════════════════════════════════════════

describe('PgVectorProvider — RRF fusion', () => {
  it('honors fusionMode="rrf" flag and default rrfK=60', () => {
    const p = makeProvider({ fusionMode: 'rrf' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((p as any).fusionMode).toBe('rrf');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((p as any).rrfK).toBe(60);
  });

  it('computes Σ 1/(k+rank) across both retrievers at k=60', () => {
    const p = makeProvider({ fusionMode: 'rrf' });
    const vec = [VEC('a', 0.9), VEC('b', 0.6)]; // ranks: a=1, b=2
    const ft = [FT('b', 0.8), FT('a', 0.4)];    // ranks: b=1, a=2

    const result = callFuse(p, vec, ft);

    // Both a and b sum to 1/61 + 1/62 → tie
    expect(result).toHaveLength(2);
    expect(result[0].fusedScore).toBeCloseTo(1 / 61 + 1 / 62, 6);
    expect(result[1].fusedScore).toBeCloseTo(1 / 61 + 1 / 62, 6);
  });

  it('breaks ties by favoring candidate ranked 1 in both retrievers', () => {
    const p = makeProvider({ fusionMode: 'rrf' });
    const vec = [VEC('a', 0.9), VEC('b', 0.6)];
    const ft = [FT('a', 0.8), FT('b', 0.4)];

    const result = callFuse(p, vec, ft);

    expect(result[0].skillId).toBe('a');
    expect(result[1].skillId).toBe('b');
    expect(result[0].fusedScore).toBeGreaterThan(result[1].fusedScore);
  });

  it('rescues FTS-only candidates (union semantic)', () => {
    const p = makeProvider({ fusionMode: 'rrf' });
    const vec = [VEC('a', 0.9)];
    const ft = [FT('z', 0.99), FT('a', 0.1)]; // z is FTS-only at rank 1

    const result = callFuse(p, vec, ft);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ids = result.map((r: any) => r.skillId);
    expect(ids).toContain('z');
    expect(ids).toContain('a');
    // a: 1/61 + 1/62 ≈ 0.0325
    // z: 0    + 1/61 ≈ 0.0164
    expect(result[0].skillId).toBe('a');
    expect(result[1].skillId).toBe('z');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(result.find((r: any) => r.skillId === 'z')!.trustScore).toBe(0.5);
  });

  it('synthesizes matchSource="agent_summary" for FTS-only rows', () => {
    const p = makeProvider({ fusionMode: 'rrf' });
    const vec: ReturnType<typeof VEC>[] = [];
    const ft = [FT('z', 0.9)];

    const result = callFuse(p, vec, ft);

    expect(result[0]).toMatchObject({
      skillId: 'z',
      matchSource: 'agent_summary',
      matchText: '',
      trustScore: 0.5,
    });
  });

  it('honors custom rrfK override', () => {
    const p = makeProvider({ fusionMode: 'rrf', rrfK: 10 });
    const vec = [VEC('a', 0.9)];
    const ft = [FT('a', 0.8)];

    const result = callFuse(p, vec, ft);

    // 1/(10+1) + 1/(10+1) = 2/11
    expect(result[0].fusedScore).toBeCloseTo(2 / 11, 6);
  });

  it('returns empty array when both retrievers empty', () => {
    const p = makeProvider({ fusionMode: 'rrf' });
    expect(callFuse(p, [], [])).toEqual([]);
  });

  it('handles vector-only (no FTS matches)', () => {
    const p = makeProvider({ fusionMode: 'rrf' });
    const vec = [VEC('a', 0.9)];
    const result = callFuse(p, vec, []);
    // 1/(60+1) = 0.01639...
    expect(result[0].fusedScore).toBeCloseTo(1 / 61, 6);
    expect(result[0].fullTextScore).toBe(0);
    expect(result[0].keywordHits).toBe(0);
  });

  it('preserves trustScore from vector row when present', () => {
    const p = makeProvider({ fusionMode: 'rrf' });
    const vec = [VEC('a', 0.9, 0.85)];
    const ft = [FT('a', 0.8)];
    const result = callFuse(p, vec, ft);
    expect(result[0].trustScore).toBe(0.85);
  });

  it('sorts results descending by fusedScore', () => {
    const p = makeProvider({ fusionMode: 'rrf' });
    // rank 1 candidate should sort above rank 5 candidate
    const vec = [VEC('a', 0.9), VEC('b', 0.5)];
    const ft = [
      FT('a', 0.9),
      FT('c', 0.8),
      FT('d', 0.7),
      FT('e', 0.6),
      FT('b', 0.5),
    ];
    const result = callFuse(p, vec, ft);
    expect(result[0].skillId).toBe('a');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scores = result.map((r: any) => r.fusedScore);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Constructor validation + tier threshold defaults
// ══════════════════════════════════════════════════════════════════════════════

describe('PgVectorProvider — constructor', () => {
  it('throws on unknown fusionMode value', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => new PgVectorProvider({ pool: makePool(), fusionMode: 'magic' as any })).toThrow(
      /Unknown fusionMode/,
    );
  });

  it('linear defaults tier thresholds to 0.62 / 0.58 (§10 A4)', () => {
    const p = makeProvider();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((p as any).tier1Threshold).toBeCloseTo(0.62, 6);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((p as any).tier2Threshold).toBeCloseTo(0.58, 6);
  });

  it('rrf defaults tier thresholds to 0.030 / 0.018 (RRF scale)', () => {
    const p = makeProvider({ fusionMode: 'rrf' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((p as any).tier1Threshold).toBeCloseTo(0.030, 6);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((p as any).tier2Threshold).toBeCloseTo(0.018, 6);
  });

  it('explicit tier thresholds win over mode-aware defaults (linear)', () => {
    const p = makeProvider({ tier1Threshold: 0.99, tier2Threshold: 0.50 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((p as any).tier1Threshold).toBeCloseTo(0.99, 6);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((p as any).tier2Threshold).toBeCloseTo(0.50, 6);
  });

  it('explicit tier thresholds win over mode-aware defaults (rrf)', () => {
    const p = makeProvider({
      fusionMode: 'rrf',
      tier1Threshold: 0.025,
      tier2Threshold: 0.010,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((p as any).tier1Threshold).toBeCloseTo(0.025, 6);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((p as any).tier2Threshold).toBeCloseTo(0.010, 6);
  });

  it('applies default fusion weights (0.7 vector / 0.3 fullText)', () => {
    const p = makeProvider();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((p as any).vectorWeight).toBe(0.7);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((p as any).fullTextWeight).toBe(0.3);
  });

  it('applies default version-rank weights (0.7 trust / 0.3 usage)', () => {
    const p = makeProvider();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((p as any).versionTrustWeight).toBe(0.7);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((p as any).versionUsageWeight).toBe(0.3);
  });

  it('applies default trustBoostWeight = 0.3', () => {
    const p = makeProvider();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((p as any).trustBoostWeight).toBe(0.3);
  });

  it('applies default candidatePoolMultiplier = 3', () => {
    const p = makeProvider();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((p as any).candidatePoolMultiplier).toBe(3);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Confidence computation (`computeConfidence`, private — bracket access)
// ══════════════════════════════════════════════════════════════════════════════

describe('PgVectorProvider — computeConfidence', () => {
  function callCompute(p: PgVectorProvider, results: unknown[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (p as any).computeConfidence(results);
  }

  it('returns tier=3 zeros for empty results', () => {
    const p = makeProvider();
    expect(callCompute(p, [])).toEqual({
      topScore: 0,
      gapToSecond: 0,
      clusterDensity: 0,
      keywordHits: 0,
      tier: 3,
    });
  });

  it('tier=1 requires topScore ≥ tier1 AND gapToSecond ≥ 0.05', () => {
    const p = makeProvider(); // tier1=0.62, tier2=0.58
    const conf = callCompute(p, [
      { fusedScore: 0.90, fullTextScore: 0.3 },
      { fusedScore: 0.70, fullTextScore: 0.2 },
    ]);
    expect(conf.tier).toBe(1);
    expect(conf.topScore).toBe(0.90);
    expect(conf.gapToSecond).toBeCloseTo(0.20, 6);
    expect(conf.keywordHits).toBe(1);
  });

  it('tier=2 when topScore ≥ tier2 but gap too small', () => {
    const p = makeProvider();
    const conf = callCompute(p, [
      { fusedScore: 0.65, fullTextScore: 0 },
      { fusedScore: 0.63, fullTextScore: 0 }, // gap 0.02 < 0.05
    ]);
    expect(conf.tier).toBe(2);
    expect(conf.keywordHits).toBe(0);
  });

  it('tier=3 when topScore below tier2', () => {
    const p = makeProvider();
    const conf = callCompute(p, [{ fusedScore: 0.30, fullTextScore: 0 }]);
    expect(conf.tier).toBe(3);
  });

  it('gapToSecond=1.0 when only one result', () => {
    const p = makeProvider();
    const conf = callCompute(p, [{ fusedScore: 0.9, fullTextScore: 0.5 }]);
    expect(conf.gapToSecond).toBe(1.0);
    expect(conf.tier).toBe(1);
  });

  it('clusterDensity counts results at or above tier2 threshold', () => {
    const p = makeProvider(); // tier2=0.58
    const conf = callCompute(p, [
      { fusedScore: 0.80, fullTextScore: 0 },
      { fusedScore: 0.60, fullTextScore: 0 },
      { fusedScore: 0.58, fullTextScore: 0 }, // exactly tier2 → counted
      { fusedScore: 0.30, fullTextScore: 0 }, // below tier2 → excluded
    ]);
    expect(conf.clusterDensity).toBe(3);
  });
});
