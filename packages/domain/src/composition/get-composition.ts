// ══════════════════════════════════════════════════════════════════════════════
// getCompositionBySlug — shared composition-detail loader
// ══════════════════════════════════════════════════════════════════════════════
//
// Ported verbatim from mothership `src/composition/get-composition.ts`.
// Extracted so MCP `resolve_composition` (and any other non-HTTP caller) can
// fetch a composition + its ordered steps without going through REST.
//
// Tenant visibility rules mirror `getSkillBySlug`:
//   - `visibility='public'` rows visible to everyone.
//   - `private` / `unlisted` rows visible only when caller's `tenantId`
//     matches the row's `tenant_id`.
//   - `'default'` is the reserved no-header sentinel (public-only view).
//   - Anything not flagged `public` AND not owned by the caller returns
//     `{ found: false }`.
//
// Fields returned are an EXPLICIT allowlist — we never spread `SELECT *`
// into the response. Adding a new column to the `skills` or
// `composition_steps` tables does NOT auto-publish it.
//
// The `shareUrl` is composed from the mothership's public host by default.
// Consumers embedding this in a differently-branded UI should pass a
// `hostname` option (kept optional so existing callers see no drift).
//
// ══════════════════════════════════════════════════════════════════════════════

import type { SqlPool } from '../adapters/index.js';

const COMPOSITION_TYPES = ['auto-composite', 'human-composite', 'composition', 'pipeline'];

export interface CompositionStep {
  id: string;
  stepOrder: number;
  skillId: string;
  skillName: string;
  skillSlug: string;
  stepName: string | null;
  inputMapping: unknown;
  onError: string | null;
}

/**
 * Explicit composition shape — mirrors the public fields REST returns, plus
 * the ordered step list. Mirrors `getSkillBySlug`'s discipline of an
 * allowlisted projection.
 */
export interface CompositionDetail {
  id: string;
  name: string;
  slug: string;
  version: string;
  description: string | null;
  agentSummary: string | null;
  skillType: string;
  status: string;
  visibility: string;
  tenantId: string | null;
  // Trust slice — agents care about these on resolve_composition output too.
  trustScore: number;
  verificationTier: string;
  trustBadge: string | null;
  trustTier: string | null;
  trustScoreV2: number | null;
  cogniumScanned: boolean;
  contentSafetyPassed: boolean | null;
  // Discovery
  category: string | null;
  categories: string[];
  tags: string[];
  ecosystem: string | null;
  language: string | null;
  license: string | null;
  source: string;
  sourceUrl: string | null;
  shareUrl: string;
  // Composition body
  steps: CompositionStep[];
  // Timestamps
  createdAt: string | null;
  updatedAt: string | null;
  publishedAt: string | null;
}

export type GetCompositionResult =
  | { found: true; data: CompositionDetail }
  | { found: false };

export interface GetCompositionOptions {
  /**
   * Public share-URL host used to construct `shareUrl`. Defaults to
   * `https://skillsregistry.net` — the mothership. Consumers hosting the
   * local node under a private domain pass their own value.
   */
  shareUrlHost?: string;
}

const DEFAULT_SHARE_URL_HOST = 'https://skillsregistry.net';

/**
 * Resolve a composition by slug. Returns the composition skill row + ordered
 * step list, or `{ found: false }` if no skill matches the slug, it is not a
 * composition-type skill, or the caller is not entitled to see it.
 *
 * `tenantId` defaults to `'default'` (public-only). Pass the caller's
 * `X-Tenant-Id` header value to surface their private/unlisted overlay.
 */
export async function getCompositionBySlug(
  pool: SqlPool,
  slug: string,
  tenantId: string = 'default',
  options: GetCompositionOptions = {},
): Promise<GetCompositionResult> {
  const shareUrlHost = options.shareUrlHost ?? DEFAULT_SHARE_URL_HOST;

  const skill = await pool.query<Record<string, unknown>>(
    `SELECT
       id, name, slug, version, description, agent_summary,
       skill_type, status, visibility, tenant_id,
       trust_score, verification_tier, trust_badge,
       trust_tier, trust_score_v2,
       cognium_scanned_at, content_safety_passed,
       category, categories, tags, ecosystem, language, license,
       source, source_url,
       created_at, updated_at, published_at
     FROM skills
     WHERE slug = $1 AND skill_type = ANY($2::text[])
     ORDER BY created_at DESC
     LIMIT 1`,
    [slug, COMPOSITION_TYPES],
  );
  if (skill.rows.length === 0) return { found: false };

  const row = skill.rows[0]!;

  // Visibility filter — same rules as get-skill.ts. Fail-closed on any
  // ambiguity (NULL tenant on a non-public row → hidden from everyone).
  if (row['visibility'] !== 'public') {
    if (tenantId === 'default' || !row['tenant_id'] || row['tenant_id'] !== tenantId) {
      return { found: false };
    }
  }

  const steps = await pool.query<{
    id: string;
    step_order: number;
    skill_id: string;
    step_name: string | null;
    input_mapping: unknown;
    on_error: string | null;
    skill_name: string;
    skill_slug: string;
  }>(
    `SELECT
       cs.id, cs.step_order, cs.skill_id, cs.step_name,
       cs.input_mapping, cs.on_error,
       s.name AS skill_name, s.slug AS skill_slug
     FROM composition_steps cs
     JOIN skills s ON s.id = cs.skill_id
     WHERE cs.composition_id = $1
     ORDER BY cs.step_order`,
    [row['id']],
  );

  const rowSlug = row['slug'] as string;
  const createdAt = row['created_at'];
  const updatedAt = row['updated_at'];
  const publishedAt = row['published_at'];

  return {
    found: true,
    data: {
      id: row['id'] as string,
      name: row['name'] as string,
      slug: rowSlug,
      version: row['version'] as string,
      description: (row['description'] as string | null) ?? null,
      agentSummary: (row['agent_summary'] as string | null) ?? null,
      skillType: row['skill_type'] as string,
      status: row['status'] as string,
      visibility: (row['visibility'] as string | null) ?? 'public',
      tenantId: (row['tenant_id'] as string | null) ?? null,
      trustScore: parseFloat(String(row['trust_score'])) || 0,
      verificationTier: (row['verification_tier'] as string | null) ?? 'unverified',
      trustBadge: (row['trust_badge'] as string | null) ?? null,
      trustTier: (row['trust_tier'] as string | null) ?? null,
      trustScoreV2: (row['trust_score_v2'] as number | null) ?? null,
      cogniumScanned: !!row['cognium_scanned_at'],
      contentSafetyPassed: (row['content_safety_passed'] as boolean | null) ?? null,
      category: (row['category'] as string | null) ?? null,
      categories: (row['categories'] as string[] | null) ?? [],
      tags: (row['tags'] as string[] | null) ?? [],
      ecosystem: (row['ecosystem'] as string | null) ?? null,
      language: (row['language'] as string | null) ?? null,
      license: (row['license'] as string | null) ?? null,
      source: row['source'] as string,
      sourceUrl: (row['source_url'] as string | null) ?? null,
      shareUrl: `${shareUrlHost}/skills/${rowSlug}`,
      steps: steps.rows.map((r) => ({
        id: r.id,
        stepOrder: r.step_order,
        skillId: r.skill_id,
        skillName: r.skill_name,
        skillSlug: r.skill_slug,
        stepName: r.step_name ?? null,
        inputMapping: r.input_mapping ?? null,
        onError: r.on_error ?? null,
      })),
      createdAt: toIso(createdAt),
      updatedAt: toIso(updatedAt),
      publishedAt: toIso(publishedAt),
    },
  };
}

function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
