# SkillsRegistry directory submissions

Copy-ready material for listing the hosted SkillsRegistry MCP server. This is
deliberately capability-led: directories need a working endpoint, install
configuration, and accurate limitations rather than a launch narrative.

Facts in this file were re-verified against production on 2026-09-19. Re-run
`pnpm validate:listings` immediately before a submission because the hosted
server version and catalog totals change independently of this repository.

## Canonical facts

| Field | Value |
|---|---|
| Name | SkillsRegistry |
| Publisher | Cognium Labs Inc (`https://cognium.net`) |
| MCP endpoint | `https://api.skillsregistry.net/mcp` |
| Transport | Streamable HTTP (`POST`) |
| Protocol | 2025-06-18; also negotiates 2025-03-26 and 2024-11-05 |
| Authentication | None for the public read-only tools |
| Tools | 7: `search_skills`, `get_skill`, `list_leaderboard`, `get_trust_breakdown`, `resolve_composition`, `search`, `fetch` |
| Descriptor | `https://api.skillsregistry.net/.well-known/mcp.json` |
| Product docs | `https://skillsregistry.net/agents` |
| OpenAPI | `https://api.skillsregistry.net/openapi.json` |
| Source / self-hosted node | `https://github.com/cogniumhq/skillsregistry` |
| License | Public service is free to use; this repository is Apache-2.0 |

## Install configuration

Claude Code:

```sh
claude mcp add --transport http --scope user skillsregistry https://api.skillsregistry.net/mcp
```

Generic client configuration:

```json
{
  "mcpServers": {
    "skillsregistry": {
      "type": "http",
      "url": "https://api.skillsregistry.net/mcp"
    }
  }
}
```

## Copy

### One line

> SkillsRegistry by Cognium Labs: search 90,000+ MCP servers and agent skills by what they do. No key required.

### Short description

> SkillsRegistry by Cognium Labs is a searchable index of MCP servers and agent
> skills aggregated from multiple public registries and GitHub. Search semantically by
> what a tool does; results include the endpoint or repository needed to use it,
> plus trust and scan-coverage signals. The public MCP endpoint is read-only and
> requires no key or signup.

### Long description

> SkillsRegistry by Cognium Labs brings MCP servers and agent skills from
> multiple ecosystem sources into one semantically searchable catalog with a
> public MCP endpoint.
>
> `search_skills` returns `mcpUrl`, `repositoryUrl`, and `installMethod`, so an
> agent can distinguish a callable remote from a source installation without a
> second discovery round trip. Seven read-only tools expose search, record
> lookup, trust details, composition resolution, and connector-shaped search and
> fetch. The endpoint uses Streamable HTTP and requires no authentication.
>
> Trust signals remain explicitly scoped: records state their scan coverage, and
> unscanned records are not presented as scanned. An Apache-2.0 local node is
> available for private and air-gapped deployments.

## Submission order and exact path

1. **Official MCP Registry.** Publish the root [`server.json`](../../server.json)
   with `mcp-publisher`. The older `modelcontextprotocol/servers` README no
   longer accepts new server listings.
2. **Cursor Marketplace.** The root `.cursor-plugin/plugin.json` and `mcp.json`
   are ready for `https://cursor.com/marketplace/publish`. Submit this public
   repository URL.
3. **Claude plugin directory.** The root `.claude-plugin/plugin.json` and
   `.mcp.json` are ready for `https://platform.claude.com/plugins/submit`.
4. **Awesome MCP Servers.** The `wong2/awesome-mcp-servers` repository no longer
   accepts listing PRs. Use `https://mcpservers.org/submit` with the one-line
   copy, `https://skillsregistry.net/agents` as the link, and category
   `Developer Tools` (or the nearest current equivalent).
5. **Other directories.** Re-check Smithery, Glama, PulseMCP, and community
   directories at submission time. Their APIs and submission paths have changed
   recently; do not encode an unverified form URL here.

## Community post draft

### Title

> A public MCP endpoint for searching 90,000+ MCP servers and agent skills

### Body

> At Cognium Labs, we built SkillsRegistry so agents can discover a usable MCP
> server without searching several directories and then making another trip to
> work out how to install it. The public Streamable HTTP endpoint is at
> `https://api.skillsregistry.net/mcp` with no key or signup.
>
> `search_skills` accepts a natural-language query and returns the MCP endpoint
> or repository, an explicit install-method classification, and the trust and
> scan coverage available for each result. It does not label an unscanned record
> as clean.
>
> Docs and client configs: https://skillsregistry.net/agents
>
> We would especially value feedback on the result shape: is there another field
> a client needs before it can decide whether to call, inspect, or skip a result?

Use this for the MCP community and developer forums. Do not cross-post it
unchanged everywhere; answer questions in the first venue before adapting it to
the next one.

## Do not claim

- **"Current", "always fresh", or "complete".** Several upstream sources are
  gated or capped; the catalog is useful and large, but those freshness claims
  are not defensible yet.
- **"Every skill is trust-scored" or "continuously scanned".** Scan coverage is
  explicit and not universal.
- **Meaningful leaderboard popularity.** Some signal channels remain sparse.
- **One-line self-hosting.** The local node needs Postgres with pgvector and an
  embedding provider; use `apps/local/README.md` rather than a bare `docker run`.
- A precise catalog count in durable copy. Use the conservative `90,000+` floor
  or read the live heartbeat immediately before submission.

## Submission checklist

- [ ] `pnpm validate:listings` passes against production.
- [ ] The endpoint initializes without authentication and returns seven tools.
- [ ] The repository default branch contains `.cursor-plugin/plugin.json`, `.claude-plugin/plugin.json`, `mcp.json`, `.mcp.json`, `server.json`, and `assets/logo.svg`.
- [ ] The destination's current terms and review requirements have been read.
- [ ] The submitted description contains no freshness or universal-scan claim.
- [ ] The submission date, destination, and review URL/status are recorded here.

## Submission log

| Destination | Submitted | Review URL / status |
|---|---|---|
| Official MCP Registry | — | Ready after merge |
| Cursor Marketplace | — | Ready after merge |
| Claude plugin directory | — | Ready after merge |
| Awesome MCP Servers / mcpservers.org | — | Ready after merge |
