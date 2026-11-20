// ════════════════════════════════════════════════════════════════════════════
// qa-cleanup — discovery is best-effort, the namespace filter is not
// ════════════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QA_SLUG_PREFIX, QA_TENANT_ID } from './qa-guardrails.mts';
import {
  cleanupQaEntries,
  notDoneOutcomes,
  qaSlugsOnly,
  resolveSkillId,
  resolveTargets,
  slugsFromSearch,
} from './qa-cleanup.mts';

const A = `${QA_SLUG_PREFIX}publish-20261002`;
const B = `${QA_SLUG_PREFIX}search-20261002`;
const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

function fakeFetch(responses: { status: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const impl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const res = responses[Math.min(i++, responses.length - 1)]!;
    return {
      status: res.status,
      text: async () => JSON.stringify(res.body),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('qaSlugsOnly', () => {
  it('keeps only QA slugs, dedupes and sorts', () => {
    expect(qaSlugsOnly([B, A, A], ['@cogniumhq/real', null, 7], [B])).toEqual([A, B]);
  });

  it('is empty when no source yielded a QA slug', () => {
    expect(qaSlugsOnly(['acme/thing'], [])).toEqual([]);
  });
});

describe('slugsFromSearch', () => {
  it('POSTs the contract search body to the read host and keeps QA hits only', async () => {
    const { impl, calls } = fakeFetch([
      { status: 200, body: { skills: [{ slug: A }, { slug: '@cogniumhq/real' }], meta: {} } },
    ]);

    await expect(
      slugsFromSearch({
        readEndpoint: 'https://read.example/',
        query: 'QA test entry',
        limit: 50,
        fetchImpl: impl,
      }),
    ).resolves.toEqual([A]);

    // SearchRequestSchema (packages/contracts/src/upstream.ts): POST, JSON,
    // camelCase; the hosted handler also needs tenantId in the body.
    expect(calls[0]!.url).toBe('https://read.example/v1/search');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      query: 'QA test entry',
      tenantId: QA_TENANT_ID,
      tags: ['qa', 'cognium-internal'],
      limit: 50,
    });
    expect((calls[0]!.init.headers as Record<string, string>)['content-type']).toBe(
      'application/json',
    );
  });

  it('reads the hosted { results } envelope as well as { skills }', async () => {
    const { impl } = fakeFetch([
      { status: 200, body: { results: [{ slug: B }, { slug: 'acme/other' }] } },
    ]);
    await expect(
      slugsFromSearch({ readEndpoint: 'https://read.example', query: 'q', limit: 10, fetchImpl: impl }),
    ).resolves.toEqual([B]);
  });

  it('fails loudly when the read host does not answer 200', async () => {
    const { impl } = fakeFetch([{ status: 503, body: { error: 'upstream' } }]);
    await expect(
      slugsFromSearch({
        readEndpoint: 'https://read.example',
        query: 'q',
        limit: 10,
        fetchImpl: impl,
      }),
    ).rejects.toThrow(/search: HTTP 503/);
  });
});

describe('resolveSkillId', () => {
  it('reads the id off GET /v1/skills/:slug — a targeted surface QA stays visible on', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { id: ID_A, slug: A } }]);

    await expect(
      resolveSkillId({ readEndpoint: 'https://read.example/', slug: A, fetchImpl: impl }),
    ).resolves.toBe(ID_A);

    expect(calls[0]!.url).toBe(`https://read.example/v1/skills/${encodeURIComponent(A)}`);
    expect(calls[0]!.init.method).toBe('GET');
  });

  it('treats a 404 as "already gone", not an error', async () => {
    const { impl } = fakeFetch([{ status: 404, body: { error: 'Skill not found' } }]);
    await expect(
      resolveSkillId({ readEndpoint: 'https://read.example', slug: A, fetchImpl: impl }),
    ).resolves.toBeUndefined();
  });

  it('throws on any other non-200 so an outage never reads as an empty catalog', async () => {
    const { impl } = fakeFetch([{ status: 503, body: { error: 'upstream' } }]);
    await expect(
      resolveSkillId({ readEndpoint: 'https://read.example', slug: A, fetchImpl: impl }),
    ).rejects.toThrow(/HTTP 503/);
  });

  it('refuses a non-QA slug before it can issue the read', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { id: ID_A } }]);
    await expect(
      resolveSkillId({ readEndpoint: 'https://read.example', slug: '@cogniumhq/real', fetchImpl: impl }),
    ).rejects.toThrow(/refusing to act on/);
    expect(calls).toHaveLength(0);
  });
});

describe('resolveTargets', () => {
  it('skips the read for a target the ledger already carries an id for', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { id: ID_B } }]);

    const targets = await resolveTargets({
      targets: [{ slug: A, skillId: ID_A }, { slug: B }],
      readEndpoint: 'https://read.example',
      fetchImpl: impl,
    });

    expect(targets).toEqual([{ slug: A, skillId: ID_A }, { slug: B, skillId: ID_B }]);
    // Exactly one read — for B only.
    expect(calls.map((c) => c.url)).toEqual([
      `https://read.example/v1/skills/${encodeURIComponent(B)}`,
    ]);
  });

  it('leaves a target unresolved rather than inventing an id', async () => {
    const { impl } = fakeFetch([{ status: 404, body: {} }]);
    await expect(
      resolveTargets({ targets: [{ slug: A }], readEndpoint: 'https://read.example', fetchImpl: impl }),
    ).resolves.toEqual([{ slug: A }]);
  });
});

describe('cleanupQaEntries', () => {
  const quiet = () => {};

  it('deprecates each entry with a PATCH on /v1/skills/:id/status', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { status: 'deprecated' } }]);

    const outcomes = await cleanupQaEntries({
      targets: [{ slug: A, skillId: ID_A }, { slug: B, skillId: ID_B }],
      endpoint: 'https://writes.example',
      fetchImpl: impl,
      log: quiet,
      spacingMs: 0,
    });

    expect(outcomes.map((o) => o.status)).toEqual(['changed', 'changed']);
    // Keyed on the UUID, per the hosted route — a slug here 404s.
    expect(calls.map((c) => c.url)).toEqual([
      `https://writes.example/v1/skills/${ID_A}/status`,
      `https://writes.example/v1/skills/${ID_B}/status`,
    ]);
    expect(calls[0]!.init.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ status: 'deprecated' });
  });

  it('passes the reason through and sends the bearer token', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { status: 'deprecated' } }]);

    await cleanupQaEntries({
      targets: [{ slug: A, skillId: ID_A }],
      reason: 'case closed',
      apiKey: 'write-key',
      endpoint: 'https://writes.example',
      fetchImpl: impl,
      log: quiet,
      spacingMs: 0,
    });

    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      status: 'deprecated',
      reason: 'case closed',
    });
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(
      'Bearer write-key',
    );
  });

  it('sends nothing on a dry run', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: {} }]);
    const lines: string[] = [];

    const outcomes = await cleanupQaEntries({
      targets: [{ slug: A, skillId: ID_A }],
      endpoint: 'https://writes.example',
      dryRun: true,
      fetchImpl: impl,
      log: (line) => lines.push(line),
    });

    expect(calls).toHaveLength(0);
    expect(outcomes).toEqual([{ slug: A, status: 'planned' }]);
    expect(lines[0]).toContain(`would deprecate ${A}`);
    expect(lines[0]).toContain(`/v1/skills/${ID_A}/status`);
  });

  it('refuses a non-QA slug before it can build a request', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: {} }]);
    await expect(
      cleanupQaEntries({
        targets: [{ slug: '@cogniumhq/real-skill', skillId: ID_A }],
        endpoint: 'https://writes.example',
        fetchImpl: impl,
        log: quiet,
      }),
    ).rejects.toThrow(/refusing to act on/);
    expect(calls).toHaveLength(0);
  });

  it('reports an unresolved target without issuing a request', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: {} }]);
    const outcomes = await cleanupQaEntries({
      targets: [{ slug: A }],
      endpoint: 'https://writes.example',
      fetchImpl: impl,
      log: quiet,
      spacingMs: 0,
    });
    expect(outcomes[0]!.status).toBe('unresolved');
    expect(calls).toHaveLength(0);
  });

  it('reports a missing route as unsupported instead of failing silently', async () => {
    const { impl } = fakeFetch([{ status: 405, body: { error: 'Method Not Allowed' } }]);
    const outcomes = await cleanupQaEntries({
      targets: [{ slug: A, skillId: ID_A }],
      endpoint: 'https://writes.example',
      fetchImpl: impl,
      log: quiet,
      spacingMs: 0,
    });
    expect(outcomes[0]!.status).toBe('unsupported');
    expect(outcomes[0]!.detail).toMatch(/does not expose that route/);
  });

  it('treats the handler transition guard (409) as "left alone", not a hard failure', async () => {
    // The hosted handler allows published↔deprecated only. An entry Cognium
    // already revoked comes back 409 — re-running cleanup must not turn that
    // into a red run forever.
    const { impl } = fakeFetch([
      { status: 409, body: { error: "Cannot transition from 'revoked' to 'deprecated'." } },
    ]);
    const outcomes = await cleanupQaEntries({
      targets: [{ slug: A, skillId: ID_A }],
      endpoint: 'https://writes.example',
      fetchImpl: impl,
      log: quiet,
      spacingMs: 0,
    });
    expect(outcomes[0]!.status).toBe('unchanged');
    expect(outcomes[0]!.detail).toMatch(/Cannot transition/);
    expect(notDoneOutcomes(outcomes)).toEqual([]);
  });

  it('keeps going after a failure and records it', async () => {
    const { impl } = fakeFetch([
      { status: 500, body: { error: 'boom' } },
      { status: 200, body: {} },
    ]);
    const outcomes = await cleanupQaEntries({
      targets: [{ slug: A, skillId: ID_A }, { slug: B, skillId: ID_B }],
      endpoint: 'https://writes.example',
      fetchImpl: impl,
      log: quiet,
      spacingMs: 0,
    });
    expect(outcomes.map((o) => o.status)).toEqual(['failed', 'changed']);
  });
});

describe('notDoneOutcomes', () => {
  it('fails the run on failed / unsupported / unresolved, never on unchanged', () => {
    const outcomes = [
      { slug: A, status: 'changed' },
      { slug: A, status: 'planned' },
      { slug: A, status: 'unchanged' },
      { slug: A, status: 'unresolved' },
      { slug: A, status: 'unsupported' },
      { slug: A, status: 'failed' },
    ] as const;
    expect(notDoneOutcomes(outcomes).map((o) => o.status)).toEqual([
      'unresolved',
      'unsupported',
      'failed',
    ]);
  });
});

// The CLI end to end against a local stub of the hosted routes.
describe('qa-cleanup CLI', () => {
  const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'qa-cleanup.mts');
  const nodeArgs = (process.features as { typescript?: unknown }).typescript
    ? []
    : ['--experimental-strip-types'];

  async function runCli(patchStatus: number, searchResults: unknown[] = []) {
    const seen: { method: string; url: string; body: string }[] = [];
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        seen.push({ method: req.method ?? '', url: req.url ?? '', body: raw });
        const send = (status: number, body: unknown) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(body));
        };
        if (req.method === 'POST' && req.url === '/v1/search') return send(200, { results: searchResults });
        if (req.method === 'GET' && req.url === `/v1/skills/${encodeURIComponent(B)}`) return send(200, { id: ID_B, slug: B });
        if (req.method === 'PATCH') {
          return send(patchStatus, patchStatus === 200 ? { status: 'deprecated' } : { error: "Cannot transition from 'deprecated' to 'deprecated'." });
        }
        send(404, { error: 'Not found' });
      });
    });
    const base = await new Promise<string>((r) =>
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        r(`http://127.0.0.1:${addr.port}`);
      }),
    );
    const dir = mkdtempSync(join(tmpdir(), 'qa-cleanup-'));
    const ledger = join(dir, 'qa-published.json');
    writeFileSync(ledger, JSON.stringify({ entries: [{ slug: A, skillId: ID_A }] }));
    const env = { ...process.env, SR_WRITE_API_KEY: '', ADMIN_API_KEY: '' };
    try {
      return await new Promise<{ code: number; stdout: string; seen: typeof seen }>((resolve) => {
        execFile(
          process.execPath,
          [...nodeArgs, SCRIPT, '--endpoint', base, '--read-endpoint', base, '--ledger', ledger],
          { env },
          (err, stdout) => resolve({ code: err ? Number(err.code ?? 1) : 0, stdout, seen }),
        );
      });
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('exits 0 when re-run over an already-deprecated entry (409)', async () => {
    const { code, stdout, seen } = await runCli(409);
    expect(stdout).toMatch(/0 changed, 0 planned, 1 unchanged, 0 not done/);
    expect(code).toBe(0);
    // Discovery went out as the contract POST, then one PATCH keyed on the UUID.
    expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual([
      'POST /v1/search',
      `PATCH /v1/skills/${ID_A}/status`,
    ]);
    expect(JSON.parse(seen[0]!.body)).toMatchObject({ tenantId: QA_TENANT_ID, tags: ['qa', 'cognium-internal'] });
  }, 30_000);

  it('deprecates ledger and search-only entries and exits 0', async () => {
    const { code, stdout, seen } = await runCli(200, [{ slug: B, id: ID_B }]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/2 changed, 0 planned, 0 unchanged, 0 not done/);
    // A comes from the ledger (id known); B only from search, so it is
    // resolved through GET /v1/skills/:slug before its PATCH.
    expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual([
      'POST /v1/search',
      `GET /v1/skills/${encodeURIComponent(B)}`,
      `PATCH /v1/skills/${ID_A}/status`,
      `PATCH /v1/skills/${ID_B}/status`,
    ]);
  }, 30_000);
});
