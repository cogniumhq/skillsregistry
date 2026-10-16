// ══════════════════════════════════════════════════════════════════════════════
// .env.example coverage pin (#171)
// ══════════════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_ENV_VARS } from '../config.js';

const here = dirname(fileURLToPath(import.meta.url));
const envExample = readFileSync(
  resolve(here, '../../.env.example'),
  'utf-8',
);

describe('.env.example (#171)', () => {
  it('documents every env var read by config.ts', () => {
    const missing: string[] = [];
    for (const name of CONFIG_ENV_VARS) {
      const pattern = new RegExp(`^(#\\s*)?${name}=`, 'm');
      if (!pattern.test(envExample)) {
        missing.push(name);
      }
    }
    expect(missing).toEqual([]);
  });
});
