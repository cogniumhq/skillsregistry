// ══════════════════════════════════════════════════════════════════════════════
// CI workflow least-privilege token pin (#169)
// ══════════════════════════════════════════════════════════════════════════════
//
// `build` and `changeset-check` had no job-level `permissions:` and inherited
// the repository default GITHUB_TOKEN scope. Workflow-level `contents: read`
// narrows every job that does not declare its own permissions block.
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ciWorkflow = readFileSync(
  resolve(here, '../../../../.github/workflows/ci.yml'),
  'utf-8',
);

describe('CI workflow permissions (#169)', () => {
  it('declares workflow-level contents: read for least-privilege GITHUB_TOKEN', () => {
    expect(ciWorkflow).toMatch(
      /^permissions:\s*\n\s*contents:\s*read\s*$/m,
    );
  });
});
