// ══════════════════════════════════════════════════════════════════════════════
// Eval Metrics — Recall@K, MRR, Pattern Analysis, Phase 2 Enhanced
// ══════════════════════════════════════════════════════════════════════════════
//
// Computes search quality metrics from eval results.
//
// Key metrics:
// - Recall@1: % of queries where correct skill is rank 1
// - Recall@5: % of queries where correct skill is in top 5
// - MRR: Mean reciprocal rank (1/rank of correct skill)
// - Tier distribution: % of queries in each tier
// - By-pattern breakdown: Metrics per phrasing pattern
//
// Phase 2 additions:
// - Per-tier accuracy: what % of each tier's results are actually correct
// - Latency by tier: p50, p95, p99 per tier
// - LLM fallback lift: for Tier 2/3, did enrichment improve rank
//
// ══════════════════════════════════════════════════════════════════════════════

import type { FindSkillResponse } from '@skillsregistry/domain';
import type { EvalFixture } from './fixtures.js';

// EvalMetrics is co-located with the metrics module (was in mothership
// src/types.ts prior to the T-1.6 extraction).

export interface EvalMetrics {
  recall1: number; // correct skill in top 1
  recall5: number; // correct skill in top 5
  mrr: number; // mean reciprocal rank
  avgTopScore: number;
  tierDistribution: Record<1 | 2 | 3, number>;
  byPattern: Record<string, { recall5: number; mrr: number }>;

  // Phase 2: Enhanced metrics
  tierAccuracy: Record<
    1 | 2 | 3,
    { total: number; correct: number; accuracy: number }
  >;
  latencyByTier: Record<1 | 2 | 3, { p50: number; p95: number; p99: number }>;
  llmFallbackLift: {
    tier2: { total: number; enrichedImproved: number; liftRate: number };
    tier3: { total: number; enrichedImproved: number; liftRate: number };
  };

  // Phase 3: match source distribution
  matchSourceDistribution: Record<
    string,
    { count: number; correctAtRank1: number; avgScore: number }
  >;
}

export interface EvalResult {
  fixture: EvalFixture;
  response: FindSkillResponse;
  correctSkillRank: number | null; // null if not found
  foundInTop5: boolean;
  foundInTop1: boolean;
  latencyMs: number; // query round-trip time
  // When rank > 1, who beat us? null if rank 1 or not found
  unknownCompetitor?: { id: string; name: string; score: number } | null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Compute All Metrics
// ──────────────────────────────────────────────────────────────────────────────

export function computeMetrics(results: EvalResult[]): EvalMetrics {
  const empty: EvalMetrics = {
    recall1: 0,
    recall5: 0,
    mrr: 0,
    avgTopScore: 0,
    tierDistribution: { 1: 0, 2: 0, 3: 0 },
    byPattern: {},
    tierAccuracy: {
      1: { total: 0, correct: 0, accuracy: 0 },
      2: { total: 0, correct: 0, accuracy: 0 },
      3: { total: 0, correct: 0, accuracy: 0 },
    },
    latencyByTier: {
      1: { p50: 0, p95: 0, p99: 0 },
      2: { p50: 0, p95: 0, p99: 0 },
      3: { p50: 0, p95: 0, p99: 0 },
    },
    llmFallbackLift: {
      tier2: { total: 0, enrichedImproved: 0, liftRate: 0 },
      tier3: { total: 0, enrichedImproved: 0, liftRate: 0 },
    },
    matchSourceDistribution: {},
  };

  if (results.length === 0) {
    return empty;
  }

  // Overall metrics
  const recall1 = computeRecall1(results);
  const recall5 = computeRecall5(results);
  const mrr = computeMRR(results);
  const avgTopScore = computeAvgTopScore(results);
  const tierDistribution = computeTierDistribution(results);

  // Per-pattern breakdown
  const byPattern = computeByPattern(results);

  // Phase 2: Enhanced metrics
  const tierAccuracy = computeTierAccuracy(results);
  const latencyByTier = computeLatencyByTier(results);
  const llmFallbackLift = computeLLMFallbackLift(results);

  // Phase 3: Match source distribution
  const matchSourceDistribution = computeMatchSourceDistribution(results);

  return {
    recall1,
    recall5,
    mrr,
    avgTopScore,
    tierDistribution,
    byPattern,
    tierAccuracy,
    latencyByTier,
    llmFallbackLift,
    matchSourceDistribution,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Recall@1: Correct Skill is Rank 1
// ──────────────────────────────────────────────────────────────────────────────

function computeRecall1(results: EvalResult[]): number {
  const top1Count = results.filter((r) => r.foundInTop1).length;
  return top1Count / results.length;
}

// ──────────────────────────────────────────────────────────────────────────────
// Recall@5: Correct Skill in Top 5
// ──────────────────────────────────────────────────────────────────────────────

function computeRecall5(results: EvalResult[]): number {
  const top5Count = results.filter((r) => r.foundInTop5).length;
  return top5Count / results.length;
}

// ──────────────────────────────────────────────────────────────────────────────
// MRR: Mean Reciprocal Rank
// ──────────────────────────────────────────────────────────────────────────────

function computeMRR(results: EvalResult[]): number {
  let reciprocalRankSum = 0;

  for (const result of results) {
    if (result.correctSkillRank !== null) {
      reciprocalRankSum += 1 / result.correctSkillRank;
    }
    // If not found, contributes 0 to MRR
  }

  return reciprocalRankSum / results.length;
}

// ──────────────────────────────────────────────────────────────────────────────
// Average Top Score
// ──────────────────────────────────────────────────────────────────────────────

function computeAvgTopScore(results: EvalResult[]): number {
  const topScores = results
    .map((r) => r.response.results[0]?.score ?? 0)
    .filter((score) => score > 0);

  if (topScores.length === 0) {
    return 0;
  }

  return topScores.reduce((sum, score) => sum + score, 0) / topScores.length;
}

// ──────────────────────────────────────────────────────────────────────────────
// Tier Distribution
// ──────────────────────────────────────────────────────────────────────────────

function computeTierDistribution(
  results: EvalResult[]
): Record<1 | 2 | 3, number> {
  const distribution: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };

  for (const result of results) {
    const tier = result.response.meta.tier;
    distribution[tier]++;
  }

  return distribution;
}

// ──────────────────────────────────────────────────────────────────────────────
// Per-Pattern Breakdown
// ──────────────────────────────────────────────────────────────────────────────

function computeByPattern(
  results: EvalResult[]
): Record<string, { recall5: number; mrr: number }> {
  // Group results by pattern
  const byPattern: Record<string, EvalResult[]> = {};

  for (const result of results) {
    const pattern = result.fixture.pattern;
    if (!byPattern[pattern]) {
      byPattern[pattern] = [];
    }
    byPattern[pattern].push(result);
  }

  // Compute metrics per pattern
  const metrics: Record<string, { recall5: number; mrr: number }> = {};

  for (const [pattern, patternResults] of Object.entries(byPattern)) {
    metrics[pattern] = {
      recall5: computeRecall5(patternResults),
      mrr: computeMRR(patternResults),
    };
  }

  return metrics;
}

// ──────────────────────────────────────────────────────────────────────────────
// Per-Tier Accuracy: What % of each tier's results are correct
// ──────────────────────────────────────────────────────────────────────────────

function computeTierAccuracy(
  results: EvalResult[]
): Record<1 | 2 | 3, { total: number; correct: number; accuracy: number }> {
  const acc: Record<1 | 2 | 3, { total: number; correct: number }> = {
    1: { total: 0, correct: 0 },
    2: { total: 0, correct: 0 },
    3: { total: 0, correct: 0 },
  };

  for (const result of results) {
    const tier = result.response.meta.tier;
    acc[tier].total++;
    if (result.foundInTop1) {
      acc[tier].correct++;
    }
  }

  return {
    1: { ...acc[1], accuracy: acc[1].total > 0 ? acc[1].correct / acc[1].total : 0 },
    2: { ...acc[2], accuracy: acc[2].total > 0 ? acc[2].correct / acc[2].total : 0 },
    3: { ...acc[3], accuracy: acc[3].total > 0 ? acc[3].correct / acc[3].total : 0 },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Latency By Tier: p50, p95, p99
// ──────────────────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function computeLatencyByTier(
  results: EvalResult[]
): Record<1 | 2 | 3, { p50: number; p95: number; p99: number }> {
  const latencies: Record<1 | 2 | 3, number[]> = { 1: [], 2: [], 3: [] };

  for (const result of results) {
    const tier = result.response.meta.tier;
    latencies[tier].push(result.latencyMs);
  }

  const compute = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return {
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
    };
  };

  return {
    1: compute(latencies[1]),
    2: compute(latencies[2]),
    3: compute(latencies[3]),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// LLM Fallback Lift: Did enrichment improve results for Tier 2/3?
// ──────────────────────────────────────────────────────────────────────────────

function computeLLMFallbackLift(results: EvalResult[]): {
  tier2: { total: number; enrichedImproved: number; liftRate: number };
  tier3: { total: number; enrichedImproved: number; liftRate: number };
} {
  const tier2Results = results.filter((r) => r.response.meta.tier === 2);
  const tier3Results = results.filter((r) => r.response.meta.tier === 3);

  // For Tier 2: enriched means the response has enriched=true (async enrichment completed)
  // For eval purposes, we count tier 2 queries that found the correct skill in top 5
  // as "enrichment helped" since without enrichment they might not have
  const tier2Enriched = tier2Results.filter((r) => r.response.enriched);
  const tier2EnrichedImproved = tier2Enriched.filter((r) => r.foundInTop5).length;

  // For Tier 3: deep search was invoked; count those where correct skill was found
  const tier3Enriched = tier3Results.filter((r) => r.response.meta.llmInvoked);
  const tier3EnrichedImproved = tier3Enriched.filter((r) => r.foundInTop5).length;

  return {
    tier2: {
      total: tier2Results.length,
      enrichedImproved: tier2EnrichedImproved,
      liftRate: tier2Enriched.length > 0 ? tier2EnrichedImproved / tier2Enriched.length : 0,
    },
    tier3: {
      total: tier3Results.length,
      enrichedImproved: tier3EnrichedImproved,
      liftRate: tier3Enriched.length > 0 ? tier3EnrichedImproved / tier3Enriched.length : 0,
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Phase 3: Match Source Distribution
// ──────────────────────────────────────────────────────────────────────────────

function computeMatchSourceDistribution(
  results: EvalResult[]
): Record<string, { count: number; correctAtRank1: number; avgScore: number }> {
  const dist: Record<string, { count: number; correctAtRank1: number; scores: number[] }> = {};

  for (const result of results) {
    const topResult = result.response.results[0];
    if (!topResult) continue;

    const source = topResult.matchSource || 'unknown';
    if (!dist[source]) {
      dist[source] = { count: 0, correctAtRank1: 0, scores: [] };
    }

    dist[source].count++;
    dist[source].scores.push(topResult.score);
    if (result.foundInTop1) dist[source].correctAtRank1++;
  }

  const final: Record<string, { count: number; correctAtRank1: number; avgScore: number }> = {};
  for (const [source, data] of Object.entries(dist)) {
    final[source] = {
      count: data.count,
      correctAtRank1: data.correctAtRank1,
      avgScore: data.scores.reduce((a, b) => a + b, 0) / data.scores.length,
    };
  }

  return final;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helper: Find Rank of Expected Skill
// ──────────────────────────────────────────────────────────────────────────────

export function findSkillRank(
  response: FindSkillResponse,
  expectedSkillId: string,
  acceptableSkillIds?: readonly string[],
  acceptableNamePatterns?: readonly string[]
): number | null {
  const validIds = new Set([expectedSkillId, ...(acceptableSkillIds ?? [])]);
  const namePatterns = (acceptableNamePatterns ?? []).map((p) => p.toLowerCase());
  for (let i = 0; i < response.results.length; i++) {
    const result = response.results[i];
    if (validIds.has(result.id)) {
      return i + 1; // Rank is 1-indexed
    }
    // Name-based matching: catches cross-source duplicates without hardcoding UUIDs
    if (namePatterns.length > 0) {
      const name = (result.name || '').toLowerCase();
      if (namePatterns.some((p) => name.includes(p))) {
        return i + 1;
      }
    }
  }
  return null; // Not found
}

// ──────────────────────────────────────────────────────────────────────────────
// Build EvalResult from Response
// ──────────────────────────────────────────────────────────────────────────────

export function buildEvalResult(
  fixture: EvalFixture,
  response: FindSkillResponse,
  latencyMs: number
): EvalResult {
  const rank = findSkillRank(response, fixture.expectedSkillId, fixture.acceptableSkillIds, fixture.acceptableNamePatterns);

  // Detect unknown competitors: rank 1 result is NOT in the acceptable set
  let unknownCompetitor: EvalResult['unknownCompetitor'] = null;
  if (rank !== null && rank > 1 && response.results.length > 0) {
    const topResult = response.results[0];
    const validIds = new Set([fixture.expectedSkillId, ...(fixture.acceptableSkillIds ?? [])]);
    const namePatterns = (fixture.acceptableNamePatterns ?? []).map((p) => p.toLowerCase());
    const nameMatch = namePatterns.some((p) => (topResult.name || '').toLowerCase().includes(p));
    if (!validIds.has(topResult.id) && !nameMatch) {
      unknownCompetitor = { id: topResult.id, name: topResult.name, score: topResult.score };
    }
  }

  return {
    fixture,
    response,
    correctSkillRank: rank,
    foundInTop5: rank !== null && rank <= 5,
    foundInTop1: rank !== null && rank === 1,
    latencyMs,
    unknownCompetitor,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Format Metrics for Display
// ──────────────────────────────────────────────────────────────────────────────

export function formatMetrics(metrics: EvalMetrics): string {
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════════════════');
  lines.push('  EVAL METRICS');
  lines.push('═══════════════════════════════════════════════════════');
  lines.push('');

  // Overall metrics
  lines.push('Overall Performance:');
  lines.push(`  Recall@1:       ${(metrics.recall1 * 100).toFixed(1)}%`);
  lines.push(`  Recall@5:       ${(metrics.recall5 * 100).toFixed(1)}%`);
  lines.push(`  MRR:            ${metrics.mrr.toFixed(3)}`);
  lines.push(`  Avg Top Score:  ${metrics.avgTopScore.toFixed(3)}`);
  lines.push('');

  // Tier distribution
  const total =
    metrics.tierDistribution[1] +
    metrics.tierDistribution[2] +
    metrics.tierDistribution[3];

  lines.push('Tier Distribution:');
  lines.push(
    `  Tier 1 (High):   ${metrics.tierDistribution[1]} (${((metrics.tierDistribution[1] / total) * 100).toFixed(1)}%)`
  );
  lines.push(
    `  Tier 2 (Med):    ${metrics.tierDistribution[2]} (${((metrics.tierDistribution[2] / total) * 100).toFixed(1)}%)`
  );
  lines.push(
    `  Tier 3 (Low):    ${metrics.tierDistribution[3]} (${((metrics.tierDistribution[3] / total) * 100).toFixed(1)}%)`
  );
  lines.push('');

  // Per-tier accuracy
  lines.push('Accuracy Per Tier (correct @ rank 1):');
  for (const tier of [1, 2, 3] as const) {
    const ta = metrics.tierAccuracy[tier];
    if (ta.total > 0) {
      lines.push(
        `  Tier ${tier}: ${ta.correct}/${ta.total} (${(ta.accuracy * 100).toFixed(1)}%)`
      );
    } else {
      lines.push(`  Tier ${tier}: n/a (0 queries)`);
    }
  }
  lines.push('');

  // Latency by tier
  lines.push('Latency Per Tier (ms):');
  for (const tier of [1, 2, 3] as const) {
    const lt = metrics.latencyByTier[tier];
    if (metrics.tierDistribution[tier] > 0) {
      lines.push(
        `  Tier ${tier}: p50=${lt.p50.toFixed(0)}  p95=${lt.p95.toFixed(0)}  p99=${lt.p99.toFixed(0)}`
      );
    } else {
      lines.push(`  Tier ${tier}: n/a`);
    }
  }
  lines.push('');

  // LLM fallback lift
  lines.push('LLM Fallback Lift:');
  const t2 = metrics.llmFallbackLift.tier2;
  const t3 = metrics.llmFallbackLift.tier3;
  lines.push(
    `  Tier 2: ${t2.total} queries, ${t2.enrichedImproved} enriched+correct (lift: ${(t2.liftRate * 100).toFixed(1)}%)`
  );
  lines.push(
    `  Tier 3: ${t3.total} queries, ${t3.enrichedImproved} enriched+correct (lift: ${(t3.liftRate * 100).toFixed(1)}%)`
  );
  lines.push('');

  // Match source distribution (Phase 3)
  const sources = Object.keys(metrics.matchSourceDistribution).sort();
  if (sources.length > 0) {
    lines.push('Match Source Distribution:');
    for (const source of sources) {
      const sd = metrics.matchSourceDistribution[source];
      const r1Pct = sd.count > 0 ? ((sd.correctAtRank1 / sd.count) * 100).toFixed(0) : '0';
      lines.push(
        `  ${source.padEnd(16)} — ${sd.count} queries (${((sd.count / total) * 100).toFixed(0)}%), R@1: ${r1Pct}%, avg: ${sd.avgScore.toFixed(3)}`
      );
    }
    lines.push('');
  }

  // Per-pattern breakdown
  lines.push('By Pattern:');
  const patterns = Object.keys(metrics.byPattern).sort();

  for (const pattern of patterns) {
    const patternMetrics = metrics.byPattern[pattern];
    lines.push(
      `  ${pattern.padEnd(12)} — Recall@5: ${(patternMetrics.recall5 * 100).toFixed(1)}%  MRR: ${patternMetrics.mrr.toFixed(3)}`
    );
  }

  lines.push('═══════════════════════════════════════════════════════');

  return lines.join('\n');
}
