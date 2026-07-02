// ══════════════════════════════════════════════════════════════════════════════
// PublishToMothershipClient — the migration door.
// ══════════════════════════════════════════════════════════════════════════════
//
// Powers `POST /v1/migrate/publish?skill_id=<uuid>` (T-2.10). Reads a local
// skills row, promotes it to the mothership via `UpstreamClient.publish(...)`,
// and persists the returned identity + status back onto the same row so a
// re-publish is a status refresh, not a duplicate insert.
//
// Owns three concerns in this order:
//
//   1. Local lookup       — fetch the skills row by id. Missing row → mint a
//                            local `UpstreamError('not_found')` so the route
//                            handler maps it to 404 without a wasted mothership
//                            round trip.
//   2. Manifest build     — map the row to `PublishRequest.manifest` and carry
//                            the D2 publisher signature (if any). Any missing
//                            required field → mint a local
//                            `UpstreamError('bad_request')` naming the fields.
//   3. Upstream publish   — `upstream.publish(request)`. Any `UpstreamError`
//                            bubbles up unchanged so the route handler surfaces
//                            `upstream_not_configured` → 503, `bad_request` →
//                            400, `budget_exhausted` → 402, etc.
//   4. Persist            — write `mothership_skill_id`,
//                            `mothership_publish_status`,
//                            `mothership_published_at`, `mothership_url` onto
//                            the local row. Best-effort — a 0-row update is
//                            logged as a warning but never fatal; the mothership
//                            already accepted the manifest and the response is
//                            returned to the caller.
//
// This module owns *only* the promotion pipeline. Auth / route decoding /
// HTTP status mapping — admin.ts. Upstream contract + resilience —
// UpstreamClient.
//
// ══════════════════════════════════════════════════════════════════════════════

import type {
  PublishRequest,
  PublishResponse,
} from '@skillsregistry/contracts';
import type { Pool } from 'pg';
import { UpstreamError } from '../upstream-client/errors.js';
import type { UpstreamClient } from '../upstream-client/index.js';

/**
 * Structured logger — matches the sink shape used elsewhere so callers can
 * pass the same logger for consistent formatting.
 */
export interface PublishToMothershipLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const consoleLogger: PublishToMothershipLogger = {
  info: (msg, meta) => console.log(`[publish-to-mothership] ${msg}`, meta ?? ''),
  warn: (msg, meta) => console.warn(`[publish-to-mothership] ${msg}`, meta ?? ''),
  error: (msg, meta) =>
    console.error(`[publish-to-mothership] ${msg}`, meta ?? ''),
};

export interface PublishToMothershipClientOptions {
  upstream: UpstreamClient;
  pool: Pool;
  logger?: PublishToMothershipLogger;
}

/**
 * Fields required to build a valid `PublishRequest.manifest`. Everything
 * else on the local row is optional and folded in when present.
 */
const REQUIRED_MANIFEST_FIELDS = [
  'name',
  'slug',
  'version',
  'source',
  'execution_layer',
] as const;

/**
 * Row shape we care about — a projection of the `skills` table columns
 * that feed into `PublishRequest.manifest` plus the D2 signature columns.
 */
interface SkillRow {
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
}

export class PublishToMothershipClient {
  private readonly upstream: UpstreamClient;
  private readonly pool: Pool;
  private readonly logger: PublishToMothershipLogger;

  constructor(options: PublishToMothershipClientOptions) {
    this.upstream = options.upstream;
    this.pool = options.pool;
    this.logger = options.logger ?? consoleLogger;
  }

  /**
   * Promote a local skill to the mothership. Throws `UpstreamError` for
   * every failure — the route handler pattern-matches on `.code` to map
   * to an HTTP status.
   */
  async publish(skillId: string): Promise<PublishResponse> {
    if (skillId.trim() === '') {
      throw new UpstreamError('bad_request', 'skill_id must be non-empty');
    }

    const row = await this.loadSkill(skillId);
    if (row === null) {
      throw new UpstreamError(
        'not_found',
        `no local skill with id ${skillId}`,
      );
    }

    const request = buildPublishRequest(row);

    // Upstream call. Any UpstreamError propagates.
    const response = await this.upstream.publish(request);

    // Persist locally. Best-effort — a 0-row update is a soft warning.
    await this.persist(skillId, response);

    return response;
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async loadSkill(skillId: string): Promise<SkillRow | null> {
    const result = await this.pool.query<SkillRow>(
      `SELECT id,
              name,
              slug,
              version,
              source,
              description,
              agent_summary,
              tags,
              category,
              schema_json,
              install_method,
              execution_layer,
              skill_md,
              source_url,
              repository_url,
              mcp_url,
              publisher_key_id,
              publisher_signature
         FROM skills
        WHERE id = $1`,
      [skillId],
    );
    if (result.rowCount === 0) return null;
    return result.rows[0] ?? null;
  }

  private async persist(
    skillId: string,
    response: PublishResponse,
  ): Promise<void> {
    try {
      const result = await this.pool.query(
        `UPDATE skills
            SET mothership_skill_id       = $1,
                mothership_publish_status = $2,
                mothership_published_at   = $3::timestamp,
                mothership_url            = $4
          WHERE id = $5`,
        [
          response.skill_id,
          response.status,
          new Date(response.published_at),
          response.url,
          skillId,
        ],
      );
      if (result.rowCount === 0) {
        this.logger.warn('persist: no local skills row', {
          localSkillId: skillId,
          mothershipSkillId: response.skill_id,
          status: response.status,
        });
      }
    } catch (err) {
      // Persistence failure is not fatal — the mothership already accepted
      // the manifest and the response is returned to the caller. Operators
      // can re-publish to refresh the tracking columns.
      this.logger.error('persist failed', {
        localSkillId: skillId,
        mothershipSkillId: response.skill_id,
        error: (err as Error).message,
      });
    }
  }
}

/**
 * Map a local `skills` row to a `PublishRequest`. Exported for tests.
 * Throws `UpstreamError('bad_request')` when required manifest fields
 * are missing so the caller can surface a 400 without a mothership round
 * trip.
 */
export function buildPublishRequest(row: SkillRow): PublishRequest {
  const missing: string[] = [];
  const pick = (
    field: (typeof REQUIRED_MANIFEST_FIELDS)[number],
    value: string | null,
  ): string => {
    if (value === null || value.trim() === '') {
      missing.push(field);
      return '';
    }
    return value;
  };

  const manifest: PublishRequest['manifest'] = {
    name: pick('name', row.name),
    slug: pick('slug', row.slug),
    version: pick('version', row.version),
    source: pick('source', row.source),
    execution_layer: pick('execution_layer', row.execution_layer),
  };

  if (missing.length > 0) {
    throw new UpstreamError(
      'bad_request',
      `skill manifest missing required fields: ${missing.join(', ')}`,
      { detail: { missing_fields: missing } },
    );
  }

  // Optional fields — fold in only when present so we don't send explicit
  // nulls the upstream Zod schema would reject.
  if (row.description !== null) manifest.description = row.description;
  if (row.agent_summary !== null) manifest.agent_summary = row.agent_summary;
  if (row.tags !== null) manifest.tags = row.tags;
  if (row.category !== null) manifest.category = row.category;
  if (row.schema_json !== null) manifest.schema_json = row.schema_json;
  if (row.install_method !== null) manifest.install_method = row.install_method;
  if (row.skill_md !== null) manifest.skill_md = row.skill_md;
  if (row.source_url !== null) manifest.source_url = row.source_url;
  if (row.repository_url !== null) manifest.repository_url = row.repository_url;
  if (row.mcp_url !== null) manifest.mcp_url = row.mcp_url;

  const request: PublishRequest = { manifest };
  if (row.publisher_key_id !== null) {
    request.publisher_key_id = row.publisher_key_id;
  }
  if (row.publisher_signature !== null) {
    request.signature = row.publisher_signature;
  }
  return request;
}
