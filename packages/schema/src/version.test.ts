// ══════════════════════════════════════════════════════════════════════════════
// SCHEMA_VERSION — must equal the highest bundled migration file number
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SCHEMA_VERSION } from './version.js';
import { loadBundledMigrations } from './runner.js';

describe('SCHEMA_VERSION', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(SCHEMA_VERSION)).toBe(true);
    expect(SCHEMA_VERSION).toBeGreaterThan(0);
  });

  it('matches the highest bundled migration file number', async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const files = (await readdir(join(here, 'migrations')))
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const highest = files
      .map((f) => {
        const m = f.match(/^(\d+)_/);
        return m ? parseInt(m[1]!, 10) : -1;
      })
      .reduce((a, b) => Math.max(a, b), -1);
    expect(SCHEMA_VERSION).toBe(highest);
  });

  it('matches the last version returned by loadBundledMigrations()', async () => {
    const migrations = await loadBundledMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    const last = migrations[migrations.length - 1]!;
    expect(SCHEMA_VERSION).toBe(last.version);
  });
});
