import type {
  PublishRequest,
  PublishResponse,
} from '@skillsregistry/contracts';
import type { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UpstreamError } from '../upstream-client/errors.js';
import type { UpstreamClient } from '../upstream-client/index.js';
import {
  PublishToMothershipClient,
  buildPublishRequest,
} from './publish-to-mothership.js';

/**
 * Rows returned by `SELECT ... FROM skills WHERE id = $1`. Only the columns
 * the migration client actually reads are populated; anything else stays
 * `null`.
 */
interface FakeSkillRow {
  id: string;
  name: string | null;
  slug: string | null;
  version: string | null;
  source: string | null;
  description: string | null;
  agent_summary: string | null;
  tags: string[] | null;
  category: string | null;
  schema_json: Record<string, unknown> | null;
  install_method: Record<string, unknown> | null;
  execution_layer: string | null;
  skill_md: string | null;
  source_url: string | null;
  repository_url: string | null;
  mcp_url: string | null;
  publisher_key_id: string | null;
  publisher_signature: string | null;
  sandbox: Record<string, unknown> | null;
}

/** Build a minimally-valid row for happy-path tests. */
function skillRow(overrides: Partial<FakeSkillRow> = {}): FakeSkillRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'my-skill',
    slug: 'my-skill',
    version: '1.0.0',
    source: 'local',
    description: null,
    agent_summary: null,
    tags: null,
    category: null,
    schema_json: null,
    install_method: null,
    execution_layer: 'api',
    skill_md: null,
    source_url: null,
    repository_url: null,
    mcp_url: null,
    publisher_key_id: null,
    publisher_signature: null,
    sandbox: null,
    ...overrides,
  };
}

/**
 * Stub pool. `selectRow` decides what SELECT returns; `updateRowCount`
 * controls what UPDATE claims to have touched. Captures every executed
 * query for assertion.
 */
interface StubPool {
  pool: Pool;
  calls: Array<{ text: string; values: unknown[] }>;
  setSelectRow(row: FakeSkillRow | null): void;
  setUpdateRowCount(rowCount: number): void;
  makeUpdateThrow(err: Error): void;
}

function stubPool(): StubPool {
  let selectRow: FakeSkillRow | null = null;
  let updateRowCount = 1;
  let updateError: Error | null = null;
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const pool = {
    query: async (text: string, values: unknown[] = []) => {
      calls.push({ text, values });
      if (text.trim().startsWith('SELECT')) {
        if (selectRow === null) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [selectRow] };
      }
      if (text.trim().startsWith('UPDATE')) {
        if (updateError !== null) throw updateError;
        return { rowCount: updateRowCount, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
  } as unknown as Pool;
  return {
    pool,
    calls,
    setSelectRow(row) {
      selectRow = row;
    },
    setUpdateRowCount(rowCount) {
      updateRowCount = rowCount;
    },
    makeUpdateThrow(err) {
      updateError = err;
    },
  };
}

/** Silent logger to keep test output clean; capture messages for assertion. */
function captureLogger() {
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  return { info, warn, error };
}

function fakeUpstream(
  publishImpl: (request: PublishRequest) => Promise<PublishResponse>,
): { upstream: UpstreamClient; publishCalls: PublishRequest[] } {
  const publishCalls: PublishRequest[] = [];
  const upstream = {
    publish: async (request: PublishRequest) => {
      publishCalls.push(request);
      return publishImpl(request);
    },
  } as unknown as UpstreamClient;
  return { upstream, publishCalls };
}

const okResponse: PublishResponse = {
  skill_id: 'moth-99999999-9999-9999-9999-999999999999',
  slug: 'my-skill',
  version: '1.0.0',
  status: 'published',
  published_at: '2026-06-28T12:00:00.000Z',
  url: 'https://api.skillsregistry.net/v1/skills/moth-99999999-9999-9999-9999-999999999999',
};

// ──────────────────────────────────────────────────────────────────────────────
// buildPublishRequest — pure mapping
// ──────────────────────────────────────────────────────────────────────────────

describe('buildPublishRequest', () => {
  it('maps required fields into the manifest', () => {
    const req = buildPublishRequest(skillRow());
    expect(req.manifest.name).toBe('my-skill');
    expect(req.manifest.slug).toBe('my-skill');
    expect(req.manifest.version).toBe('1.0.0');
    expect(req.manifest.source).toBe('local');
    expect(req.manifest.execution_layer).toBe('api');
  });

  it('folds in optional fields when present, omits when null', () => {
    const req = buildPublishRequest(
      skillRow({
        description: 'does a thing',
        tags: ['alpha', 'beta'],
        skill_md: '# my-skill',
      }),
    );
    expect(req.manifest.description).toBe('does a thing');
    expect(req.manifest.tags).toEqual(['alpha', 'beta']);
    expect(req.manifest.skill_md).toBe('# my-skill');
    expect(req.manifest.agent_summary).toBeUndefined();
    expect(req.manifest.category).toBeUndefined();
    expect(req.manifest.mcp_url).toBeUndefined();
  });

  it('carries D2 publisher signature fields when present', () => {
    const req = buildPublishRequest(
      skillRow({
        publisher_key_id: 'key-abc',
        publisher_signature: 'sig-xyz',
      }),
    );
    expect(req.publisher_key_id).toBe('key-abc');
    expect(req.signature).toBe('sig-xyz');
  });

  it('forwards a v1.3 sandbox block into manifest.sandbox', () => {
    const sandbox = {
      image: 'ghcr.io/cognium-labs/skill-base:1.0.0',
      memory_mb: 512,
      cpu: 2,
      timeout_seconds: 300,
      egress: ['api.github.com'],
    };
    const req = buildPublishRequest(skillRow({ sandbox }));
    expect(req.manifest.sandbox).toEqual(sandbox);
  });

  it('omits manifest.sandbox when the row column is null', () => {
    const req = buildPublishRequest(skillRow({ sandbox: null }));
    expect(req.manifest).not.toHaveProperty('sandbox');
  });

  it('throws bad_request when a required field is null', () => {
    expect(() => buildPublishRequest(skillRow({ name: null }))).toThrowError(
      UpstreamError,
    );
    try {
      buildPublishRequest(skillRow({ name: null, slug: null }));
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(UpstreamError);
      const upstreamErr = err as UpstreamError;
      expect(upstreamErr.code).toBe('bad_request');
      expect(upstreamErr.message).toMatch(/name/);
      expect(upstreamErr.message).toMatch(/slug/);
      expect(upstreamErr.detail).toEqual({
        missing_fields: ['name', 'slug'],
      });
    }
  });

  it('throws bad_request when a required field is empty-string', () => {
    expect(() =>
      buildPublishRequest(skillRow({ execution_layer: '' })),
    ).toThrowError(UpstreamError);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PublishToMothershipClient.publish — full pipeline
// ──────────────────────────────────────────────────────────────────────────────

describe('PublishToMothershipClient.publish', () => {
  let pool: StubPool;
  let logger: ReturnType<typeof captureLogger>;

  beforeEach(() => {
    pool = stubPool();
    logger = captureLogger();
  });

  it('rejects empty skill_id without touching the pool', async () => {
    const { upstream } = fakeUpstream(async () => okResponse);
    const client = new PublishToMothershipClient({
      upstream,
      pool: pool.pool,
      logger,
    });
    await expect(client.publish('')).rejects.toMatchObject({
      code: 'bad_request',
    });
    expect(pool.calls).toHaveLength(0);
  });

  it('throws not_found when the local skills row is missing', async () => {
    pool.setSelectRow(null);
    const { upstream, publishCalls } = fakeUpstream(async () => okResponse);
    const client = new PublishToMothershipClient({
      upstream,
      pool: pool.pool,
      logger,
    });
    await expect(client.publish('missing-id')).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(publishCalls).toHaveLength(0);
  });

  it('throws bad_request without calling upstream when manifest is incomplete', async () => {
    pool.setSelectRow(skillRow({ execution_layer: null }));
    const { upstream, publishCalls } = fakeUpstream(async () => okResponse);
    const client = new PublishToMothershipClient({
      upstream,
      pool: pool.pool,
      logger,
    });
    await expect(client.publish('some-id')).rejects.toMatchObject({
      code: 'bad_request',
    });
    expect(publishCalls).toHaveLength(0);
    // Ran SELECT only; no UPDATE.
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0]!.text).toMatch(/SELECT/);
  });

  it('happy path: calls upstream, persists tracking columns, returns response', async () => {
    pool.setSelectRow(skillRow());
    const { upstream, publishCalls } = fakeUpstream(async () => okResponse);
    const client = new PublishToMothershipClient({
      upstream,
      pool: pool.pool,
      logger,
    });

    const response = await client.publish(
      '11111111-1111-1111-1111-111111111111',
    );

    expect(response).toEqual(okResponse);
    expect(publishCalls).toHaveLength(1);
    expect(publishCalls[0]!.manifest.slug).toBe('my-skill');

    // Persist ran with mothership metadata.
    const updateCall = pool.calls.find((c) => c.text.trim().startsWith('UPDATE'));
    expect(updateCall).toBeDefined();
    expect(updateCall!.values[0]).toBe(okResponse.skill_id);
    expect(updateCall!.values[1]).toBe(okResponse.status);
    expect(updateCall!.values[3]).toBe(okResponse.url);
    expect(updateCall!.values[4]).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('propagates UpstreamError from upstream.publish without persisting', async () => {
    pool.setSelectRow(skillRow());
    const { upstream } = fakeUpstream(async () => {
      throw new UpstreamError(
        'upstream_not_configured',
        'Mothership is not configured (air-gap mode)',
      );
    });
    const client = new PublishToMothershipClient({
      upstream,
      pool: pool.pool,
      logger,
    });
    await expect(
      client.publish('11111111-1111-1111-1111-111111111111'),
    ).rejects.toMatchObject({ code: 'upstream_not_configured' });
    // No UPDATE.
    expect(pool.calls.filter((c) => c.text.trim().startsWith('UPDATE'))).toEqual(
      [],
    );
  });

  it('propagates upstream budget_exhausted without persisting', async () => {
    pool.setSelectRow(skillRow());
    const { upstream } = fakeUpstream(async () => {
      throw new UpstreamError('budget_exhausted', 'tenant out of tokens', {
        retryAfter: 3600,
      });
    });
    const client = new PublishToMothershipClient({
      upstream,
      pool: pool.pool,
      logger,
    });
    await expect(
      client.publish('11111111-1111-1111-1111-111111111111'),
    ).rejects.toMatchObject({
      code: 'budget_exhausted',
      retryAfter: 3600,
    });
  });

  it('returns the response even when persist finds no local row', async () => {
    pool.setSelectRow(skillRow());
    pool.setUpdateRowCount(0);
    const { upstream } = fakeUpstream(async () => okResponse);
    const client = new PublishToMothershipClient({
      upstream,
      pool: pool.pool,
      logger,
    });
    const response = await client.publish(
      '11111111-1111-1111-1111-111111111111',
    );
    expect(response).toEqual(okResponse);
    // Warned about the 0-row update.
    expect(logger.warn).toHaveBeenCalled();
    const [, meta] = logger.warn.mock.calls[0]!;
    expect(meta).toMatchObject({
      localSkillId: '11111111-1111-1111-1111-111111111111',
      mothershipSkillId: okResponse.skill_id,
    });
  });

  it('returns the response even when persist throws', async () => {
    pool.setSelectRow(skillRow());
    pool.makeUpdateThrow(new Error('db down'));
    const { upstream } = fakeUpstream(async () => okResponse);
    const client = new PublishToMothershipClient({
      upstream,
      pool: pool.pool,
      logger,
    });
    const response = await client.publish(
      '11111111-1111-1111-1111-111111111111',
    );
    expect(response).toEqual(okResponse);
    expect(logger.error).toHaveBeenCalled();
    const [, meta] = logger.error.mock.calls[0]!;
    expect(meta).toMatchObject({
      localSkillId: '11111111-1111-1111-1111-111111111111',
      error: 'db down',
    });
  });

  it('threads publisher signature into the upstream request', async () => {
    pool.setSelectRow(
      skillRow({
        publisher_key_id: 'key-abc',
        publisher_signature: 'sig-xyz',
      }),
    );
    const { upstream, publishCalls } = fakeUpstream(async () => okResponse);
    const client = new PublishToMothershipClient({
      upstream,
      pool: pool.pool,
      logger,
    });
    await client.publish('11111111-1111-1111-1111-111111111111');
    expect(publishCalls[0]!.publisher_key_id).toBe('key-abc');
    expect(publishCalls[0]!.signature).toBe('sig-xyz');
  });
});
