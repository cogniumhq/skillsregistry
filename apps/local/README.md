# @skillsregistry/local

Self-hostable SkillsRegistry node — a private skill discovery API
you run inside your own network. Consumer of the six `@skillsregistry/*` SDK
packages. Builds from source (Node 22 + Postgres 16 + Ollama) — which is what
`docker compose up` does, and the supported path today.

> **On the prebuilt image.** CI publishes
> `ghcr.io/cogniumhq/skillsregistry-local` — versioned tags and a mutable
> `latest` tag, multi-arch for
> linux/amd64 and linux/arm64, public and pullable without a token.
>
> It is **not standalone**: it needs Postgres with pgvector and an embedder,
> which is what the compose file below wires up. `docker run` on the image
> alone starts and then fails on a missing `DATABASE_URL`. The Quickstart
> builds from source; to run the published image instead, point your own
> compose at it.

**What you get on `docker compose up`:**

- `POST /v1/skills`, `GET /v1/skills/:id`, `GET /v1/search?q=…` — a private
  skill index over your own manifests
- `POST /mcp` — MCP server exposing five read-only tools (`search_skills`,
  `get_skill`, `list_leaderboard`, `get_trust_breakdown`,
  `resolve_composition`) plus discovery at `/mcp.json`
- `http://localhost:3000/admin/` — web dashboard for health, budget, indexed
  skills, hosted publishing, and MCP wiring. With Docker Compose, the app sees
  the Docker bridge address, so enter `ADMIN_TOKEN` when prompted.
- Optional connected-mode passthrough to `api.skillsregistry.net` for trust
  scoring + leaderboards + publish-to-mothership

Air-gap is the default runtime posture: the node makes no upstream API calls
unless you set `MOTHERSHIP_URL`. A fresh Docker Compose install still downloads
container images and the Ollama embedding model.

## Quickstart

Prerequisites: [Docker Desktop](https://docs.docker.com/get-docker/) (or
Docker Engine + Docker Compose plugin), `curl`, `jq`, `git`.

```bash
git clone https://github.com/cogniumhq/skillsregistry.git
cd skillsregistry/apps/local

# Copy env template and set a random ADMIN_TOKEN — this bearer token gates
# the /v1/admin/* + /v1/migrate/* endpoints for over-network callers.
# (Direct loopback callers skip the bearer check. Docker Compose callers
# cross a bridge and must enter this token in the admin UI.)
cp .env.example .env
# Edit .env: change ADMIN_TOKEN=change-me-to-a-long-random-value
# On macOS: openssl rand -hex 32 | tr -d '\n' | pbcopy
# On Linux: openssl rand -hex 32

# First boot pulls Postgres, Ollama, and the nomic-embed-text embedding model.
docker compose up -d

# Watch the app come up — done when you see "server listening on :3000".
docker compose logs -f app
```

**Verify the node is alive:**

```bash
# 1. Health probe — status:ok means the database is reachable.
curl -s http://localhost:3000/v1/health | jq
# → { "status": "ok", "dbReachable": true, "upstreamConfigured": false, ... }

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

# 5. Open the admin UI and enter ADMIN_TOKEN when prompted by the
#    Docker Compose deployment.
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
- `POST /mcp` — five read-only tools advertised; search and skill lookup use
  the local index, while leaderboard and composition results are unavailable
  without their respective data sources
- `POST /v1/trust/score` — `503 upstream_not_configured` (no local scoring
  engine; trust scoring always goes through the mothership)
- `GET /v1/leaderboards/:kind` — `503 upstream_not_configured`
- `POST /v1/migrate/publish` — `503 upstream_not_configured`

### Connected

Connected mode requires a provisioned `TENANT_ID` and `MOTHERSHIP_API_KEY`.
Self-serve signup is not available yet; contact
[Cognium Labs](mailto:hello@cognium.net) if you need access. Once provisioned,
set all three values in `.env`:

```bash
# .env
MOTHERSHIP_URL=https://api.skillsregistry.net
MOTHERSHIP_API_KEY=sk_live_…       # provisioned by Cognium Labs
TENANT_ID=your-tenant-slug         # provisioned by Cognium Labs
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
- `GET /v1/search` — continues to search the local index; upstream search
  fallback is not implemented.

The upstream client at `src/upstream-client/` is the **only** module that
talks to `api.skillsregistry.net` — token-bucket rate limited + circuit
breaker + typed `UpstreamError` taxonomy. If the mothership is down, the
local node stays up and gracefully returns `503 upstream_not_configured` or
the local-only view.

## Hosted service compatibility

The local node and hosted service (`api.skillsregistry.net`) share SDK
contracts, but their public endpoints differ. The hosted MCP endpoint currently
offers seven tools; the local node advertises five, with some tools returning
empty results in air-gap mode. Check these REST differences before reusing a
request across deployments:

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
reachable from the LAN until you opt in. Exposing `APP_BIND=0.0.0.0` also
exposes the unauthenticated local publishing route; put the node behind your
own access control before serving it over a network. Set `POSTGRES_PASSWORD`
before you ever widen `POSTGRES_BIND`. All documented `.env` knobs (`SEARCH_*`, `BUDGET_*`,
`ARTIFACT_BASE_DIR`, `MCP_*`, …) reach the container via `env_file` (#98).

Public routes (`/v1/health`, `/v1/search`, `/v1/skills`, `/v1/skills/:id`,
`/v1/trust/score`, `/v1/leaderboards/:kind`, `/mcp`, `/mcp.json`,
`/.well-known/mcp.json`) have no auth in v1 — tenant scoping is advisory via
`X-Tenant-Id` header. The MCP tools are read-only, but the HTTP
`POST /v1/skills` route writes to the local index without authentication.

## Admin UI

Open `http://localhost:3000/admin/` from the same machine with the default
Compose bind. The static UI can also load over a network if you enable
`APP_BIND=0.0.0.0`; its data requests then require `ADMIN_TOKEN`. Six pages:

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
    "skillsregistry": {
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

Run the workspace tests and typechecks:

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
| `EMBEDDER` | | `ollama` | Use `ollama`; `upstream` currently fails at boot |
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

**The app stays in startup while Ollama downloads the model.**
`docker compose logs ollama-init` shows the pull progress. The app starts
after the model is ready.

**`upstream_not_configured` on `/v1/trust/score`.** Expected in air-gap
mode — trust scoring only runs on the mothership. Set the three upstream
env vars to switch to connected mode.

**Admin UI prompts for a token.** Enter the `ADMIN_TOKEN` from your `.env`.
Docker bridge requests require it even when you open the UI from the same
machine. Keep the default loopback bind unless you have network access
controls in front of the node.

**Port 3000 already in use.** Set `PORT=3001` (or any free port) in `.env`
and re-`up -d`. The compose file uses
`"${APP_BIND:-127.0.0.1}:${PORT:-3000}:3000"`.

## Implementation notes

The current local node implements its HTTP routes in `src/routes/`, MCP adapters
in `src/mcp/`, and configuration in `src/config.ts`. See those files and the
workspace tests for behavior details. Known limits: local composition lookup
always reports no match, upstream embeddings are not implemented, and hosted
trust scoring requires provisioned connected-mode credentials.

## License

Apache-2.0
