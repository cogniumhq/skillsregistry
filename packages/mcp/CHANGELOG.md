# @skillsregistry/mcp

## 1.2.2

### Patch Changes

- ece1aa7: `search_skills`: the `appetite` input now advertises and validates the domain vocabulary (`strict | cautious | balanced | adventurous`, exposed as a JSON-schema `enum`). The old description suggested `quick | standard | deep`, which the handler forwarded verbatim and which fell through `appetiteToTrustThreshold` with no trust floor. Unknown values are rejected with JSON-RPC invalid-params (#96).
- Updated dependencies [ece1aa7]
  - @skillsregistry/domain@1.2.0

## 1.2.1

### Patch Changes

- Republish 1.2.0 with the `workspace:*` dependency protocol correctly resolved.

  `1.2.0` was published with plain `npm publish`, which does not understand pnpm's `workspace:` protocol and shipped `"@skillsregistry/domain": "workspace:*"` verbatim in the package manifest. Any consumer installing it fails with `EUNSUPPORTEDPROTOCOL`. `pnpm publish` — which `changeset publish` delegates to — rewrites the protocol to the concrete version at pack time, which is why every prior release (`1.1.1` and earlier) shipped a resolvable `"@skillsregistry/domain": "1.1.1"`.

  No source change: `1.2.1` is `1.2.0`'s code with a correct manifest. `1.2.0` is deprecated on npm pointing here.

## 1.2.0

### Minor Changes

- `get_trust_breakdown`: return the derived per-dimension breakdown, and describe what the tool actually returns.

  The tool's description advertised "7-dimension scores, A/B/C/D/F tier" to agent clients while the handler returned neither — only the raw `trustResults` blob. An LLM reading that description had no way to reconcile what it got back.

  Both halves are corrected:

  - **Handler** — passes through `trustBreakdown` (`{overall, tier, dims, passCount}`) from the skill-lookup adapter, normalizing a missing value to `null` so callers branch on one value rather than `undefined`-vs-`null`. The raw `trustResults` blob is retained alongside; the breakdown is additive, and a caller auditing a specific finding still needs the detail.
  - **Description** — states the real contract: Circle-IR analyzer passes grouped into **six** 0-100 dimensions (security, supply, quality, reliability, compliance, provenance) with an overall score and the Circle-IR tier enum (`VERIFIED` / `PASSING` / `ADVISORY` / `FAILING` / `BLOCKED`). There is no A/B/C/D/F letter grade anywhere in this system.

  `SkillDetail.trustBreakdown` is added as an **optional** field, so adapter implementations that predate it keep type-checking and simply yield `null` through the tool.

  Minor rather than patch: the tool's output shape gains a field and its advertised contract changes, which is additive but consumer-visible.

## 1.1.1

### Patch Changes

- Updated dependencies [0b2a971]
  - @skillsregistry/domain@1.1.1

## 1.1.0

### Minor Changes

- 5e6018b: Ship `McpPolicyPort` — optional per-tenant tool-visibility gate for the two enforcement points cortex.md §16.4 mandates. Consumers wire an adapter implementing `isToolAllowed(toolName, tenantId): Promise<boolean>` into `McpAdapters.policy`. When present, the dispatcher: (1) filters the `tools/list` advertised set through the policy so a caller only sees tools they can invoke, and (2) re-checks at `tools/call` invocation time and returns `-32601 Method Not Found` for disallowed calls — same shape as an unknown tool, so a caller cannot distinguish "doesn't exist" from "not for you". Omitted policy = allow-all (v1 single-tenant local install posture), no behavior change.

  Closes review finding S6.

### Patch Changes

- Updated dependencies [0fa154b]
  - @skillsregistry/domain@1.1.0

## 1.0.1

### Patch Changes

- @skillsregistry/domain@1.0.1

## 1.0.0

### Major Changes

- 84d7250: T-1.5: Extract `@skillsregistry/mcp` from mothership.

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

  Peer stance: `@skillsregistry/domain` (workspace:\*) — the port depends on
  domain's `FindSkillOptions`, `FindSkillResponse`, `SqlPool`, `AfterResponse`.

  Auth stance (verbatim from mothership): v1 read-only, `X-Tenant-Id` is an
  advisory scope hint (missing / spoofed = public-only). OAuth 2.1 + RFC 8707
  land with v2 write tools.

  First npm publish: `1.0.0`.

### Patch Changes

- 749f168: Unit test coverage for all five MCP tools + the invocation writer.
  70 new tests, 96.18% overall coverage:

  - **tools/search-skills** — 15 tests. Query length validation,
    options passthrough (limit clamp, runtimeEnv wrap, tags/portable/
    category filters), envelope verbatim from `SearchGatewayPort`.
  - **tools/get-skill** — 8 tests. Slug + optional version validation,
    not-found isError envelope, `resolvedSkillId` stamp on success.
  - **tools/get-trust-breakdown** — 7 tests. Trust-only allowlist
    projection (~28 fields kept, non-trust fields stripped).
  - **tools/list-leaderboard** — 15 tests. Kind allowlist enum
    validation for all 5 kinds, limit clamping, filter passthrough.
  - **tools/resolve-composition** — 6 tests. Slug validation,
    composition-detail passthrough with resolvedSkillId stamp.
  - **invocation-writer** — 19 tests. 7-param `mcp_invocations` INSERT
    shape with `$7::jsonb` cast, durationMs floor/round, args JSON
    truncation with `{_truncated:true, raw:slice}` marker, unserializable
    circular-ref fallback, skills counter bump matrix for
    `SKILL_RESOLVING_TOOLS`, error swallow with injected logger and
    console.error fallback.

  Package now above the 96% publish gate.

- Updated dependencies [d6f2301]
- Updated dependencies [18bfcc5]
- Updated dependencies [2f7d6ae]
- Updated dependencies [7e688ed]
- Updated dependencies [79cf3e3]
- Updated dependencies [ec92340]
- Updated dependencies [749f168]
  - @skillsregistry/domain@1.0.0
