// ══════════════════════════════════════════════════════════════════════════════
// Eval Runner — Execute Eval Suite Against Live Endpoint
// ══════════════════════════════════════════════════════════════════════════════
//
// Runs the eval suite by:
// 1. Loading fixtures
// 2. Executing each query against the search endpoint
// 3. Computing metrics (Recall@1, Recall@5, MRR)
// 4. Returning results with run ID
//
// Can be run via:
// - API endpoint: POST /v1/eval/run
// - CLI script: npm run eval
//
// ══════════════════════════════════════════════════════════════════════════════

import type {
  FindSkillRequest,
  FindSkillResponse,
} from '@skillsregistry/domain';
import { evalFixtures, validateFixtures } from './fixtures.js';
import {
  computeMetrics,
  buildEvalResult,
  formatMetrics,
  type EvalMetrics,
  type EvalResult,
} from './metrics.js';

// ──────────────────────────────────────────────────────────────────────────────
// Eval Run Result
// ──────────────────────────────────────────────────────────────────────────────

export interface EvalRunResult {
  runId: string;
  timestamp: string;
  metrics: EvalMetrics;
  fixtureCount: number;
  passed: number;
  failed: number;
  results: EvalResult[];
  errors: string[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Run Eval Suite
// ──────────────────────────────────────────────────────────────────────────────

export interface RunEvalOptions {
  /** Max results per query (default 10). */
  limit?: number;
  /** Log per-fixture progress. */
  verbose?: boolean;
  /**
   * Extra headers to attach to every search request. Typical use:
   * `{ Authorization: 'Bearer …', 'X-Tenant-Id': 'default' }` — enables
   * running the eval against protected endpoints (pre-prod, staging,
   * private tenants) without leaking auth into the URL.
   */
  headers?: Record<string, string>;
}

export async function runEvalSuite(
  searchEndpoint: string,
  tenantId: string,
  options?: RunEvalOptions
): Promise<EvalRunResult> {
  const runId = `eval-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const timestamp = new Date().toISOString();
  const limit = options?.limit ?? 10;
  const verbose = options?.verbose ?? false;
  const extraHeaders = options?.headers ?? {};

  // Ensure endpoint has /v1/search path
  if (!searchEndpoint.endsWith('/v1/search')) {
    searchEndpoint = searchEndpoint.replace(/\/$/, '') + '/v1/search';
  }

  // Validate fixtures
  const validation = validateFixtures();
  if (!validation.valid) {
    return {
      runId,
      timestamp,
      metrics: {
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
      },
      fixtureCount: 0,
      passed: 0,
      failed: 0,
      results: [],
      errors: validation.errors,
    };
  }

  if (verbose) {
    console.log(`\n🔍 Running eval suite (${evalFixtures.length} fixtures)...`);
    console.log(`Run ID: ${runId}`);
    console.log(`Endpoint: ${searchEndpoint}\n`);
  }

  // Execute each fixture
  const results: EvalResult[] = [];
  const errors: string[] = [];

  for (let i = 0; i < evalFixtures.length; i++) {
    const fixture = evalFixtures[i];

    if (verbose) {
      process.stdout.write(
        `[${i + 1}/${evalFixtures.length}] ${fixture.pattern.padEnd(12)} — ${fixture.query.slice(0, 50)}...`
      );
    }

    try {
      const queryStart = Date.now();
      const response = await executeQuery(
        searchEndpoint,
        {
          query: fixture.query,
          tenantId,
          limit,
        },
        extraHeaders,
      );
      const latencyMs = Date.now() - queryStart;

      const result = buildEvalResult(fixture, response, latencyMs);
      results.push(result);

      if (verbose) {
        const status = result.foundInTop1
          ? '✅ Rank 1'
          : result.foundInTop5
            ? `⚠️  Rank ${result.correctSkillRank}`
            : '❌ Not found';
        const competitorNote = result.unknownCompetitor
          ? ` [NEW: ${result.unknownCompetitor.name} (${result.unknownCompetitor.id.slice(0, 8)})]`
          : '';
        console.log(` ${status} (${latencyMs}ms, T${result.response.meta.tier})${competitorNote}`);
      }
    } catch (error) {
      const errorMsg = `Fixture ${fixture.id} failed: ${(error as Error).message}`;
      errors.push(errorMsg);

      if (verbose) {
        console.log(` ❌ Error`);
      }
    }
  }

  // Compute metrics
  const metrics = computeMetrics(results);

  const passed = results.filter((r) => r.foundInTop5).length;
  const failed = results.length - passed;

  if (verbose) {
    console.log('\n' + formatMetrics(metrics));
  }

  return {
    runId,
    timestamp,
    metrics,
    fixtureCount: evalFixtures.length,
    passed,
    failed,
    results,
    errors,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Execute Single Query
// ──────────────────────────────────────────────────────────────────────────────

async function executeQuery(
  endpoint: string,
  request: FindSkillRequest,
  extraHeaders: Record<string, string> = {},
): Promise<FindSkillResponse> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(
      `Search request failed: ${response.status} ${response.statusText}`
    );
  }

  return (await response.json()) as FindSkillResponse;
}

// ──────────────────────────────────────────────────────────────────────────────
// Format Summary for CLI
// ──────────────────────────────────────────────────────────────────────────────

export function formatSummary(result: EvalRunResult): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════');
  lines.push('  EVAL RUN SUMMARY');
  lines.push('═══════════════════════════════════════════════════════');
  lines.push('');
  lines.push(`Run ID:       ${result.runId}`);
  lines.push(`Timestamp:    ${result.timestamp}`);
  lines.push(`Fixtures:     ${result.fixtureCount}`);
  lines.push(`Passed:       ${result.passed} (${((result.passed / result.fixtureCount) * 100).toFixed(1)}%)`);
  lines.push(`Failed:       ${result.failed} (${((result.failed / result.fixtureCount) * 100).toFixed(1)}%)`);

  // Unknown competitors — new skills that outranked expected results
  const unknowns = result.results.filter((r) => r.unknownCompetitor);
  if (unknowns.length > 0) {
    lines.push('');
    lines.push(`New Competitors (${unknowns.length} — add to acceptableSkillIds if legitimate):`);
    for (const r of unknowns) {
      const uc = r.unknownCompetitor!;
      lines.push(`  ${r.fixture.id} "${r.fixture.query.slice(0, 40)}..."`);
      lines.push(`    Rank 1: ${uc.name} (${uc.id})`);
      lines.push(`    Expected at rank ${r.correctSkillRank}: ${r.fixture.expectedSkillId}`);
    }
  }

  if (result.errors.length > 0) {
    lines.push('');
    lines.push('Errors:');
    for (const error of result.errors) {
      lines.push(`  - ${error}`);
    }
  }

  lines.push('');
  lines.push(formatMetrics(result.metrics));

  return lines.join('\n');
}

// ──────────────────────────────────────────────────────────────────────────────
// Failed Queries Report
// ──────────────────────────────────────────────────────────────────────────────

export function getFailedQueries(result: EvalRunResult): EvalResult[] {
  return result.results.filter((r) => !r.foundInTop5);
}

export function formatFailedQueries(result: EvalRunResult): string {
  const failed = getFailedQueries(result);

  if (failed.length === 0) {
    return '✅ All queries passed (found in top 5)!';
  }

  const lines: string[] = [];

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════');
  lines.push(`  FAILED QUERIES (${failed.length})`);
  lines.push('═══════════════════════════════════════════════════════');
  lines.push('');

  for (const result of failed) {
    lines.push(`ID:       ${result.fixture.id}`);
    lines.push(`Pattern:  ${result.fixture.pattern}`);
    lines.push(`Query:    ${result.fixture.query}`);
    lines.push(`Expected: ${result.fixture.expectedSkillId}`);
    lines.push(`Rank:     ${result.correctSkillRank ?? 'Not found'}`);
    lines.push(`Tier:     ${result.response.meta.tier}`);

    if (result.response.results.length > 0) {
      lines.push('Top results:');
      for (let i = 0; i < Math.min(3, result.response.results.length); i++) {
        const r = result.response.results[i];
        lines.push(
          `  ${i + 1}. ${r.name} (${r.id}) — score: ${r.score.toFixed(3)}`
        );
      }
    } else {
      lines.push('No results returned');
    }

    lines.push('');
  }

  lines.push('═══════════════════════════════════════════════════════');

  return lines.join('\n');
}
