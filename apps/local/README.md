# @skillsregistry/local

Self-hostable SkillsRegistry node — a private skill discovery + trust API
you run inside your own network. Consumer of the six `@skillsregistry/*` SDK
packages. Ships as a multi-arch image (Node 22 + Postgres 16 + Ollama alongside),
run via `docker compose up`.

> **On the image.** `docker compose up` pulls
> `ghcr.io/cogniumhq/skillsregistry` — no local build, no toolchain. To build
> from source instead (contributors, or an unpublished architecture):
> `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d`.
>
> The image is not standalone: it needs Postgres with pgvector and an embedder,
> which is what the compose file wires up. `docker run` on the image alone will
> start and then fail on a missing `DATABASE_URL`.

**What you get on `docker compose up`:**

- `POST /v1/skills`, `GET /v1/skills/:id`, `GET /v1/search?q=…` — a private
  skill index over your own manifests
- `POST /mcp` — MCP server exposing five read-only tools (`search_skills`,
  `get_skill`, `list_leaderboard`, `get_trust_breakdown`,
  `resolve_composition`) plus discovery at `/mcp.json`
- `http://localhost:3000/admin/` — web dashboard for health, budget, indexed
  skills, mothership migration, MCP wiring (no token on localhost; sign in with
  `ADMIN_TOKEN` over the network)
- Optional connected-mode passthrough to `api.skillsregistry.net` for trust
  scoring + leaderboards + publish-to-mothership

Air-gap is the default posture — nothing leaves your network unless you set
`MOTHERSHIP_URL`.

## Quickstart (5 minutes)

Prerequisites: [Docker Desktop](https://docs.docker.com/get-docker/) (or
Docker Engine + Docker Compose plugin), `curl`, `git`.

```bash
git clone https://github.com/cogniumhq/skillsregistry.git
cd skillsregistry/apps/local

# Copy env template and set a random ADMIN_TOKEN — this bearer token gates
# the /v1/admin/* + /v1/migrate/* endpoints for over-network callers.
# (Loopback callers, e.g. the admin UI at http://127.0.0.1:3000/admin/,
# skip the bearer check — see "Auth model" below.)
cp .env.example .env
# Edit .env: change ADMIN_TOKEN=change-me-to-a-long-random-value
# On macOS: openssl rand -hex 32 | tr -d '\n' | pbcopy
# On Linux: openssl rand -hex 32

# First boot pulls postgres (~150MB), ollama (~1GB), and the embedding
# model nomic-embed-text (~275MB). ~3-5 min on a fresh machine.
docker compose up -d

# Watch the app come up — done when you see "server listening on :3000".
docker compose logs -f app
```

**Verify the node is alive:**

```bash
# 1. Health probe — status:ok means db + embedder + migrations are all healthy.
curl -s http://localhost:3000/v1/health | jq
# → { "status": "ok", "checks": { "db": {...}, "embedder": {...}, ... } }

# 2. Publish a skill manifest.
curl -s -X POST http://localhost:3000/v1/skills \
  -H 'content-type: application/json' \
  -d '{
    "manifest": {
      "name": "example-skill",
      "slug": "example-skill",
      "version": "1.0.0",
      "source": "local",
      "execution_layer": "node",
      "description": "A trivial skill for smoke-testing the search path."
    }
  }' | jq
# → { "id": "…uuid…", "slug": "example-skill", ... }

# 3. Search for it. First query is slow (~3s) as Ollama warms;
# subsequent queries are sub-second.
curl -s 'http://localhost:3000/v1/search?q=example&limit=5' | jq
# → { "skills": [ { "slug": "example-skill", "score": ..., ... } ], ... }

# 4. MCP tools/list — same tools your agent will see.
curl -s -X POST http://localhost:3000/mcp \
  -H 'content-type: application/json' \
  -H 'x-tenant-id: local' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | jq
# → { "jsonrpc":"2.0","id":1,"result": { "tools": [ 5 tools ] } }

# 5. Open the admin UI (no login from localhost; over the network sign in
#    with your ADMIN_TOKEN).
open http://localhost:3000/admin/  # macOS
# xdg-open http://localhost:3000/admin/  # Linux
```

Or run the packaged smoke test — five assertions in ~5s:

```bash
pnpm --filter @skillsregistry/local smoke:airgap
# ✓ /v1/health   (status: ok, air-gap posture)
# ✓ /v1/search   (skills[] present)
# ✓ /mcp         (5 tools advertised)
# ✓ /v1/skills   (POST → 201 with .id)
# ✓ /v1/trust/score → 503 upstream_not_configured (air-gap correctness)
```

## Modes: air-gap vs connected

### Air-gap (default)

Nothing leaves your network. Best for private-corpus deploys.

Leave `MOTHERSHIP_URL` / `MOTHERSHIP_API_KEY` / `TENANT_ID` unset in `.env`.
Behaviour:

- `POST /v1/skills`, `GET /v1/skills/:id`, `GET /v1/search` — local only,
  local Postgres only, no upstream calls
- `POST /mcp` — full read-only surface backed by the local index
- `POST /v1/trust/score` — `503 upstream_not_configured` (no local scoring
  engine; trust scoring always goes through the mothership)
- `GET /v1/leaderboards/:kind` — `503 upstream_not_configured`
- `POST /v1/migrate/publish` — `503 upstream_not_configured`

### Connected

Register a tenant with the mothership at
[skillsregistry.net](https://skillsregistry.net) to get a `TENANT_ID` +
`MOTHERSHIP_API_KEY`, then set all three in `.env`:

```bash
# .env
MOTHERSHIP_URL=https://api.skillsregistry.net
MOTHERSHIP_API_KEY=sk_live_…       # from your mothership tenant dashboard
TENANT_ID=your-tenant-slug         # from your mothership tenant dashboard
UPSTREAM_SEARCH_FALLBACK=true      # optional: fall back to mothership search on local misses
```

`docker compose up -d --force-recreate app` to pick up the new env. Effects:

- `POST /v1/trust/score` — proxies to the mothership; results cached against
  the local skills row (`trust_score_v2`, `trust_tier`, `trust_results`,
  `trust_analyzed_at`) and budget decremented in KV
- `GET /v1/leaderboards/:kind` — proxied from `api.skillsregistry.net`
- `GET /v1/admin/budget` — real budget snapshot polled hourly
- `POST /v1/migrate/publish?skill_id=<uuid>` — publish local manifests up to
  the mothership; each row's `mothership_publish_status` transitions to
  `published` with a `mothership_url`
- `GET /v1/search` — local index first; falls back to mothership on low
  confidence (if `UPSTREAM_SEARCH_FALLBACK=true`)

The upstream client at `src/upstream-client/` is the **only** module that
talks to `api.skillsregistry.net` — token-bucket rate limited + circuit
breaker + typed `UpstreamError` taxonomy. If the mothership is down, the
local node stays up and gracefully returns `503 upstream_not_configured` or
the local-only view.

## Mothership compatibility

The local node and the hosted mothership (`api.skillsregistry.net`) share the
same schema, handlers, and MCP tool surface, but a few HTTP-shape differences
exist on the public REST surface. Know these before copy-pasting ops between the
two (the migrate/upstream client already adapts internally — this matters for
humans following one README).

| Concern | Local (`apps/local`) | Mothership (`api.skillsregistry.net`) |
|---|---|---|
| Health | `GET /health` **and** `GET /v1/health` | `GET /health` (its `/v1/health` is 404) |
| Search verb | `GET /v1/search?q=…` | `POST /v1/search` (JSON body) |
| Search query field | `q` (query param) | `query` (**required**, body) |
| Search tenant | `X-Tenant-Id` header (optional) | `tenantId` (**required**, body) |
| Hits array | `.skills[]` | `.results[]` |

Health is aligned as of #45 — both nodes answer `GET /health`, so a liveness
probe is portable. The **search** surface is intentionally different: the local
node ships a simple `GET` for quick single-operator use; the mothership takes a
richer `POST` (confidence tiers, filters, tenant scoping). Concrete examples:

```bash
# Local — GET, `q`, `.skills[]`
curl -s 'http://localhost:3000/v1/search?q=kubernetes%20mcp&limit=2' | jq '.skills'

# Mothership — POST, `query`+`tenantId`, `.results[]`
curl -s -X POST https://api.skillsregistry.net/v1/search \
  -H 'content-type: application/json' \
  -d '{"query":"kubernetes mcp","tenantId":"public","limit":2}' | jq '.results'
```

Aligning the search request/response shapes (a `POST /v1/search` alias on the
local node, or a mothership `q`/`.skills[]` compat layer) is a larger contract
decision tracked separately; the matrix above is the source of truth until then.
The mothership adding a `GET /v1/health` alias for full path symmetry is a
mothership-side follow-up (cross-linked from #45).

## Auth model

Two-tier by design:

- **Loopback (127.0.0.1 / ::1)** — the admin API (`/v1/admin/*`) and migration
  door (`/v1/migrate/*`) skip the bearer entirely from localhost, so the admin
  UI at `http://127.0.0.1:3000/admin/` needs no token. This is intentional: on
  a single-operator local node, requiring a login on `curl 127.0.0.1:…` is
  ceremony. The bypass keys on the socket's remote address and fails **closed**
  — unknown / missing addresses require the token.
- **Over-network** (Docker bridge, LAN) — the admin/migrate **APIs** require
  `Authorization: Bearer $ADMIN_TOKEN`; the static UI shell (no secrets) loads
  for anyone and prompts for the `ADMIN_TOKEN` on its first API call, sending it
  as a bearer thereafter. This is what makes the dashboard usable under the
  default Docker bridge publish, where the container only ever sees the bridge
  gateway IP and can never observe a loopback source (#44). For a pure-API
  deployment with no dashboard, keep the default loopback bind.

**Host binds.** The Compose file publishes the app, Postgres and Ollama on
`127.0.0.1` only (#99): Postgres ships with a well-known password and
`POST /v1/skills` is unauthenticated on a single-tenant node, so nothing is
reachable from the LAN until you opt in. Set `APP_BIND=0.0.0.0` in `.env` to
serve the node over the network; set `POSTGRES_PASSWORD` before you ever
widen `POSTGRES_BIND`. All documented `.env` knobs (`SEARCH_*`, `BUDGET_*`,
`ARTIFACT_BASE_DIR`, `MCP_*`, …) reach the container via `env_file` (#98).

Public routes (`/v1/health`, `/v1/search`, `/v1/skills`, `/v1/skills/:id`,
`/v1/trust/score`, `/v1/leaderboards/:kind`, `/mcp`, `/mcp.json`,
`/.well-known/mcp.json`) have no auth in v1 — tenant scoping is advisory via
`X-Tenant-Id` header. This is a read-only server by contract; write auth
(OAuth 2.1 + RFC 8707) lands with the v2 write tools.

## Admin UI

Open `http://localhost:3000/admin/` (from the same machine — the UI is
loopback-only). Six pages:

| Route | What |
|---|---|
| `/admin/` | Dashboard: health probes + budget gauge, auto-refreshes every 30s |
| `/admin/health/` | Per-subsystem probe view (db, embedder, mothership, migrations) |
| `/admin/budget/` | Mothership budget snapshot + refresh button |
| `/admin/skills/` | Indexed skills, newest first |
| `/admin/migration/` | Per-row "Publish to mothership" action + status pill |
| `/admin/mcp/` | Endpoint / discovery status / curl + Claude Desktop snippets |

## MCP client wiring

Point any MCP client at `http://localhost:3000/mcp`. The `/admin/mcp/` page
generates copy-paste config for Claude Desktop; the equivalent by hand for
`~/.config/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "skillsregistry-local": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:3000/mcp"]
    }
  }
}
```

Discovery lives at `GET /.well-known/mcp.json` (RFC 8615) with an alias at
`GET /mcp.json`. Five tools advertised, all read-only:

- `search_skills` — fused vector + text search over the local index
- `get_skill` — lookup by id / slug / mothership_skill_id
- `list_leaderboard` — trust / trending / agents / composed / forked (needs
  connected mode)
- `get_trust_breakdown` — the 7-dimension trust slice + tier (needs
  connected mode; falls back to `{ found: false }` in air-gap)
- `resolve_composition` — composition lineage lookup (returns
  `{ found: false }` in v1 — no local composition index yet)

## Local development

For editing the SDK packages or the app itself:

```bash
# Install workspace deps + build every @skillsregistry/* package.
pnpm install
pnpm --filter '@skillsregistry/*' build

# Postgres + Ollama from the compose file (skip the app container).
cd apps/local
docker compose up -d postgres ollama ollama-init

# Point the local dev server at those bindings.
export DATABASE_URL='postgres://skillsregistry:skillsregistry@localhost:5432/skillsregistry'
export ADMIN_TOKEN='dev-token'
export OLLAMA_URL='http://localhost:11434'

# Watch mode with tsx.
pnpm --filter @skillsregistry/local dev
```

Admin UI dev server (standalone Astro at `:4321`, proxies API calls through
to `:3000`):

```bash
pnpm --filter @skillsregistry/local-web dev
```

Full test suite (~1s, 1024 tests):

```bash
pnpm -w -r test
pnpm -w -r typecheck
```

## Environment variables

Only two are required — everything else has a sensible default in
`src/config.ts`. See `.env.example` for the full annotated list.

| Var | Required? | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | ✓ | — | libpq connection string to Postgres 16 + pgvector |
| `ADMIN_TOKEN` | ✓ | — | Bearer token for over-network admin/migration calls |
| `PORT` | | `3000` | HTTP bind port |
| `EMBEDDER` | | `ollama` | `ollama` or `upstream` |
| `OLLAMA_URL` | | `http://localhost:11434` | Ollama server for local embeddings |
| `OLLAMA_EMBEDDING_MODEL` | | `nomic-embed-text` | 768-dim; matches the schema baseline |
| `MOTHERSHIP_URL` | | — | Unset ⇒ air-gap mode |
| `MOTHERSHIP_API_KEY` | | — | Required if `MOTHERSHIP_URL` is set |
| `TENANT_ID` | | — | Required if `MOTHERSHIP_URL` is set |
| `LOG_FORMAT` | | `json` | `json` (NDJSON for log collectors) or `pretty` (dev) |
| `LOG_LEVEL` | | `info` | `trace` / `debug` / `info` / `warn` / `error` / `fatal` |

## Troubleshooting

**`ADMIN_TOKEN is required — set it in .env` on `docker compose up`.**
`docker-compose.yml` uses `${ADMIN_TOKEN:?…}` to fail-fast when the var is
unset. Edit `apps/local/.env` and add a value; `.env.example` won't be
picked up automatically (name it `.env`).

**First `/v1/search` hangs for minutes.** Ollama is still pulling
`nomic-embed-text` (~275MB). `docker compose logs ollama-init` shows the
pull progress. Subsequent queries hit the warm model at sub-second latency.

**`upstream_not_configured` on `/v1/trust/score`.** Expected in air-gap
mode — trust scoring only runs on the mothership. Set the three upstream
env vars to switch to connected mode.

**Admin UI returns 403 from a browser on the same LAN.** By design — the UI
is loopback-only. Access it from the machine running Docker, or SSH-tunnel
`ssh -L 3000:localhost:3000 user@host`.

**Port 3000 already in use.** Set `PORT=3001` (or any free port) in `.env`
and re-`up -d`. The compose file threads it through as
`"${PORT:-3000}:3000"`.

## Implementation status

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
- ☑ **T-2.15** Structured logging via `pino@9` (json default, `pino-pretty` opt-in with `LOG_FORMAT=pretty`) + request-id middleware at `src/middleware/request-logger.ts`. `LogConfig` extended with `format` + `requestIdHeader`; two new env vars `LOG_FORMAT` and `LOG_REQUEST_ID_HEADER` (default `X-Request-Id`, RFC 7230 tchar-guarded ≤64 chars). New `src/logging/` module exposes `createLogger(config)`, `createSilentLogger()`, and `adaptToPortLogger(pinoChild)` which bridges pino's `(mergingObject, message)` arg order into the `PortLogger { info(msg, meta), warn, error }` shape the five existing domain modules (`trust-client`, `budget-meter`, `publish-to-mothership`, `skills-client`, `boot-schema`) already accept — no downstream interface changes. `AppServices` gained a `logger: PinoLogger` field; `buildAppServices(config, pool, logger)` fans a `.child({ module: '<name>' })` per module through the port adapter so log lines carry module context. `createApp` mounts `requestLogger` first so the summary line covers the full handler duration (including `tenantContext` + admin bearer). The middleware honors an inbound `X-Request-Id` (validated `/^[A-Za-z0-9._-]{1,128}$/`) or mints `crypto.randomUUID()`, stashes `requestId` + a bound `PinoLogger` on `c`, echoes the id on the response, and emits one JSON line after `await next()` with `status`, `duration_ms` (from `process.hrtime.bigint()`), `tenant_id`, and `err` from `c.error` when Hono caught a throw. Level is status-based (5xx / thrown → ERROR, 4xx → WARN, else INFO) — Hono catches handler errors internally before middleware can `try/catch`, so this is the access-log posture, not the wrap-and-rethrow one. `main()` boots pino before the logger-less phases (`ConfigError` still stderr since it's upstream of `createLogger`); after that everything uses `bootLogger` instead of `console.log`. Test coverage: 7 in `src/logging/logging.test.ts`, 8 in `src/middleware/request-logger.test.ts`, plus 6 new `config.test.ts` cases. Total apps/local suite: **331/331 green**. Typecheck + build clean.
- ☑ **T-2.16** Docker Compose polished into a one-command deploy. Four services in `docker-compose.yml`: `postgres` (`pgvector/pgvector:pg16` + named `postgres-data` volume + `pg_isready` healthcheck), `ollama` (`ollama/ollama:latest` + named `ollama-models` volume + `ollama list` healthcheck), `ollama-init` (one-shot warmer — waits for the server, runs `ollama pull ${OLLAMA_EMBEDDING_MODEL:-nomic-embed-text}`, exits; idempotent thanks to the shared model volume), and `app` (built from `apps/local/Dockerfile`, depends on all three including `ollama-init: service_completed_successfully` so the first `/v1/search` never races a cold model). Env passthrough covers every var an operator commonly touches (Core / Postgres pool / Embedder / Upstream / Logging / MCP); `ADMIN_TOKEN` is enforced via `${ADMIN_TOKEN:?...}` so `docker compose up` without a token fails immediately. Compose auto-loads `apps/local/.env` for variable substitution — copy from the tracked `.env.example` template (rewritten to advertise the full var surface with defaults inlined). Volumes persist across `docker compose down`; use `docker compose down -v` to wipe. Validated with `docker compose config` (clean parse); Docker build/run happens in T-2.17.
- ☑ **T-2.17** Dockerfile polished. The multi-stage layout was already scaffolded at T-2.1 (build → runtime, non-root `app:app`, wget healthcheck on `/v1/health`); this task fixed the remaining rough edges and delivered a functioning image end-to-end. Fixed a latent build break: the build stage was missing `COPY scripts ./scripts`, so `packages/schema`'s postbuild step (`node ../../scripts/copy-sql.mjs ...`) exploded with `MODULE_NOT_FOUND` on the first real `docker build`. Added a new `apps/local/entrypoint.sh` that documents the design §11 five-phase startup sequence (Postgres reachability gated by compose; migrations applied inline by `bootSchema`; Ollama model warmed by the `ollama-init` sidecar; mothership connectivity probed non-blocking by the budget-meter; HTTP server binds last) before `exec node --enable-source-maps ./dist/index.js` — the `exec` keeps Node as PID 1 so SIGINT/SIGTERM reach the existing shutdown hook. Switched `CMD` → `ENTRYPOINT` and added five OCI image labels for supply-chain identification (`org.opencontainers.image.{title,description,source,licenses,vendor}`). Verified end-to-end: `docker build` succeeds, `docker inspect` confirms non-root + entrypoint + healthcheck + labels, `docker run --rm` prints the boot banner and correctly fail-fasts with `exit=1` on missing `DATABASE_URL` / `ADMIN_TOKEN`.
- ☑ **T-2.18** Air-gap smoke test tooling at `apps/local/scripts/smoke-airgap.sh` (bash + curl + jq; wired as `pnpm --filter @skillsregistry/local smoke:airgap`). Five hard checks against a live node with `MOTHERSHIP_URL` unset — health posture (`upstreamConfigured: false`, `dbReachable: true`), `GET /v1/search` (asserts `.skills[]` present), `POST /mcp` `tools/list` (5 tools), `POST /v1/skills` (unique per-run slug, asserts response `.id`), and `POST /v1/trust/score` with `{ "skill_id": "<id>" }` (asserts **503 with `error.code = upstream_not_configured`** — fail-open would be a bug). Idempotent, colored output, fail-fast on the first bad assertion, configurable via `BASE_URL` / `HEALTH_TIMEOUT` / `SMOKE_SLUG`. The first live run surfaced a pre-existing schema bootstrap gap (migration `0001` refs `skills(id)` but no migration creates the base table — carried over from mothership assumptions); resolved by T-2.19 below. First green live run: `docker compose down -v && docker compose up -d && ./scripts/smoke-airgap.sh` → all 5 assertions pass in ~40s from empty volume.
- ☑ **T-2.19** Schema bootstrap shipped as `packages/schema/src/migrations/0000_skills_base.sql` — the smallest column set (pre-0004 baseline: 20 columns / 3 indexes / 1 extension) that lets 0001–0033 apply in order against an empty Postgres. Rejected the drizzle-kit path because the Drizzle definition at `schema.ts` reflects the *final* v6.2 shape (130+ columns), many added by later ALTER migrations with their own CHECK constraints — generating the full table at bootstrap collides with 0005/0010/etc. rewrites. Seeded: `id` UUID PK + `pgcrypto` for `gen_random_uuid()`, core metadata (`name`, `slug` UNIQUE, `version`, `source`, `description`), content/retrieval fields (`agent_summary`, `alternate_queries`, `schema_json`, `auth_requirements`, `install_method`, `capabilities_required`), quality/execution (`trust_score`, `execution_layer`, `content_safety_passed`), discovery (`tags`, `category`), the legacy `cognium_scanned` BOOLEAN referenced by 0012's UPDATE (per the CLAUDE.md known-issue note — prod paths use `cognium_scanned_at IS NULL`), and timestamps. Deliberately omitted: `status`/`type` (added by 0005 with their own CHECKs — front-loading collides) and the 90+ columns added by 0004–0033. All statements idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE EXTENSION IF NOT EXISTS`) so existing mothership databases with the table already present no-op cleanly. Runner picks it up via lexicographic sort in `loadBundledMigrations()`. During verification the initial 14-column bootstrap surfaced two more gaps requiring iteration: 0005's `CREATE INDEX ... USING gin(tags)` needed `tags TEXT[]` seeded (confirmed by 0005's own comment "tags already exists as text[], skip it"), and 0012's `UPDATE skills SET cognium_scanned = false WHERE cognium_scanned = true` needed the legacy boolean. Also fixed two field-name drift bugs in `smoke-airgap.sh` surfaced during first live green: `/v1/search` returns `.skills[]` (not `.results[]`) and `POST /v1/skills` returns `.id` (not `.skill_id`) though `POST /v1/trust/score` still takes `{ "skill_id": "..." }` per `TrustScoreRequestSchema`. End-to-end: `docker compose down -v` → `docker compose up -d` → 34 migrations applied cleanly (`applied 0000_skills_base.sql` through `applied 0033_mothership_publish.sql`, `[schema] boot: complete`) → `./scripts/smoke-airgap.sh` all 5 assertions green.
- ☑ **T-3.1 → T-3.8** Admin web UI at `apps/local/web/` — Astro 5 static bundle mounted by Hono at `/admin/*`. Loopback-only auth model (no login): `src/middleware/loopback-only.ts` hard-rejects non-`127.0.0.1`/`::1` origins with 403, and `admin-auth.ts` skips bearer verification on loopback so `curl http://127.0.0.1:3000/admin/` renders unauthenticated while `curl http://<lan-ip>:3000/admin/` returns 403. Six pages: `/admin/` dashboard (health probes + budget gauge; auto-refreshes), `/admin/health/` (deep subsystem view), `/admin/budget/` (mothership budget + refresh button), `/admin/skills/` (indexed skills, newest first), `/admin/migration/` (per-row publish → mothership), `/admin/mcp/` (endpoint / discovery status / curl + Claude Desktop snippets with copy-to-clipboard). Pure Astro components + Tailwind v4 (no React/Vue/Alpine islands); interactive bits use vanilla `<script>` blocks that fetch `/v1/admin/*` on `DOMContentLoaded`. Design tokens copied from mothership `web/src/styles/global.css` (emerald `#6ee7b7` on near-black `#0a0a0b`, Inter + JetBrains Mono). New admin endpoint `GET /v1/admin/skills?limit=100&offset=0` at `src/routes/admin.ts` returns `{ skills, total, limit, offset }` per `AdminSkillsListResponseSchema` (patch bump on `@skillsregistry/contracts` deferred until Phase 3 fully lands). MCP page uses an `__ORIGIN__` sentinel rewritten client-side to `window.location.origin` so the static bundle works at any origin without SSR. Dev: `pnpm --filter @skillsregistry/local-web dev` (standalone Astro at `:4321`). Prod bundle: `pnpm --filter @skillsregistry/local build` (Astro `dist/` copied into the Docker image); served at `http://localhost:3000/admin/`.

## License

Apache-2.0
