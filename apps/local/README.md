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
- ☐ T-2.8 through T-2.18 — see `.specifica/mvp/tasks.md`

## License

Apache-2.0
