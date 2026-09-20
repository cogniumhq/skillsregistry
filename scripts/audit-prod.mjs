#!/usr/bin/env node
// Production dependency audit gate.
//
// Runs `pnpm audit --prod --json` and fails the process only when a
// **high** or **critical** advisory is present and not in the ignore
// list below. Low/moderate findings are printed and ignored.
//
// The ignore list is the set of high/critical GHSAs present on 2026-09-20
// that cannot be cleared without a dedicated upgrade PR:
//   - astro 5 → 6/7 (static admin UI; several advisories patched only on 6.x/7.x)
//   - drizzle-orm 0.36 → 0.45 (SQL identifier escaping)
//   - in-range transitives of the Astro/Vite build graph (sharp, js-yaml,
//     nanoid@3, postcss, svgo, smol-toml)
// New high/critical GHSAs must NOT be added here to silence a red build —
// fix them or open a tracked upgrade. Remove an ID once the upgrade lands.

import { spawnSync } from "node:child_process";

const FAIL_SEVERITIES = new Set(["high", "critical"]);

/** @type {Record<string, string>} */
const IGNORE = {
  "GHSA-26w7-cxv4-gfx2":
    "astro AVIF RCE — patched in astro >=7.2.8; we are on 5.x (static admin UI)",
  "GHSA-2pvr-wf23-7pc7":
    "astro Host-header SSRF — patched in astro >=6.4.6; we are on 5.x",
  "GHSA-8hv8-536x-4wqp":
    "astro slot-name XSS — patched in astro >=6.3.3; we are on 5.x",
  "GHSA-gpj5-g38j-94v9":
    "drizzle-orm SQL identifier injection — patched in >=0.45.2; we are on 0.36.x",
  "GHSA-f88m-g3jw-g9cj":
    "sharp/libvips — patched in sharp >=0.35.0; pulled in by astro 5.x",
  "GHSA-rgj7-g3m4-5g8c":
    "sharp/libheif — patched in sharp >=0.35.4; pulled in by astro 5.x",
  "GHSA-5p4m-2wfm-xmqj":
    "js-yaml !!omap — patched in >=4.3.1; transitive of astro 5.x",
  "GHSA-2883-xcg3-v3hh":
    "js-yaml merge keys — patched in >=4.3.2; transitive of astro 5.x",
  "GHSA-28wg-ghj8-5hjv":
    "nanoid@3 negative size — patched in >=3.3.16; transitive of vite/postcss",
  "GHSA-2v37-7h3g-55p8":
    "nanoid@3 zero size — patched in >=3.3.18; transitive of vite/postcss",
  "GHSA-r28c-9q8g-f849":
    "postcss source map path traversal — patched in >=8.5.18; transitive of vite",
  "GHSA-2p49-hgcm-8545":
    "svgo removeScripts — patched in >=4.0.2; transitive of astro 5.x",
  "GHSA-w27v-7q3p-w38r":
    "svgo namespace bypass — patched in >=4.1.0; transitive of astro 5.x",
  "GHSA-7w5x-hrqm-74c2":
    "smol-toml DoS — patched in >=1.7.1; transitive of astro 5.x",
};

const result = spawnSync("pnpm", ["audit", "--prod", "--json"], {
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});

// pnpm audit exits 1 when any advisory exists; we decide the gate ourselves.
if (result.error) {
  console.error(`pnpm audit failed to start: ${result.error.message}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(result.stdout || "{}");
} catch (err) {
  console.error("pnpm audit --json produced invalid JSON");
  console.error(result.stderr || result.stdout);
  process.exit(1);
}

const advisories = Object.values(report.advisories ?? {});
const counts = report.metadata?.vulnerabilities ?? {};
console.log(
  `Production audit: ${counts.critical ?? 0} critical, ${counts.high ?? 0} high, ${counts.moderate ?? 0} moderate, ${counts.low ?? 0} low.`,
);
console.log(
  "Gate: fail on high/critical only (low/moderate do not fail). See CONTRIBUTING.md.",
);

const failing = [];
const ignored = [];
const informational = [];

for (const adv of advisories) {
  const id = adv.github_advisory_id ?? `id-${adv.id}`;
  const row = {
    id,
    severity: adv.severity,
    module: adv.module_name,
    title: adv.title,
  };
  if (!FAIL_SEVERITIES.has(adv.severity)) {
    informational.push(row);
    continue;
  }
  if (IGNORE[id]) {
    ignored.push({ ...row, reason: IGNORE[id] });
    continue;
  }
  failing.push(row);
}

if (informational.length > 0) {
  console.log(`\nLow/moderate (not failing): ${informational.length}`);
  for (const row of informational) {
    console.log(`  - ${row.severity} ${row.id} ${row.module}: ${row.title}`);
  }
}

if (ignored.length > 0) {
  console.log(`\nHigh/critical ignored (tracked upgrades, not this gate):`);
  for (const row of ignored) {
    console.log(`  - ${row.severity} ${row.id} ${row.module}: ${row.reason}`);
  }
}

if (failing.length > 0) {
  console.error(`\nHigh/critical production advisories (failing the gate):`);
  for (const row of failing) {
    console.error(`  - ${row.severity} ${row.id} ${row.module}: ${row.title}`);
  }
  process.exit(1);
}

console.log(
  "\nProduction audit gate passed (no new high/critical advisories).",
);
