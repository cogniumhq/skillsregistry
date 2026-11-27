// ════════════════════════════════════════════════════════════════════════════
// bump-listing-version — server.json version bump, prepare only (#115)
// ════════════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bumpServerJson, bumpServerJsonFile } from './bump-listing-version.mts';

const SERVER_JSON = `{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.cogniumhq/skillsregistry",
  "version": "6.7.0",
  "remotes": [
    {
      "type": "streamable-http",
      "url": "https://api.skillsregistry.net/mcp"
    }
  ]
}
`;

describe('bumpServerJson', () => {
  it('sets the version and leaves every other field and the layout alone', () => {
    const out = bumpServerJson(SERVER_JSON, '6.7.1');
    expect(out).toBe(SERVER_JSON.replace('"version": "6.7.0"', '"version": "6.7.1"'));
    expect(JSON.parse(out).remotes).toEqual(JSON.parse(SERVER_JSON).remotes);
  });

  it('accepts a prerelease version', () => {
    expect(JSON.parse(bumpServerJson(SERVER_JSON, '7.0.0-rc.1')).version).toBe('7.0.0-rc.1');
  });

  it('rejects a version that is not exact semver', () => {
    for (const bad of ['', 'v6.7.1', '6.7', '^6.7.1', 'latest', '6.7.1 ']) {
      expect(() => bumpServerJson(SERVER_JSON, bad)).toThrow(/semver/);
    }
  });

  it('rejects a no-op bump', () => {
    expect(() => bumpServerJson(SERVER_JSON, '6.7.0')).toThrow(/already/);
  });

  it('rejects a server.json with no version field', () => {
    expect(() => bumpServerJson('{ "name": "x" }\n', '6.7.1')).toThrow(/version/);
  });
});

describe('bumpServerJsonFile', () => {
  it('rewrites the file in place and returns the old and new versions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bump-listing-'));
    try {
      const path = join(dir, 'server.json');
      writeFileSync(path, SERVER_JSON);
      expect(bumpServerJsonFile(path, '6.8.0')).toEqual({ from: '6.7.0', to: '6.8.0' });
      expect(JSON.parse(readFileSync(path, 'utf8')).version).toBe('6.8.0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
