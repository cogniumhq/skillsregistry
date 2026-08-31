// ══════════════════════════════════════════════════════════════════════════════
// McpWritePort — B0.5 adapter (apps/local)
// ══════════════════════════════════════════════════════════════════════════════

import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { McpWritePort } from './write-port.js';
import type { SkillsClient } from '../skills/index.js';

function makePool(handler: (sql: string, params: unknown[]) => { rows: unknown[] } | undefined): Pool {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params) ?? { rows: [], rowCount: 0 }),
  } as unknown as Pool;
}

function makeClient(publishImpl?: (req: unknown) => Promise<unknown>): SkillsClient {
  return {
    publishLocal: vi.fn(publishImpl ?? (async () => ({ id: 'skill-1', slug: 'my-skill', version: '1.0.0', status: 'published' }))),
  } as unknown as SkillsClient;
}

describe('McpWritePort.publishSkill', () => {
  it('delegates to publishLocal and persists author_id out-of-band', async () => {
    const client = makeClient();
    const queries: string[] = [];
    const pool = makePool((sql) => { queries.push(sql); return undefined; });
    const port = new McpWritePort({ skillsClient: client, pool });

    const res = await port.publishSkill(
      { name: 'My Skill', slug: 'my-skill', description: 'does a thing well', executionLayer: 'instructions', skillMd: '# hi', authorId: 'author-1' },
      'default',
    );

    expect(res.ok).toBe(true);
    expect(client.publishLocal).toHaveBeenCalledTimes(1);
    // author_id persisted via UPDATE (manifest has no author field)
    expect(queries.some((q) => /UPDATE skills SET author_id/.test(q))).toBe(true);
  });

  it('returns ok:false on a validation failure (no throw)', async () => {
    const port = new McpWritePort({ skillsClient: makeClient(), pool: makePool(() => undefined) });
    const res = await port.publishSkill({ slug: 'x' }, 'default'); // missing name
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/validation/i);
  });

  it('surfaces a publish error as ok:false', async () => {
    const client = makeClient(async () => { throw new Error('slug already exists'); });
    const port = new McpWritePort({ skillsClient: client, pool: makePool(() => undefined) });
    const res = await port.publishSkill({ name: 'X', slug: 'x', description: 'a valid description' }, 'default');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already exists/);
  });
});

describe('McpWritePort.reviseSkill', () => {
  const currentRow = {
    name: 'A', slug: 'a', version: '1.2.0', source: 'manual', description: 'orig desc',
    execution_layer: 'instructions', skill_md: '# a', mcp_url: null, tags: null, category: null, author_id: 'owner-1',
  };

  it('bumps SemVer minor off the current version and republishes', async () => {
    const client = makeClient();
    const pool = makePool((sql) => (/FROM skills WHERE slug/.test(sql) ? { rows: [currentRow] } : undefined));
    const port = new McpWritePort({ skillsClient: client, pool });

    const res = await port.reviseSkill('a', { bump: 'minor', authorId: 'owner-1', skillMd: '# a v2' }, 'default');
    expect(res.ok).toBe(true);
    const sent = (client.publishLocal as any).mock.calls[0][0];
    expect(sent.manifest.version).toBe('1.3.0');
    expect(sent.manifest.skill_md).toBe('# a v2');
  });

  it('rejects a non-author', async () => {
    const client = makeClient();
    const pool = makePool((sql) => (/FROM skills WHERE slug/.test(sql) ? { rows: [currentRow] } : undefined));
    const port = new McpWritePort({ skillsClient: client, pool });

    const res = await port.reviseSkill('a', { authorId: 'someone-else' }, 'default');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not the author/i);
    expect(client.publishLocal).not.toHaveBeenCalled();
  });

  it('404s an unknown slug', async () => {
    const port = new McpWritePort({ skillsClient: makeClient(), pool: makePool(() => ({ rows: [] })) });
    const res = await port.reviseSkill('nope', {}, 'default');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });
});

describe('McpWritePort.listByAuthor', () => {
  it('filters by author_id and returns the count', async () => {
    const pool = makePool((sql, params) =>
      /WHERE author_id = \$1/.test(sql) && params[0] === 'author-1'
        ? { rows: [{ slug: 'a', name: 'A', version: '1.0.0', status: 'published' }] }
        : undefined,
    );
    const port = new McpWritePort({ skillsClient: makeClient(), pool });
    const res = await port.listByAuthor('author-1', 50, 'default');
    expect(res.ok).toBe(true);
    expect((res.data as any).count).toBe(1);
    expect((res.data as any).skills[0].slug).toBe('a');
  });
});
