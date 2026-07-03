# @skillsregistry/local

Self-hostable SkillsRegistry node. Runs on Node 22 + Postgres 16 (pgvector)
+ Ollama.

Consumer of the six `@skillsregistry/*` SDK packages. Published as a Docker
image (`ghcr.io/cogniumhq/skillsregistry-local`) and consumable from source.

## Quick start (Docker Compose)

```
cp apps/local/.env.example apps/local/.env  # edit ADMIN_TOKEN
cd apps/local
docker compose up
```

Then:

```
curl http://localhost:3000/v1/health
# → {"status":"ok","version":"0.1.0","nodeEnv":"production", ... }
```

## Local dev

```
# from repo root
pnpm install
pnpm --filter '@skillsregistry/*' build

# start Postgres + Ollama separately or use `docker compose up postgres ollama`
export DATABASE_URL=postgres://…
export ADMIN_TOKEN=dev-token

pnpm --filter @skillsregistry/local dev
```

## Air-gap mode

Leave `MOTHERSHIP_URL` / `MOTHERSHIP_API_KEY` / `TENANT_ID` unset. The node
runs against local Postgres only:

- `/v1/search` returns local hits (no upstream fallback)
- `/v1/trust/score` returns `503 upstream_not_configured`
- `/v1/leaderboards/*` returns `503 upstream_not_configured`

## Environment variables

See `.env.example` for the full list. Required:

| Var | Purpose |
|---|---|
| `DATABASE_URL` | libpq connection string |
| `ADMIN_TOKEN` | bearer token for `/v1/admin/*` |

## Status

- ☑ **T-2.1** — Scaffold (package.json, tsconfig, index.ts stub, Dockerfile, compose)
- ☑ **T-2.2** — Node adapters at `src/adapters/`: `PgKv`, `MemoryQueue`, `FsArtifact`, `createOllamaEmbedder`, `NodeAfterResponse` (upstream-embedder deferred pending mothership `/v1/embed` contract)
- ☑ **T-2.4** — Config module (`src/config.ts`) with env parsing + boot-time validation
- ☑ **T-2.5 + T-2.6** — Schema-version guard + migration runner (`src/boot/schema.ts`)
- ☑ **T-2.7** — `UpstreamClient` at `src/upstream-client/` — token-bucket rate limit + circuit breaker + typed `UpstreamError` taxonomy
- ☑ **T-2.3** — Composition root (`src/services.ts` → `buildAppServices`) + auth/tenant middleware (`src/middleware/`) + public/admin/mcp sub-apps mounted from `src/index.ts` (handlers ship as 501 stubs pointing to T-2.10 / T-2.11 / T-2.12 / T-2.13 / T-2.14)
- ☑ **T-2.8** — `TrustClient` at `src/trust-client.ts` — budget-aware wrapper around `upstream.trustScore(...)`. KV precheck on `trust:budget:v1:<tenantId>`, persist to `skills.trust_score_v2/trust_tier/trust_results/trust_analyzed_at`, decrement cached budget. Exports `budgetKey()` + `snapshotFromBudget()` + `parseBudgetSnapshot()` shared with T-2.9.
- ☑ **T-2.9** — `BudgetMeter` at `src/budget/meter.ts` — `node-cron` poller of `GET /v1/tenant/budget`, caches snapshot under `trust:budget:v1:<tenantId>` with configurable TTL (`BUDGET_REFRESH_CRON`, `BUDGET_TTL_SECONDS`). Warm refresh at boot; structured `warn` on `lowBalance` transitions. Started + stopped by `main()`. T-2.12 admin routes will call `.getCached()` + `.refresh()`.
- ☑ **T-2.10** — `PublishToMothershipClient` at `src/migration/publish-to-mothership.ts` — the promotion door behind `POST /v1/migrate/publish?skill_id=<uuid>`. Reads the local `skills` row, builds a `PublishRequest` (with D2 signature threading), calls `upstream.publish(...)`, and persists returned mothership identity + status to new columns `mothership_skill_id` / `mothership_publish_status` / `mothership_published_at` / `mothership_url` (migration `0033`; schema v33).
- ☑ **T-2.11** Public routes — sliced into three:
  - ☑ **T-2.11a** — thin mothership-proxy handlers wired in `src/routes/public.ts`. `POST /v1/trust/score` validates against `TrustScoreRequestSchema` and delegates to `services.trustClient.score(...)`, returning only the `TrustScoreResponse` (the budget snapshot stays admin-only). `GET /v1/leaderboards/:kind` proxies to `services.upstream.getLeaderboard(kind, params)` with `limit`/`category`/`ecosystem`/`skill_type` filter whitelist and pass-through JSON. Shared `UpstreamError` → HTTP status mapping extracted into `src/http/upstream-response.ts` (`upstreamErrorToResponse(err)`), consumed by both public and admin routes.
  - ☑ **T-2.11b** — `SkillsClient` at `src/skills/skills-client.ts` — local-first read + upstream write-through cache + single-tenant local publish. `GET /v1/skills/:id` SELECTs by `id | slug | mothership_skill_id`; on miss falls back to `upstream.getSkill(id)` and best-effort caches by slug (INSERT … ON CONFLICT DO UPDATE `mothership_skill_id`, `mothership_url`, `trust_score_v2`, `trust_tier`). Air-gap collapse: `upstream_not_configured` is re-minted as `not_found` so callers see a truthful 404. `POST /v1/skills` validates `PublishRequestSchema` and INSERTs the manifest with `status = 'published'`; pg `23505` → `bad_request` with `detail.constraint: unique_violation`.
  - ☑ **T-2.11c** — `GET /v1/search` wired to `SearchService` (`src/search/`) on top of the domain-package `ConfidenceGate` + `PgVectorProvider`. Local-only (no mothership `/v1/search` contract exists); T3 LLM rescue + cross-encoder reranker default to `false` with throw-on-call stub backends so misconfiguring `SEARCH_DEEP_ENABLED=true` / `SEARCH_RERANKER_ENABLED=true` fails loud. `PgSearchCache` wraps the `kv_store` table (`search:v1:<tenantId>:<appetite>:<sha256(query)>`, tier-biased TTL). `projectResponse` maps the domain `FindSkillResponse` onto the contract `SearchResponse` (`agentSummary → description`, `cacheHit → cached`, `llmInvoked → deepSearchUsed`, `source: 'local'`, `signals: []`). Query-param surface: `?q` (required, non-empty), `?limit` (1-50), `?appetite=strict|cautious|balanced|adventurous`, `?tags` (csv), `?category`, `?runtime_env` (csv), `?visibility=public|private|unlisted`, `?portable=true|false|1|0`; `tenantId` from `X-Tenant-Id` header defaulting to `'local'`.
- ☑ **T-2.12** Admin routes wired at `src/routes/admin.ts`. `pool` threaded as a third arg to `createAdminRoutes(services, adminToken, pool)` — mirrors `createApp`, keeps the pg pool outside `AppServices`.
  - `GET /v1/admin/budget` → `{ budget: BudgetSnapshot | null, mode: 'configured' | 'air_gapped' }` from `budgetMeter.getCached()`. Never throws; `mode` disambiguates cold-cache from air-gap.
  - `POST /v1/admin/budget/refresh` → short-circuits to 503 `upstream_not_configured` in air-gap; otherwise delegates to `budgetMeter.refresh()`. `UpstreamError` mapped via shared `upstreamErrorToResponse`; unexpected `Error` → 500 `internal_error`.
  - `GET /v1/admin/health` → deep health across four parallel probes: DB (`SELECT 1`), embedder (`.embed('.')`, reports `.identity.id`), mothership (passive read of `isAirGapped` + `circuitState`; no active `getBudget()` call to avoid burning mothership budget), migrations (`SELECT MAX(version) FROM schema_migrations` vs `SCHEMA_VERSION` from `@skillsregistry/schema`). Aggregate `ok` iff db + embedder + migrations are all `ok`; mothership doesn't gate aggregate (air-gap is healthy; circuit-open is a mothership-side signal surfaced in its sub-check). 200 on `ok`, 503 on `degraded` — usable as a container liveness/readiness probe.
- ☑ **T-2.13** MCP endpoint wired at `src/routes/mcp.ts`. `POST /mcp` dispatches JSON-RPC 2.0 requests through `handleMcpRequest` from `@skillsregistry/mcp`. Composition root exposes `mcpAdapters: McpAdapters` + `mcpConfig: ResolvedMcpConfig` on `AppServices`; both are built inside `buildAppServices` (block `3n`) via `buildMcpAdapters({ gate, skillsClient, upstream, afterResponse, pool, invocationArgsMaxChars })`.
  - Adapter bundle in `src/mcp/`: `McpSearchGateway` wraps `ConfidenceGate` (bakes `NodeAfterResponse` in so the framework-agnostic `SearchGatewayPort` still gets deferred-write coverage). `McpSkillLookup` delegates to `SkillsClient.getSkill()` — inherits its local-first + upstream fallback + air-gap collapse; maps `UpstreamError('not_found')` → `{ found: false }`. `McpLeaderboardProxy` calls `UpstreamClient.getLeaderboard(kind, params)`, unwraps the `{ leaderboard: [...] }` envelope, and collapses `upstream_not_configured` → `[]` so MCP clients see "no rankings available" instead of a JSON-RPC error leaking the air-gap posture. `McpCompositionLookup` always returns `{ found: false }` (no local composition index in MVP; tool surfaces the miss as `isError: true` per MCP 2025-03-26 §tools/call). `buildMcpAdapters` also mints the SqlPool-backed invocation recorder (`createSqlPoolInvocationRecorder({ pool, argsMaxChars })`) and threads `NodeAfterResponse` in so `mcp_invocations` writes + `agent_invocation_count` bumps stay off the request critical path.
  - `McpConfig` block in `src/config.ts` reads 12 env vars: `MCP_SERVER_NAME`, `MCP_SERVER_VERSION`, `MCP_CANONICAL_ORIGIN`, `MCP_DOCUMENTATION_URL`, `MCP_OPENAPI_URL`, `MCP_SEARCH_DEFAULT_LIMIT` (10), `MCP_SEARCH_MAX_LIMIT` (50), `MCP_SEARCH_QUERY_MAX` (500), `MCP_LEADERBOARD_DEFAULT_LIMIT` (20), `MCP_LEADERBOARD_MAX_LIMIT` (100), `MCP_BATCH_MAX` (20), `MCP_INVOCATION_ARGS_MAX` (4096). Passed through `resolveConfig()` at boot so downstream code always sees `ResolvedMcpConfig` with defaults applied.
  - Handler surface: JSON body parse-throw → `parseErrorResponse()` (-32700) at 400; `DispatchContext { tenantId: getTenantId(c) ?? 'local', adapters, config }`; `handleMcpRequest` outcome switch — `json` → 200, `accepted` → 202 empty body (notifications + empty-response batches per MCP 2025-03-26 §Transports), `error` → JSON at declared status. `X-Tenant-Id` threaded through the existing `tenantContext` middleware (advisory scope hint, not a security boundary in v1).
  - Tests: 13 new in `src/routes/mcp.test.ts` — `tools/list` (5 tools advertised), per-tool happy path (`search_skills`, `get_skill`, `get_trust_breakdown`, `list_leaderboard`, `resolve_composition`), tool-domain misses via `isError: true` inside the success envelope with `succeeded: false` on the recorder, `X-Tenant-Id` propagation, unknown method + unknown tool name → `-32601`, batch dispatch preserving ids, empty batch → 400 `-32600`. `routing.test.ts` T-2.13 wire smoke updated (initialize returns `2025-03-26`, parse-error `-32700`, notification → 202). Total apps/local suite: **304/304 green**. Typecheck clean.
- ☑ **T-2.14** Discovery descriptors wired at `src/routes/mcp.ts`. `GET /mcp.json` + `GET /.well-known/mcp.json` (RFC 8615 alias) share one handler calling `buildDiscoveryDescriptor({ requestUrl: c.req.url, config: services.mcpConfig })` from `@skillsregistry/mcp`. Descriptor prefers `MCP_CANONICAL_ORIGIN` when set (production deploy); otherwise falls back to the request origin (local dev). Shape emitted: `schemaVersion: '1'`, `protocolVersion: '2025-03-26'`, `serverInfo { name, version }` from env, `transport { type: 'streamable-http', methods: ['POST'], endpoint: '${origin}/mcp' }`, `auth { model: 'none', tenantHeader: 'X-Tenant-Id' }` (v1 read-only advisory scope, not a security boundary), 5 tool definitions mirroring the dispatcher (`search_skills`, `get_skill`, `get_trust_breakdown`, `list_leaderboard`, `resolve_composition`) with input schemas, plus `documentation` + `openapi` URLs from `MCP_DOCUMENTATION_URL` / `MCP_OPENAPI_URL` when configured. Tests: 7 new in `src/routes/mcp.test.ts` (schemaVersion/protocolVersion/serverInfo, transport with request-origin fallback, `canonicalOrigin` override wins, doc/openapi overrides, auth posture, all 5 tools advertised, well-known alias returns byte-identical descriptor). Total apps/local suite: **311/311 green**. Typecheck clean.
- ☐ T-2.15 through T-2.18 — see `.specifica/mvp/tasks.md`

## License

Apache-2.0
