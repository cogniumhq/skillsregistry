// ══════════════════════════════════════════════════════════════════════════════
// README operator guidance pins (#173, #174)
// ══════════════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const readme = readFileSync(resolve(here, '../../README.md'), 'utf-8');
const compose = readFileSync(resolve(here, '../../docker-compose.yml'), 'utf-8');

describe('README backup and restore (#173)', () => {
  it('documents backup, restore, and destructive down -v', () => {
    expect(readme).toContain('## Backup and restore');
    expect(readme).toContain('pg_dump -U skillsregistry -d skillsregistry');
    expect(readme).toContain('pg_restore -U skillsregistry -d skillsregistry');
    expect(readme).toContain('down -v` deletes them permanently');
  });
});

describe('README abuse and cost controls (#174)', () => {
  it('documents loopback bind, proxy admin caveat, and upstream rate limits', () => {
    expect(readme).toContain('## Abuse and cost controls');
    expect(readme).toContain('APP_BIND=0.0.0.0');
    expect(readme).toMatch(/do not proxy[\s\S]*\/v1\/admin\/\*/i);
    expect(readme).toContain('ADMIN_REQUIRE_TOKEN=true');
    expect(readme).toContain('X-RateLimit-*');
    expect(readme).toContain('Retry-After');
  });
});

describe('docker-compose volume wipe warning (#173)', () => {
  it('points operators at README backup section', () => {
    expect(compose).toMatch(/down -v.*Backup and restore/s);
  });
});
