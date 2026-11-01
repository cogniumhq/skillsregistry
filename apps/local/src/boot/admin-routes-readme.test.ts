// ══════════════════════════════════════════════════════════════════════════════
// README admin/migrate route coverage pin (#171)
// ══════════════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Canonical paths — keep in sync with the header comment in routes/admin.ts */
const DOCUMENTED_ADMIN_PATHS: readonly string[] = [
  '/v1/admin/budget',
  '/v1/admin/budget/refresh',
  '/v1/admin/reindex',
  '/v1/admin/health',
  '/v1/admin/skills',
  '/v1/admin/skills/:id',
  '/v1/migrate/publish',
];

describe('README admin routes (#171)', () => {
  const readme = readFileSync(
    resolve(here, '../../README.md'),
    'utf-8',
  );

  it('documents every admin and migrate route path', () => {
    const missing: string[] = [];
    for (const path of DOCUMENTED_ADMIN_PATHS) {
      if (!readme.includes(path)) {
        missing.push(path);
      }
    }
    expect(missing).toEqual([]);
  });
});
