// ══════════════════════════════════════════════════════════════════════════════
// McpSearchGateway — adapter binding `@skillsregistry/mcp` search port to
// the local `ConfidenceGate`.
// ══════════════════════════════════════════════════════════════════════════════
//
// `SearchGatewayPort.findSkill(query, tenantId, options)` returns the raw
// domain `FindSkillResponse` (results + meta) — the MCP tool wraps that
// verbatim in the JSON-RPC result envelope. No mothership-shaped projection
// happens here; the MCP surface deliberately exposes the richer domain
// response so agents can reason about tier + confidence bands directly.
//
// The MCP port signature omits the `AfterResponse` argument that
// `ConfidenceGate.findSkill(..., afterResponse)` takes for cache-write
// scheduling — we thread the app-scoped `NodeAfterResponse` in at
// construction so the port stays framework-agnostic.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { AfterResponse } from '@skillsregistry/domain/adapters';
import type {
  ConfidenceGate,
  FindSkillOptions,
} from '@skillsregistry/domain/intelligence';
import type { FindSkillResponse } from '@skillsregistry/domain/types';
import type { SearchGatewayPort } from '@skillsregistry/mcp';

export interface McpSearchGatewayOptions {
  gate: ConfidenceGate;
  afterResponse: AfterResponse;
}

export class McpSearchGateway implements SearchGatewayPort {
  private readonly gate: ConfidenceGate;
  private readonly afterResponse: AfterResponse;

  constructor(opts: McpSearchGatewayOptions) {
    this.gate = opts.gate;
    this.afterResponse = opts.afterResponse;
  }

  findSkill(
    query: string,
    tenantId: string,
    options: FindSkillOptions,
  ): Promise<FindSkillResponse> {
    return this.gate.findSkill(query, tenantId, options, this.afterResponse);
  }
}
