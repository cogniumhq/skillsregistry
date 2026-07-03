// ══════════════════════════════════════════════════════════════════════════════
// McpSkillLookup — adapter binding `@skillsregistry/mcp` skill-lookup port to
// the local `SkillsClient`.
// ══════════════════════════════════════════════════════════════════════════════
//
// `SkillLookupPort.getSkillBySlug(slug, tenantId)` returns:
//   - `{ found: true, data: SkillDetail }` for a hit
//   - `{ found: false }` for a miss
//
// The MCP contract lets the tool surface a `resolvedSkillId` from `data.id`;
// `agentInvocationCount` is bumped in `mcp_invocations` for skill-resolving
// tools when the record has that field.
//
// Under the hood we delegate to `SkillsClient.getSkill(slug)` which is
// local-first (matches `id | slug | mothership_skill_id`) with an upstream
// write-through cache on miss. Air-gap misses already surface as
// `UpstreamError('not_found')` — we map that to `{ found: false }`. Other
// UpstreamError codes propagate as thrown so JSON-RPC can convert to the
// appropriate error envelope.
//
// `tenantId` is not threaded further in MVP — the local `skills` table is
// single-tenant and visibility filtering by tenant lands with the OAuth
// v2 write surface. The port arg is kept for interface parity.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { GetSkillResult, SkillDetail, SkillLookupPort } from '@skillsregistry/mcp';
import { UpstreamError } from '../upstream-client/errors.js';
import type { SkillsClient } from '../skills/index.js';

export interface McpSkillLookupOptions {
  skillsClient: SkillsClient;
}

export class McpSkillLookup implements SkillLookupPort {
  private readonly skillsClient: SkillsClient;

  constructor(opts: McpSkillLookupOptions) {
    this.skillsClient = opts.skillsClient;
  }

  async getSkillBySlug(slug: string, _tenantId: string): Promise<GetSkillResult> {
    try {
      const result = await this.skillsClient.getSkill(slug);
      // `skill` is the `SkillDetail`-shaped record produced by
      // `formatSkillDetail(row)` in `skills-client.ts` — the same envelope
      // the mothership returns from `GET /v1/skills/:id`. Cast is safe
      // because both surfaces are locked to `SkillDetailSchema`.
      return { found: true, data: result.skill as SkillDetail };
    } catch (err) {
      if (err instanceof UpstreamError && err.code === 'not_found') {
        return { found: false };
      }
      throw err;
    }
  }
}
