// ══════════════════════════════════════════════════════════════════════════════
// McpCompositionLookup — no-op composition lookup for the local MVP.
// ══════════════════════════════════════════════════════════════════════════════
//
// The local node does not yet index compositions — the composition surface
// (`packages/domain/src/composition/`) is present as a shared type but no
// local read-path is wired. The `resolve_composition` MCP tool therefore
// always returns `{ found: false }`, and the tool surfaces
// `{ error: 'Composition not found', slug }` with `isError: true` inside
// the JSON-RPC result envelope (per MCP 2025-03-26 §tools/call semantics —
// tool-level failures do not become JSON-RPC errors).
//
// When local composition indexing lands, swap this out for a real adapter
// backed by the local `compositions` table + the mothership fallback the
// SkillsClient uses today.
//
// ══════════════════════════════════════════════════════════════════════════════

import type {
  CompositionLookupPort,
  GetCompositionResult,
} from '@skillsregistry/mcp';

export class McpCompositionLookup implements CompositionLookupPort {
  async getCompositionBySlug(
    _slug: string,
    _tenantId: string,
  ): Promise<GetCompositionResult> {
    return { found: false };
  }
}
