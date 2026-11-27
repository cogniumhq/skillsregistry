#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// bump-listing-version.mts — set the official-registry listing version
// ════════════════════════════════════════════════════════════════════════════
//
//   node scripts/bump-listing-version.mts 6.7.1
//
// The hosted MCP server ships from another repository, so its version moves
// without a change here. `pnpm validate:listings` (nightly) fails as soon as
// the live `serverInfo.version` and the root `server.json` disagree; this
// script is the first step of fixing that.
//
// It only edits `server.json`. It does not publish. Re-publishing to the
// official MCP Registry with `mcp-publisher` is the listing owner's step; see
// docs/listings/README.md ("Version bump and republish").
//
// Only the top-level `version` line changes, so the diff stays one line.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Exact semver 2.0.0: no `v` prefix, no range operators.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

// The top-level field sits at two-space indent; nested `version` keys
// (e.g. under `packages`) are deeper and are left alone.
const TOP_LEVEL_VERSION = /^( {2}"version":\s*)"[^"]*"/m;

export function bumpServerJson(text: string, version: string): string {
  if (!SEMVER.test(version)) {
    throw new Error(`Not an exact semver version: ${JSON.stringify(version)}`);
  }
  const current = (JSON.parse(text) as { version?: unknown }).version;
  if (typeof current !== 'string' || !TOP_LEVEL_VERSION.test(text)) {
    throw new Error('server.json has no top-level "version" field');
  }
  if (current === version) {
    throw new Error(`server.json is already at ${version}`);
  }
  return text.replace(TOP_LEVEL_VERSION, `$1${JSON.stringify(version)}`);
}

export function bumpServerJsonFile(
  path: string,
  version: string,
): { from: string; to: string } {
  const text = readFileSync(path, 'utf8');
  const from = (JSON.parse(text) as { version: string }).version;
  writeFileSync(path, bumpServerJson(text, version));
  return { from, to: version };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2];
  if (!version) {
    console.error('usage: node scripts/bump-listing-version.mts <version>');
    process.exit(2);
  }
  const path = fileURLToPath(new URL('../server.json', import.meta.url));
  try {
    const { from, to } = bumpServerJsonFile(path, version);
    console.log(`server.json: ${from} -> ${to}`);
    console.log('Next: pnpm validate:listings, then the owner runs mcp-publisher publish.');
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
