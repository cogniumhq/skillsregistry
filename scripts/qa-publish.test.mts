// ════════════════════════════════════════════════════════════════════════════
// qa-publish — what actually goes over the wire, and what never does
// ════════════════════════════════════════════════════════════════════════════

import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { QA_SLUG_PREFIX, QA_TENANT_ID } from './qa-guardrails.mts';
import { appendToLedger, publishQaSkill } from './qa-publish.mts';

const DATE = '20261002';
const MANIFEST = {
  name: 'QA publish probe',
  slug: 'publish',
  executionLayer: 'instructions',
  description: 'Exercises POST /v1/skills.',
};

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return {
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('publishQaSkill', () => {
  it('POSTs the guarded body to /v1/skills under the QA tenant', async () => {
    const { impl, calls } = fakeFetch(201, { id: 'sk_1', slug: 'x', version: '1.0.0' });

    const result = await publishQaSkill({
      manifest: MANIFEST,
      skillMd: '# QA\n',
      endpoint: 'https://writes.example/',
      date: DATE,
      apiKey: 'k1',
      fetchImpl: impl,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://writes.example/v1/skills');
    expect(calls[0]!.init.method).toBe('POST');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['x-tenant-id']).toBe(QA_TENANT_ID);
    expect(headers.authorization).toBe('Bearer k1');

    const sent = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    expect(sent.slug).toBe(`${QA_SLUG_PREFIX}publish-${DATE}`);
    expect(sent.tags).toEqual(['qa', 'cognium-internal']);
    expect(sent.description).toBe('QA test entry — not for use. Exercises POST /v1/skills.');
    expect(sent.skillMd).toBe('# QA\n');
    expect(result.response).toEqual({ id: 'sk_1', slug: 'x', version: '1.0.0' });
  });

  it('refuses a manifest outside the QA namespace without sending anything', async () => {
    const { impl, calls } = fakeFetch(201, {});
    await expect(
      publishQaSkill({
        manifest: { ...MANIFEST, slug: '@cogniumhq/real-skill' },
        endpoint: 'https://writes.example',
        fetchImpl: impl,
      }),
    ).rejects.toThrow(/first-party publisher/);
    expect(calls).toHaveLength(0);
  });

  it('explains a 404 as the read-only host rather than a missing skill', async () => {
    const { impl } = fakeFetch(404, { error: 'Not found' });
    await expect(
      publishQaSkill({
        manifest: MANIFEST,
        endpoint: 'https://api.skillsregistry.net',
        date: DATE,
        fetchImpl: impl,
      }),
    ).rejects.toThrow(/read-only/);
  });

  it('surfaces any other failure with its status and body', async () => {
    const { impl } = fakeFetch(422, { error: 'bad_request', detail: 'slug taken' });
    await expect(
      publishQaSkill({
        manifest: MANIFEST,
        endpoint: 'https://writes.example',
        date: DATE,
        fetchImpl: impl,
      }),
    ).rejects.toThrow(/HTTP 422.*slug taken/s);
  });
});

describe('appendToLedger', () => {
  it('creates the ledger, then appends to it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qa-ledger-'));
    const path = join(dir, 'qa-published.json');
    const entry = {
      slug: `${QA_SLUG_PREFIX}publish-${DATE}`,
      version: '1.0.0',
      endpoint: 'https://writes.example',
      publishedAt: '2026-10-02T00:00:00.000Z',
    };

    await appendToLedger(path, entry);
    await appendToLedger(path, { ...entry, slug: `${QA_SLUG_PREFIX}pull-${DATE}` });

    const parsed = JSON.parse(await readFile(path, 'utf8')) as {
      entries: { slug: string }[];
    };
    expect(parsed.entries.map((e) => e.slug)).toEqual([
      `${QA_SLUG_PREFIX}publish-${DATE}`,
      `${QA_SLUG_PREFIX}pull-${DATE}`,
    ]);
  });
});
