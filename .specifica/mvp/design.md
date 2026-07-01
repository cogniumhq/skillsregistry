# SkillsRegistry Local — MVP Design

**How the MVP is organized.** Structure, decisions, components, guardrails. Intent lives in `spec.md`. Open items live in `tasks.md`.

---

## 1. Repository layout

```
skillsregistry-local/
├── apps/
│   └── local/                          # Node app — the deliverable
│       ├── src/
│       │   ├── index.ts                # Hono + @hono/node-server entry
│       │   ├── adapters/               # Node implementations of domain interfaces
│       │   │   ├── pg-kv.ts            # KvAdapter over Postgres table
│       │   │   ├── pg-queue.ts         # QueueAdapter over Postgres NOTIFY/LISTEN (or in-process)
│       │   │   ├── fs-artifact.ts      # ArtifactAdapter over local filesystem
│       │   │   ├── ollama-embedder.ts  # EmbedderAdapter → localhost:11434
│       │   │   ├── upstream-embedder.ts# EmbedderAdapter → mothership (budgeted)
│       │   │   └── node-after-response.ts # AfterResponse via setImmediate
│       │   ├── upstream-client.ts      # ONLY module talking to api.skillsregistry.net
│       │   ├── trust-client.ts         # Budget-aware wrapper around upstream trust API
│       │   ├── budget/                 # Meter + admin surfaces
│       │   ├── migration/              # publish-to-mothership door
│       │   ├── routes/                 # Route modules (public, admin, MCP)
│       │   └── config.ts               # env-var parsing + defaults
│       ├── web/                        # Astro admin UI (@astrojs/node adapter)
│       ├── docker-compose.yml
│       ├── Dockerfile
│       └── package.json
├── packages/
│   ├── schema/          → @skillsregistry/schema      (Drizzle schema + migrations)
│   ├── contracts/       → @skillsregistry/contracts   (Zod: API + MCP + upstream types)
│   ├── domain/          → @skillsregistry/domain      (search, gate, reranker, composition, adapter interfaces)
│   ├── mcp/             → @skillsregistry/mcp         (5 tool handlers, discovery, invocation writer)
│   ├── eval/            → @skillsregistry/eval        (fixtures + runner + metrics)
│   └── dag/             → @skillsregistry/dag         (graph library, moved from mothership)
├── .changeset/
├── .github/workflows/
│   ├── ci.yml                          # typecheck + test + eval on PR
│   ├── publish-sdk.yml                 # changesets → npm on merge to main
│   └── publish-app.yml                 # docker build → ghcr on tag
├── .specifica/
│   ├── principles.md
│   └── mvp/
│       ├── spec.md
│       ├── design.md                   ← this file
│       └── tasks.md
├── pnpm-workspace.yaml
├── package.json                        # workspace root, no runtime deps
├── tsconfig.base.json
├── LICENSE                             # Apache-2.0
├── NOTICE
├── CLAUDE.md
├── CONTRIBUTING.md                     # CLA + PR template + testing requirements
├── CODE_OF_CONDUCT.md                  # Contributor Covenant 2.1
├── SECURITY.md                         # security@cognium.net, 90-day embargo
└── README.md
```

## 2. Package responsibilities

| Package | Owns | Depends on |
|---|---|---|
| `@skillsregistry/schema` | Drizzle schema, SQL migrations, migration runner, `SCHEMA_VERSION` constant | (nothing internal) |
| `@skillsregistry/contracts` | Zod schemas for every public API request/response, MCP tool I/O, upstream API types | `@skillsregistry/schema` (for shared shape types) |
| `@skillsregistry/domain` | `SearchProvider` interface + `PgVectorProvider`, confidence gate, reranker client, composition (fork/extend/compose), trust scoring policy (pure transform), resilience (circuit breaker), adapter interfaces (`KvAdapter`, `QueueAdapter`, `ArtifactAdapter`, `EmbedderAdapter`, `AfterResponse`) | `@skillsregistry/contracts`, `@skillsregistry/dag` |
| `@skillsregistry/mcp` | 5 tool handlers (`search_skills`, `get_skill`, `list_leaderboard`, `get_trust_breakdown`, `resolve_composition`), MCP discovery (`/.well-known/mcp.json`), invocation writer | `@skillsregistry/domain`, `@skillsregistry/contracts` |
| `@skillsregistry/eval` | 91-fixture eval suite, runner, metrics (R@1, R@5, MRR), CLI | `@skillsregistry/contracts` |
| `@skillsregistry/dag` | Graph library — DAG traversal, cycle detection, composition primitives | (nothing internal) |

Each package publishes independently via changesets. Semver rules in `principles.md` §Release discipline.

## 3. Adapter interfaces (the contract that enables portability)

`@skillsregistry/domain` exports interfaces — never runtime-coupled implementations. Every runtime-touching concern goes through one:

```ts
// @skillsregistry/domain/adapters.ts (shape only — signatures may evolve pre-1.0)
export interface KvAdapter {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface QueueAdapter {
  send(queueName: string, message: unknown): Promise<void>;
}

export interface ArtifactAdapter {
  put(key: string, body: ReadableStream): Promise<void>;
  get(key: string): Promise<ReadableStream | null>;
}

export interface EmbedderAdapter {
  embed(text: string): Promise<Float32Array>;
}

export interface AfterResponse {
  defer(work: Promise<unknown>): void;
}
```

Consumers wire adapters via constructor injection:

```ts
// apps/local/src/index.ts (sketch)
const search = new SearchService({
  provider: new PgVectorProvider(pool),
  kv: new PgKvAdapter(pool),
  embedder: process.env.EMBEDDING_PROVIDER === 'mothership'
    ? new UpstreamEmbedder(upstreamClient)
    : new OllamaEmbedder(process.env.OLLAMA_URL),
  after: new NodeAfterResponse(),
});
```

Mothership does the same with CF-binding-backed adapters. **No code in `@skillsregistry/domain` knows whether it runs on Node or Workers.**

## 4. Upstream client — the single mothership boundary

`apps/local/src/upstream-client.ts` is the ONLY module in `apps/local` that talks to `api.skillsregistry.net`. Every route handler either goes through it or works entirely locally.

Responsibilities:
- Trust score requests (metered)
- Global leaderboard proxying (unmetered, cached briefly)
- Skill fallback fetch (write-through cache when `MOTHERSHIP_URL` set)
- Migration publish (single-skill push-up)
- Delta pull for trust score refresh (nightly cron)
- Budget query (`GET /v1/tenant/budget`)

Guarantees:
- Per-tenant rate limit (default 10 req/s, env-configurable)
- Circuit breaker (default: open for 30s after 5 consecutive failures)
- Structured error mapping — every upstream error becomes a typed local error (`UpstreamBudgetExhausted`, `UpstreamNotConfigured`, `UpstreamTimeout`, `UpstreamUnavailable`)
- All logs tagged `mothership_call=true` for observability

## 5. Trust client + budget meter

`apps/local/src/trust-client.ts` wraps `upstream-client.trustScore(...)`:

- Calls mothership `POST /v1/trust/score` with `{ skill_id, manifest, content }`
- Persists returned `trust_score`, `trust_tier`, `trust_breakdown` locally
- Updates `trust_score_run` audit row for diffability
- Returns `tokens_used` and `tokens_remaining` on every response
- On `402 Payment Required` from mothership: writes structured error, surfaces in admin UI, keeps existing scores serving

Budget meter (`apps/local/src/budget/meter.ts`):
- Nightly cron: `GET /v1/tenant/budget` → cache result
- `GET /v1/admin/budget` route: returns cached `tokens_remaining` + last-refresh time
- Admin UI panel: green (>50% remaining), yellow (10-50%), red (<10%) + refresh button (calls mothership on-demand)
- Structured warning event fires when crossing the 10% threshold

## 6. Migration door

`POST /v1/migrate/publish?skill_id=<local-uuid>` (single-skill, MVP scope):

Flow:
1. Read local skill row (must be `origin='local'`)
2. Call `upstream-client.publish(...)` with manifest + content
3. Mothership returns `{ mothership_skill_id, version_id, publisher_signature }`
4. Update local row: `origin='mothership-mirror'`, `mothership_skill_id`, `parent_local_id` (retains local UUID for lineage)
5. Optionally schedule trust-score refresh (uses budget)
6. Return `{ mothership_skill_id, mothership_url }` for the admin UI to link

Bulk migration (`/v1/migrate/publish-all`) is post-MVP.

## 7. Search — local-first with configurable fallback

`GET /v1/search?q=...`:

1. Local pgvector index over subset (published + fallback-cached skills)
2. Confidence-gate the results using `@skillsregistry/domain` gate logic
3. If confidence below threshold AND `SEARCH_UPSTREAM_FALLBACK=true` AND budget allows → forward query to mothership, merge results, dedupe by skill ID
4. If air-gapped (`MOTHERSHIP_URL` unset) → return local results only, tag response `{ upstream_available: false }`

Fallback is opt-in by env var. Default: local-only. Reason: predictable latency + no surprise upstream calls on a local install.

## 8. MCP — same handlers, same delegation

`POST /mcp` and `/.well-known/mcp.json` served by `@skillsregistry/mcp`. Five tools mirror mothership:

| Tool | Local behavior |
|---|---|
| `search_skills` | Same as REST `/v1/search` — local-first, optional fallback |
| `get_skill` | Local DB, upstream write-through cache if missing |
| `list_leaderboard` | Always upstream (proxied via `upstream-client`) — no local rollup |
| `get_trust_breakdown` | Local DB row |
| `resolve_composition` | Local DAG traversal (composition is local-only) |

Invocation counts written non-blocking via `AfterResponse.defer(...)`.

## 9. Schema — one shape, two consumers

`@skillsregistry/schema` is a **single physical table shape**. Local doesn't fork columns; it just doesn't populate the ones it doesn't need (e.g., `sync_source`, `scan_queue_state`, `publisher_signature` on `origin='local'` rows).

New rules:
- `origin` column: `'local' | 'mothership-mirror'` — added in a migration owned by this package
- `parent_local_id` column: retained UUID after migration to mothership, for lineage
- `mothership_skill_id` column: set after migration, links local mirror to global

Migration ordering: append-only, versioned in `packages/schema/migrations/`. Mothership and local both run the full ladder; local skips migrations that are mothership-only (marked with a magic comment header — TBD in tasks).

Schema-version guard: `apps/local` boot script queries `SELECT max(version) FROM schema_migrations` and compares to the version baked in `@skillsregistry/schema`. Mismatch → container exits with clear error.

## 10. Runtime + package manager

| Concern | Choice | Reason |
|---|---|---|
| Runtime | Node 22+ for `apps/local`; CF Workers stays on mothership | Node has broadest local-dev support; Workers has proprietary APIs mothership already uses |
| HTTP | Hono + `@hono/node-server` | Zero-friction port from Workers Hono; mothership pattern preserved |
| DB driver | `pg` (standard) | Not `@neondatabase/serverless` — that's Workers-specific and local has no Hyperdrive |
| Frontend | Astro + `@astrojs/node` | Mothership uses `@astrojs/cloudflare`; local swaps the adapter, keeps the components |
| Package manager | pnpm workspaces | Best-in-class changesets integration; deterministic hoisting |
| Release automation | changesets | Multi-package independent versioning; industry standard |

## 11. Docker Compose — one-command deploy

`apps/local/docker-compose.yml` services:

| Service | Image | Purpose |
|---|---|---|
| `postgres` | `postgres:16` with `pgvector` extension | Local DB |
| `ollama` | `ollama/ollama:latest` | Local embeddings (pulls Qwen3-embedding on first run) |
| `app` | `ghcr.io/cogniumhq/skillsregistry-local:VERSION` | The node app + admin UI |

Startup script:
1. Wait for postgres
2. Run migrations from `@skillsregistry/schema`
3. Warm the Ollama model (blocking, one-time)
4. Verify mothership connectivity if `MOTHERSHIP_URL` set (non-blocking — logs warning)
5. Start Hono server on port from `PORT` env (default 8787)

## 12. CI + release flow

### On every PR
1. Install (pnpm, cached)
2. Typecheck across workspaces (`pnpm -r typecheck`)
3. Unit tests (`pnpm -r test`)
4. If any `packages/*` changed: check for changeset presence (fail if missing)
5. Build `apps/local` docker image (no push)
6. Optional: run eval against a spun-up local instance (matrix: air-gap + upstream-configured)

### On merge to `main`
1. Changesets action: if changesets present → bump versions → publish to npm → open a "Version PR" or push tags
2. Publish workflow: on version bump, build + push docker image to `ghcr.io/cogniumhq/skillsregistry-local:<version>`

### On version tag
Docker build + push with the exact tag.

## 13. Observability

- Structured JSON logs (`pino` or `winston`, choice deferred to first task)
- Every request logged with `request_id`, `tenant_id`, `route`, `status`, `duration_ms`
- Upstream calls logged with `mothership_call=true`, `endpoint`, `budget_remaining_after`
- `AfterResponse.defer(...)` wraps every observability write
- Admin UI surfaces recent errors + upstream call counts (last 24h)

## 14. Web admin UI

`apps/local/web/` — Astro + `@astrojs/node`:

Pages:
- `/` — dashboard: node health, budget gauge, recent activity
- `/skills` — list of locally-published skills, publish new
- `/budget` — full budget details, refresh, upgrade link
- `/migration` — table of local skills, per-row "Publish to mothership" action
- `/mcp` — MCP endpoint URL + curl copy-paste for wiring agents

Auth: single admin token in `ADMIN_TOKEN` env, passed as `Bearer <token>` header. No multi-user for MVP.

## 15. Deferred decisions (won't block MVP scaffolding)

- Exact logging library (`pino` vs `winston` vs pluggable)
- Local queue implementation: Postgres LISTEN/NOTIFY vs simple in-memory (probably in-memory — no cross-process work in MVP)
- Reranker for local: default off (matches mothership production tuning); env knob to enable via mothership call (budgeted)
- Test framework: vitest (mothership convention) unless a good reason to differ
- Admin UI component library: shadcn-style + Tailwind, matching mothership `web/` — or minimal HTML for MVP speed
- Whether local sets its own OS-level user in Docker for pgvector data ownership
- Publish-flow signing: for MVP, mothership handles signing on receipt; publisher-side signing is post-MVP

---

*Structural intent, current version. Change here when the design changes; move implementation-level open items to `tasks.md`.*
