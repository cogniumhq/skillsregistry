// ══════════════════════════════════════════════════════════════════════════════
// Dockerfile HEALTHCHECK regression pin (#103)
// ══════════════════════════════════════════════════════════════════════════════
//
// The container was reported `unhealthy` while serving fine. Alpine's
// /etc/hosts maps `localhost` to BOTH `127.0.0.1` and `::1`; BusyBox wget tries
// the IPv6 record first; the app binds IPv4 only (`HOST=0.0.0.0`). The probe
// therefore got "can't connect to remote host: Connection refused".
//
// Verified in a `node:22-alpine` container against an IPv4-only listener:
//   wget --spider http://localhost:3000/   → FAIL (Connection refused)
//   wget --spider http://127.0.0.1:3000/   → PASS
//
// These assertions are cheap and pin the exact defect: a future edit that
// reintroduces `localhost` in the probe fails here rather than in an operator's
// `docker compose ps`.
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dockerfile = readFileSync(resolve(here, '../../Dockerfile'), 'utf-8');

/** The `HEALTHCHECK ... CMD ...` instruction, line continuations folded. */
function healthcheckInstruction(text: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trimStart().startsWith('HEALTHCHECK'));
  expect(start, 'Dockerfile must declare a HEALTHCHECK').toBeGreaterThanOrEqual(0);

  const parts: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    parts.push(line.replace(/\\\s*$/, '').trim());
    if (!/\\\s*$/.test(line)) break;
  }
  return parts.join(' ');
}

describe('Dockerfile HEALTHCHECK (#103)', () => {
  const instruction = healthcheckInstruction(dockerfile);

  it('probes the IPv4 loopback literal, never `localhost`', () => {
    expect(instruction).toContain('127.0.0.1');
    // `localhost` resolves to ::1 first inside the Alpine runtime image.
    expect(instruction).not.toContain('localhost');
  });

  it('probes the /v1/health endpoint', () => {
    expect(instruction).toContain('/v1/health');
  });

  it('honours a PORT override rather than hard-coding the port', () => {
    // Shell form expands ${PORT:-3000}; docker-compose.yml and .env.example
    // both document PORT as overridable, so a hard-coded port would probe the
    // wrong socket on any non-default deployment.
    expect(instruction).toMatch(/\$\{PORT:-3000\}/);
  });

  it('fails the container when the probe fails', () => {
    expect(instruction).toMatch(/\|\|\s*exit 1/);
  });
});
