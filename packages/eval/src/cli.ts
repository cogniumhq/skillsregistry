#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// Eval Suite CLI
// ══════════════════════════════════════════════════════════════════════════════
//
// Ships as the `skillsregistry-eval` binary from `@skillsregistry/eval`.
// Runs the fixture suite against any /v1/search endpoint (mothership,
// local node, staging) and prints Recall@1 / Recall@5 / MRR.
//
// Usage:
//   npx @skillsregistry/eval --endpoint https://api.skillsregistry.net
//   skillsregistry-eval --endpoint http://localhost:8787 --auth "Bearer …"
//   skillsregistry-eval --header "X-Tenant-Id: default" --header "X-Env: prod"
//
// Exit codes:
//   0 = success rate ≥ 0.5 (warnings for < 0.8)
//   1 = success rate < 0.5, invalid args, or fatal error
//
// ══════════════════════════════════════════════════════════════════════════════

import { runEvalSuite, formatSummary, formatFailedQueries } from './runner.js';
import { getFixtureStats } from './fixtures.js';

interface CliOptions {
  endpoint: string;
  tenantId: string;
  limit: number;
  verbose: boolean;
  showFailed: boolean;
  headers: Record<string, string>;
  minRecall5?: number;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    endpoint: 'http://localhost:8787/v1/search',
    tenantId: 'eval-tenant',
    limit: 10,
    verbose: false,
    showFailed: false,
    headers: {},
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--endpoint':
      case '-e':
        options.endpoint = requireValue(argv, ++i, arg);
        break;
      case '--tenant':
      case '-t':
        options.tenantId = requireValue(argv, ++i, arg);
        break;
      case '--limit':
      case '-l': {
        const raw = requireValue(argv, ++i, arg);
        const n = Number.parseInt(raw, 10);
        if (!Number.isFinite(n) || n <= 0) {
          fail(`--limit expected a positive integer, got "${raw}"`);
        }
        options.limit = n;
        break;
      }
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--show-failed':
      case '-f':
        options.showFailed = true;
        break;
      case '--auth':
      case '-a': {
        // --auth "Bearer …" → Authorization: Bearer …
        const raw = requireValue(argv, ++i, arg);
        options.headers.Authorization = raw;
        break;
      }
      case '--header':
      case '-H': {
        // --header "Name: Value"
        const raw = requireValue(argv, ++i, arg);
        const idx = raw.indexOf(':');
        if (idx <= 0) {
          fail(`--header expected "Name: Value", got "${raw}"`);
        }
        const name = raw.slice(0, idx).trim();
        const value = raw.slice(idx + 1).trim();
        if (!name) {
          fail(`--header name empty in "${raw}"`);
        }
        options.headers[name] = value;
        break;
      }
      case '--min-recall5': {
        const raw = requireValue(argv, ++i, arg);
        const n = Number.parseFloat(raw);
        if (!Number.isFinite(n) || n < 0 || n > 1) {
          fail(`--min-recall5 expected a number between 0 and 1, got "${raw}"`);
        }
        options.minRecall5 = n;
        break;
      }
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        fail(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function requireValue(
  argv: readonly string[],
  idx: number,
  flag: string,
): string {
  const value = argv[idx];
  if (value === undefined) {
    fail(`${flag} expected a value`);
  }
  return value as string;
}

function fail(message: string): never {
  console.error(message);
  printHelp();
  process.exit(1);
}

function printHelp(): void {
  console.log(`
SkillsRegistry Search — Eval Suite CLI

Usage:
  skillsregistry-eval [options]

Options:
  -e, --endpoint <url>       Search endpoint URL — either the base host
                             (https://api.skillsregistry.net) or the
                             fully-qualified /v1/search path. The runner
                             appends /v1/search if omitted.
                             Default: http://localhost:8787/v1/search
  -t, --tenant <id>          Tenant ID sent in the request body.
                             Default: eval-tenant
  -l, --limit <n>            Max results per query (default: 10)
  -a, --auth <value>         Set Authorization header (e.g. "Bearer …")
  -H, --header "Name: Value" Set an arbitrary request header. Repeatable.
                             Typical: --header "X-Tenant-Id: default"
  -v, --verbose              Log per-fixture progress
  -f, --show-failed          Show detailed report of failed queries
      --min-recall5 <rate>   Fail when Recall@5 is below this rate (0..1).
                             Default: 0.5 for exit code 1; warnings still at 0.8.
  -h, --help                 Show this help

Examples:
  skillsregistry-eval --endpoint https://api.skillsregistry.net
  skillsregistry-eval -e http://localhost:8787/v1/search -v -f
  skillsregistry-eval -e https://staging.example.com \\
    -a "Bearer $STAGING_TOKEN" -H "X-Tenant-Id: eval"
`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║      SKILLSREGISTRY SEARCH — EVAL SUITE RUNNER       ║');
  console.log('╚═══════════════════════════════════════════════════════╝');

  const stats = getFixtureStats();
  console.log('\nFixture Stats:');
  console.log(`  Total:          ${stats.total}`);
  console.log(`  Unique skills:  ${stats.uniqueSkills}`);
  console.log(`  By pattern:`);
  for (const [pattern, count] of Object.entries(stats.byPattern)) {
    console.log(`    ${pattern.padEnd(12)} ${count}`);
  }

  const headerNames = Object.keys(options.headers);
  console.log('\nConfiguration:');
  console.log(`  Endpoint:       ${options.endpoint}`);
  console.log(`  Tenant ID:      ${options.tenantId}`);
  console.log(`  Limit:          ${options.limit}`);
  console.log(`  Verbose:        ${options.verbose}`);
  console.log(
    `  Extra headers:  ${headerNames.length === 0 ? '(none)' : headerNames.join(', ')}`,
  );

  try {
    const result = await runEvalSuite(options.endpoint, options.tenantId, {
      limit: options.limit,
      verbose: options.verbose,
      headers: options.headers,
    });

    console.log(formatSummary(result));

    if (options.showFailed && result.failed > 0) {
      console.log(formatFailedQueries(result));
    }

    const successRate = result.passed / result.fixtureCount;
    const failThreshold = options.minRecall5 ?? 0.5;
    const warnThreshold = Math.max(failThreshold, 0.8);

    if (successRate < failThreshold) {
      console.log(
        `\n❌ Eval failed: Recall@5 ${(successRate * 100).toFixed(1)}% < ${(failThreshold * 100).toFixed(1)}%`,
      );
      process.exit(1);
    } else if (successRate < warnThreshold) {
      console.log(
        `\n⚠️  Eval passed with warnings: Recall@5 ${(successRate * 100).toFixed(1)}% < ${(warnThreshold * 100).toFixed(1)}%`,
      );
      process.exit(0);
    } else {
      console.log(
        `\n✅ Eval passed: Recall@5 ${(successRate * 100).toFixed(1)}% >= ${(warnThreshold * 100).toFixed(1)}%`,
      );
      process.exit(0);
    }
  } catch (error) {
    console.error('\n❌ Eval suite failed:');
    console.error((error as Error).message);
    console.error((error as Error).stack);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
