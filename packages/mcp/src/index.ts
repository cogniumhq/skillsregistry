// ══════════════════════════════════════════════════════════════════════════════
// @skillsregistry/mcp — framework-agnostic MCP tool surface
// ══════════════════════════════════════════════════════════════════════════════
//
// Ships:
//   - JSON-RPC 2.0 dispatch (`handleMcpRequest`) that mounts on any HTTP
//     framework (mothership uses plain Hono on Workers; the local node uses
//     `@hono/node-server`).
//   - Five read-only tools (`search_skills`, `get_skill`, `list_leaderboard`,
//     `get_trust_breakdown`, `resolve_composition`) with matching input
//     schemas.
//   - Discovery descriptor (`buildDiscoveryDescriptor`) for
//     `/.well-known/mcp.json` + `/mcp.json`.
//   - SqlPool-backed invocation recorder (`createSqlPoolInvocationRecorder`)
//     for J8 observability.
//
// All data-access delegates through the `McpAdapters` bundle: `search`,
// `skills`, `compositions`, `leaderboards`, optional `recorder`, optional
// `afterResponse`. Consumers plug their existing services in as function
// pointers — no reflection, no runtime coupling to a specific DB driver.
//
// v1 surface is read-only; `X-Tenant-Id` is an advisory scope hint (not a
// security boundary). Write tools + OAuth 2.1 land with v2.
// ══════════════════════════════════════════════════════════════════════════════

export * from './types.js';
export {
  JSONRPC_PARSE_ERROR,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_METHOD_NOT_FOUND,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_INTERNAL_ERROR,
  McpError,
} from './errors.js';
export {
  MCP_PROTOCOL_VERSION,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
  DEFAULT_SERVER_NAME,
  DEFAULT_SERVER_VERSION,
  DEFAULTS,
  resolveConfig,
} from './protocol.js';
export {
  TOOLS,
  TOOL_BY_NAME,
  SKILL_RESOLVING_TOOLS,
  searchSkillsTool,
  getSkillTool,
  listLeaderboardTool,
  getTrustBreakdownTool,
  resolveCompositionTool,
} from './tools/index.js';
export {
  handleMcpRequest,
  parseErrorResponse,
  type DispatchContext,
  type DispatchOutcome,
} from './dispatch.js';
export {
  buildDiscoveryDescriptor,
  type DiscoveryDescriptorInput,
} from './discovery.js';
export {
  createSqlPoolInvocationRecorder,
  type SqlPoolInvocationRecorderOptions,
} from './invocation-writer.js';
