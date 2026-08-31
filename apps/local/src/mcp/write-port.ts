// ══════════════════════════════════════════════════════════════════════════════
// MCP write port — B0.5 (techspec/buzz.md §8.5 / §9.1a)
// ══════════════════════════════════════════════════════════════════════════════
//
// Implements the `@skillsregistry/mcp` WritePort against local services so the
// self-hosted node exposes publish_skill / revise_skill / list_my_skills. Wired
// into buildMcpAdapters only when MCP_WRITE_ENABLED is true.
//
//   - publishSkill → skillsClient.publishLocal (the same path as POST /skills),
//     then persists author_id out-of-band (the PublishRequest manifest has no
//     author field; the private scope needs it).
//   - reviseSkill  → SELECT current version by slug, author-gate, SemVer bump,
//     republish (§9.3b honing). Older versions stay live.
//   - listByAuthor → SELECT WHERE author_id (the private scope, §8.5 G2).
//
// The node runs SIGNATURE_REQUIRED grace during dogfood (§8.5); publisher keys
// are B1 (§6.3), not wired here.
// ══════════════════════════════════════════════════════════════════════════════

import type { Pool } from 'pg';
import type { WritePort, WriteResult } from '@skillsregistry/mcp';
import { PublishRequestSchema } from '@skillsregistry/contracts';
import type { SkillsClient } from '../skills/index.js';

export interface McpWritePortOptions {
  skillsClient: SkillsClient;
  pool: Pool;
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** SemVer bump; missing/malformed current → 1.0.0. */
function bumpSemver(current: string | null | undefined, bump: 'minor' | 'major'): string {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(current ?? '');
  if (!m) return '1.0.0';
  const maj = Number(m[1]);
  const min = Number(m[2]);
  return bump === 'major' ? `${maj + 1}.0.0` : `${maj}.${min + 1}.0`;
}

/** Build + validate a PublishRequest from a flat manifest map. Drops empties so
 *  the manifest's `.url()` fields never see "". */
function toPublishRequest(m: Record<string, unknown>): { ok: true; value: ReturnType<typeof PublishRequestSchema.parse> } | { ok: false; error: string } {
  const manifest: Record<string, unknown> = {
    name: m.name,
    slug: m.slug,
    version: str(m.version) ?? '1.0.0',
    source: str(m.source) ?? 'manual',
    execution_layer: str(m.executionLayer) ?? str(m.execution_layer) ?? 'instructions',
  };
  const description = str(m.description);
  if (description) manifest.description = description;
  const skillMd = str(m.skillMd) ?? str(m.skill_md);
  if (skillMd) manifest.skill_md = skillMd;
  const mcpUrl = str(m.mcpUrl) ?? str(m.mcp_url);
  if (mcpUrl) manifest.mcp_url = mcpUrl;
  const category = str(m.category);
  if (category) manifest.category = category;
  if (Array.isArray(m.tags)) manifest.tags = m.tags.filter((t) => typeof t === 'string');

  const parsed = PublishRequestSchema.safeParse({ manifest });
  if (!parsed.success) {
    return { ok: false, error: `validation failed: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
  }
  return { ok: true, value: parsed.data };
}

export class McpWritePort implements WritePort {
  constructor(private readonly opts: McpWritePortOptions) {}

  private async setAuthor(skillId: string, authorId: string | undefined): Promise<void> {
    if (!authorId) return;
    // author_id lives on `skills` (migration 0005/0006) but publishLocal's INSERT
    // doesn't set it — persist it so the private scope (list/revise) can filter.
    await this.opts.pool.query(`UPDATE skills SET author_id = $1 WHERE id = $2`, [authorId, skillId]);
  }

  async publishSkill(input: unknown, _tenantId: string): Promise<WriteResult> {
    const args = rec(input);
    const built = toPublishRequest(args);
    if (!built.ok) return { ok: false, error: built.error };
    try {
      const result = await this.opts.skillsClient.publishLocal(built.value);
      await this.setAuthor(result.id, str(args.authorId));
      return { ok: true, data: result };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  }

  async reviseSkill(
    slug: string,
    opts: { bump?: 'minor' | 'major'; skillMd?: string; description?: string; authorId?: string },
    _tenantId: string,
  ): Promise<WriteResult> {
    const { rows } = await this.opts.pool.query<{
      name: string; slug: string; version: string | null; source: string | null;
      description: string | null; execution_layer: string | null; skill_md: string | null;
      mcp_url: string | null; tags: string[] | null; category: string | null; author_id: string | null;
    }>(
      `SELECT name, slug, version, source, description, execution_layer, skill_md,
              mcp_url, tags, category, author_id
         FROM skills WHERE slug = $1 ORDER BY created_at DESC LIMIT 1`,
      [slug],
    );
    const cur = rows[0];
    if (!cur) return { ok: false, error: `skill '${slug}' not found on this instance` };
    if (opts.authorId && cur.author_id && opts.authorId !== cur.author_id) {
      return { ok: false, error: 'not the author of this skill — you can only revise your own' };
    }
    const built = toPublishRequest({
      name: cur.name,
      slug: cur.slug,
      version: bumpSemver(cur.version, opts.bump ?? 'minor'),
      source: cur.source ?? 'manual',
      description: opts.description ?? cur.description ?? undefined,
      executionLayer: cur.execution_layer ?? 'instructions',
      skillMd: opts.skillMd ?? cur.skill_md ?? undefined,
      mcpUrl: cur.mcp_url ?? undefined,
      category: cur.category ?? undefined,
      tags: cur.tags ?? undefined,
    });
    if (!built.ok) return { ok: false, error: built.error };
    try {
      const result = await this.opts.skillsClient.publishLocal(built.value);
      await this.setAuthor(result.id, opts.authorId ?? cur.author_id ?? undefined);
      return { ok: true, data: result };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  }

  async listByAuthor(authorId: string, limit: number, _tenantId: string): Promise<WriteResult> {
    const { rows } = await this.opts.pool.query(
      `SELECT slug, name, version, status, trust_score, verification_tier, created_at
         FROM skills WHERE author_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [authorId, limit],
    );
    return { ok: true, data: { authorId, count: rows.length, skills: rows } };
  }
}
