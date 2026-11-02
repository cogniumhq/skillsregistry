// Claude Code plugin marketplace manifest (#203)

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

const readJson = (relative: string) =>
  JSON.parse(readFileSync(resolve(repoRoot, relative), 'utf-8')) as Record<
    string,
    unknown
  >;

describe('Claude plugin marketplace (#203)', () => {
  it('declares a marketplace entry for the root skillsregistry plugin', () => {
    const plugin = readJson('.claude-plugin/plugin.json') as {
      name: string;
      version: string;
      description: string;
    };
    const marketplace = readJson('.claude-plugin/marketplace.json') as {
      name: string;
      owner: { name: string };
      plugins: Array<{ name: string; source: string; version?: string }>;
    };

    expect(marketplace.owner?.name).toBeTruthy();
    expect(marketplace.plugins).toHaveLength(1);
    const entry = marketplace.plugins[0];
    expect(entry.name).toBe(plugin.name);
    expect(entry.source).toBe('./');
    expect(entry.version).toBe(plugin.version);
    expect(marketplace.name).toBe('skillsregistry');
  });
});
