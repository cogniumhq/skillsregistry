// ══════════════════════════════════════════════════════════════════════════════
// MCP protocol constants
// ══════════════════════════════════════════════════════════════════════════════
//
// Protocol versions this server supports, preferred first. `initialize`
// negotiates: if the client requests one we support, we echo it back; if not
// we respond with our preferred version and the client decides whether to
// continue (per MCP 2025-03-26 §Initialization).
// ══════════════════════════════════════════════════════════════════════════════

export const MCP_PROTOCOL_VERSION = '2025-03-26';
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = ['2025-03-26', '2024-11-05'];

export const DEFAULT_SERVER_NAME = 'skillsregistry';
export const DEFAULT_SERVER_VERSION = '6.2.0';

// Config defaults — mirror mothership's env-var fallbacks.
export const DEFAULTS = {
  searchDefaultLimit: 10,
  searchMaxLimit: 50,
  searchQueryMax: 500,
  leaderboardDefaultLimit: 20,
  leaderboardMaxLimit: 100,
  batchMax: 20,
} as const;

import type { McpConfig, ResolvedMcpConfig } from './types.js';

export function resolveConfig(config: McpConfig | undefined): ResolvedMcpConfig {
  const c = config ?? {};
  return {
    serverName: c.serverName ?? DEFAULT_SERVER_NAME,
    serverVersion: c.serverVersion ?? DEFAULT_SERVER_VERSION,
    canonicalOrigin: c.canonicalOrigin,
    documentationUrl: c.documentationUrl,
    openapiUrl: c.openapiUrl,
    searchDefaultLimit: c.searchDefaultLimit ?? DEFAULTS.searchDefaultLimit,
    searchMaxLimit: c.searchMaxLimit ?? DEFAULTS.searchMaxLimit,
    searchQueryMax: c.searchQueryMax ?? DEFAULTS.searchQueryMax,
    leaderboardDefaultLimit: c.leaderboardDefaultLimit ?? DEFAULTS.leaderboardDefaultLimit,
    leaderboardMaxLimit: c.leaderboardMaxLimit ?? DEFAULTS.leaderboardMaxLimit,
    batchMax: c.batchMax ?? DEFAULTS.batchMax,
    writeEnabled: c.writeEnabled ?? false,
  };
}
