---
'@skillsregistry/mcp': major
---

T-1.5: Extract `@skillsregistry/mcp` from mothership.

Framework-agnostic MCP (Model Context Protocol) tool surface for
SkillsRegistry. Ports mothership `src/mcp/server.ts` +
`src/mcp/invocation-writer.ts` behind an adapter bundle so the same JSON-RPC
dispatch + tool schemas + discovery descriptor run on Cloudflare Workers
(mothership) and the local Node app.

Public entry points:

- `handleMcpRequest(body, ctx)` — transport-agnostic JSON-RPC 2.0 dispatch.
  Returns `{ kind: 'json' | 'accepted' | 'error' }` so consumers wrap in any
  HTTP framework (Hono, Express, Cloudflare Workers native, etc). Supports
  `initialize`, `initialized`, `ping`, `tools/list`, `tools/call` plus JSON-
  RPC 2.0 batches (capped by `config.batchMax`).
- `TOOLS` — five read-only v1 tools with input schemas:
  `search_skills`, `get_skill`, `list_leaderboard`, `get_trust_breakdown`,
  `resolve_composition`. All matching mothership on-wire shape.
- `buildDiscoveryDescriptor(input)` — serves `/.well-known/mcp.json` +
  `/mcp.json`. Prefers `config.canonicalOrigin` over the request URL so
  descriptors served from workers.dev / preview hostnames still point at
  the public production hostname.
- `createSqlPoolInvocationRecorder({ pool, argsMaxChars, logger })` —
  SqlPool-backed J8 observability writer. Writes one row to
  `mcp_invocations` per `tools/call`; skill-resolving tools (`get_skill`,
  `get_trust_breakdown`, `resolve_composition`) also bump the existing
  `agent_invocation_count` aggregator on `skills`. Errors logged +
  swallowed — observability never breaks the request path.

Adapter bundle (`McpAdapters`):

- `search: SearchGatewayPort` — `findSkill(query, tenantId, options)` for
  confidence-gated search. Consumer binds its own `AfterResponse` when
  constructing the port (typically wrapping
  `ConfidenceGate.findSkill(...)` from `@skillsregistry/domain`).
- `skills: SkillLookupPort` — `getSkillBySlug(slug, tenantId)`. Consumer
  handles tenant visibility (fail-closed).
- `compositions: CompositionLookupPort` — `getCompositionBySlug(slug,
  tenantId)`. Composition detail payload is passed through untouched; only
  the `id` field is read to stamp the invocation recorder.
- `leaderboards: LeaderboardPort` — single `getLeaderboard(kind, filters)`
  entry point dispatching the five projections (`trust`, `trending`,
  `agents`, `composed`, `forked`).
- `recorder?: InvocationRecorderPort` — optional. Non-blocking
  observability. Absent = dispatch skips the write.
- `afterResponse?: AfterResponse` — waitUntil-style post-response scheduler.
  When absent, recorder writes fire in-line as best-effort (`void task()`).

Config (`McpConfig`): every env-configurable knob in mothership is a typed
option. `MCP_SEARCH_DEFAULT_LIMIT`, `MCP_SEARCH_MAX_LIMIT`,
`MCP_SEARCH_QUERY_MAX`, `MCP_LEADERBOARD_DEFAULT_LIMIT`,
`MCP_LEADERBOARD_MAX_LIMIT`, `MCP_BATCH_MAX`, `MCP_CANONICAL_ORIGIN`,
`MCP_INVOCATION_ARGS_MAX` — consumers env-parse once at boot and pass in.
`resolveConfig(undefined)` returns documented defaults matching mothership.

Sub-paths shipped:

- `.` — main barrel
- `./types` — types only (no side effects)
- `./discovery` — descriptor builder
- `./invocation-writer` — recorder factory

Verification: `pnpm --filter @skillsregistry/mcp typecheck` clean,
`pnpm --filter @skillsregistry/mcp build` clean,
`pnpm --filter @skillsregistry/mcp test` 14/14 green (dispatch + discovery
smoke coverage).

Peer stance: `@skillsregistry/domain` (workspace:*) — the port depends on
domain's `FindSkillOptions`, `FindSkillResponse`, `SqlPool`, `AfterResponse`.

Auth stance (verbatim from mothership): v1 read-only, `X-Tenant-Id` is an
advisory scope hint (missing / spoofed = public-only). OAuth 2.1 + RFC 8707
land with v2 write tools.

First npm publish: `1.0.0`.
