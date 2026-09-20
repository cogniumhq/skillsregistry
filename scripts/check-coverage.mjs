#!/usr/bin/env node
// Read the merged vitest v8 `coverage/coverage-summary.json` (workspace
// root) and enforce the same modest overall floor as vitest.config.ts.
//
// Thresholds (overall, across packages/* + apps/local + apps/local/web):
//   lines      >= 50%
//   statements >= 50%
//   functions  >= 45%
//   branches   >= 40%
//
// Measured 2026-09-20 on main (`pnpm test:coverage`): ~69% lines/stmts,
// ~77% functions, ~86% branches. The floor sits below those totals so a
// few new files cannot red CI. Bump the numbers here, in vitest.config.ts,
// and in CONTRIBUTING.md together.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const summaryPath = join(root, "coverage", "coverage-summary.json");

const THRESHOLDS = {
  lines: 50,
  statements: 50,
  functions: 45,
  branches: 40,
};

if (!existsSync(summaryPath)) {
  console.error(
    `Missing ${summaryPath}. Run \`pnpm test:coverage\` first (root vitest.config.ts must emit json-summary).`,
  );
  process.exit(1);
}

const summary = JSON.parse(await readFile(summaryPath, "utf8"));
const total = summary.total;
if (!total) {
  console.error(`coverage-summary.json has no "total" key: ${summaryPath}`);
  process.exit(1);
}

const pct = (metric) => {
  if (!metric || !metric.total) return 0;
  return (100 * metric.covered) / metric.total;
};

console.log("Overall coverage (vitest v8 json-summary)\n");
const failures = [];
for (const [key, floor] of Object.entries(THRESHOLDS)) {
  const actual = pct(total[key]);
  const ok = actual + Number.EPSILON >= floor;
  const covered = total[key]?.covered ?? 0;
  const denom = total[key]?.total ?? 0;
  console.log(
    `  ${key.padEnd(11)} ${actual.toFixed(1).padStart(5)}%  (${covered}/${denom})  floor ${floor}%  ${ok ? "ok" : "FAIL"}`,
  );
  if (!ok) {
    failures.push(`${key} ${actual.toFixed(1)}% is below the ${floor}% overall floor`);
  }
}

if (failures.length > 0) {
  console.error(`\nCoverage gate failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log(
  "\nCoverage gate passed (overall floor: lines/statements ≥50%, functions ≥45%, branches ≥40%).",
);
