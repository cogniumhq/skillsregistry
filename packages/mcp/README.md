# @skillsregistry/mcp

Framework-agnostic MCP (Model Context Protocol) surface for
SkillsRegistry — JSON-RPC 2.0 dispatch, tool schemas, discovery
descriptor, and observability writer.

Part of the [SkillsRegistry SDK][sdk]. Consumed by both the
[SkillsRegistry mothership][mothership] (Cloudflare Workers) and the
[self-hostable local node][local] (Node.js).

## What ships

- `handleMcpRequest(body, ctx)` — transport-agnostic JSON-RPC 2.0
  dispatch. Returns `{ kind: 'json' | 'accepted' | 'error' }` so you
  wrap it in any HTTP framework.
- Five v1 read-only tools with input schemas:
  - `search_skills` — natural-language skill discovery.
  - `get_skill` — single skill lookup by slug.
  - `list_leaderboard` — five leaderboards behind one `kind` arg.
  - `get_trust_breakdown` — trust slice of a skill.
  - `resolve_composition` — expand a composition into its step graph.
- `buildDiscoveryDescriptor(input)` — serves `/.well-known/mcp.json` +
  `/mcp.json`. Prefers a configured canonical origin over the request
  URL.
- `createSqlPoolInvocationRecorder({ pool })` — J8 observability writer
  targeting a `mcp_invocations` table + bumping
  `agent_invocation_count` for skill-resolving tools.

## Adapters

Consumers plug their data access via a single `McpAdapters` bundle:

```ts
interface McpAdapters {
  search: SearchGatewayPort;          // findSkill(query, tenantId, opts)
  skills: SkillLookupPort;            // getSkillBySlug(slug, tenantId)
  compositions: CompositionLookupPort;// getCompositionBySlug(slug, tenantId)
  leaderboards: LeaderboardPort;      // getLeaderboard(kind, filters)
  recorder?: InvocationRecorderPort;  // optional; omit to skip J8 writes
  afterResponse?: AfterResponse;      // optional; defers recorder writes
}
```

## Auth stance

The MCP tools are read-only. `X-Tenant-Id` is an *advisory* scope hint, not
authentication or a tenant-isolation boundary. Protect private deployments
with your own access control.

Tool availability depends on the host. The self-hosted local node currently
returns no match for `resolve_composition` because it has no local composition
index; the hosted endpoint has a different tool set.

## License

Apache-2.0.

[sdk]: https://github.com/cogniumhq/skillsregistry
[mothership]: https://api.skillsregistry.net
[local]: https://github.com/cogniumhq/skillsregistry/tree/main/apps/local
