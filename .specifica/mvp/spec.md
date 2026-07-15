# SkillsRegistry Local — MVP Spec

**What this version is.** Outcomes, scope, constraints, acceptance criteria. Implementation detail lives in `design.md`. Open items live in `tasks.md`.

---

## 1. Purpose

Enable any developer or team to run a private, single-tenant SkillsRegistry instance in isolation. They own their tenant subtree, publish their own skills locally, and reach the mothership (`api.skillsregistry.net`) only for:

- **Trust scoring** — metered by a monthly token budget granted at registration
- **Global leaderboards** — proxied, always fresh from mothership
- **Skill fallback** — on-demand fetch + local caching of skills the user's agents request but haven't published locally
- **Migration door** — one-click publish a local skill up to mothership (for going public or moving to hosted enterprise)

The MVP proves this shape end-to-end for a single-tenant local install.

## 2. Outcomes

At the end of MVP:

1. **Two artifacts publishable:**
   - Six `@skillsregistry/*` npm packages at `1.0.0` (schema, contracts, domain, mcp, eval, dag)
   - One Docker image `ghcr.io/cogniumhq/skillsregistry-local:1.0.0` running `apps/local`

2. **Mothership consumes the SDK.** `cogniumhq/skillsregistry` imports `@skillsregistry/schema`, `contracts`, `domain`, `mcp`, `dag` from npm. Its inlined copies of these modules are deleted. Mothership's existing eval suite (R@5 ≥ 80%) continues to pass.

3. **Local install works via `docker compose up`.** Fresh clone → paste tenant credentials into `.env` → `docker compose up` → local node serving `/v1/search`, `/mcp`, `/v1/skills/:id`, `/v1/skills` (publish) on `localhost:8787` within 5 minutes on a typical developer machine.

4. **Trust scoring works through the mothership API.** Local user requests a trust score for a locally-published skill → local node calls mothership `/v1/trust/score` with their `MOTHERSHIP_API_KEY` → score persisted locally, budget decremented. `tokens_remaining` surfaces in the admin UI.

5. **Migration door works.** `POST /v1/migrate/publish?skill_id=<local-uuid>` on the local node → mothership publish → local row updated with `origin='mothership-mirror'`, `mothership_skill_id` set, `parent_local_id` retained.

6. **Air-gap mode works.** With `MOTHERSHIP_URL` unset, search + MCP + composition + local publish still function. Trust and leaderboard endpoints return the correct 402/503 with a machine-readable reason.

## 3. Scope

### In scope

- Six SDK packages under `packages/`
- One Node app under `apps/local/`
- Docker Compose (Postgres + Ollama + node app) for one-command deploy
- Astro-based admin UI (`apps/local/web/`) surfacing: budget, published skills, migration door, node health
- Upstream client with circuit breaker + per-tenant rate limit
- Trust client wrapping the metered mothership API
- Budget meter (nightly cron pulls `tokens_remaining` + surfaces in UI)
- Migration door (single-skill publish-up)
- MCP server at `/mcp` with the same 5 tools as mothership (`search_skills`, `get_skill`, `list_leaderboard`, `get_trust_breakdown`, `resolve_composition`); leaderboard proxies upstream
- Schema-version guard at boot
- Eval suite runnable against a local endpoint
- pnpm workspaces + changesets for SDK release automation
- CI: typecheck, unit tests, eval on PR; changeset-driven npm publish on merge to `main`

### Out of scope (deferred to post-MVP)

- Multi-tenant local install (one tenant per Docker Compose stack for MVP)
- Local Circle-IR scan (all trust scoring goes through mothership)
- Local sync workers (the 7 mothership sources — Glama, PulseMCP, Smithery, OpenClaw, MCP Registry, publishers, scanned repos)
- Enterprise SSO / SAML in local admin UI
- Publisher signing PKI local key-management UI (D2 in mothership)
- Bulk migration (`/v1/migrate/publish-all`) — single-skill only for MVP
- Cross-region replication of the local install
- Backwards-compat with pre-`1.0.0` prereleases

## 4. Constraints

### License
- Apache-2.0 for every file in this repo. No per-package overrides.

### Runtime
- Node 22+ for `apps/local`. TypeScript throughout.
- `packages/domain` must be runtime-neutral (works on Node AND CF Workers via adapters).
- Postgres 16 + pgvector for the local DB.
- Ollama on `localhost:11434` for embeddings by default; `EMBEDDING_PROVIDER=mothership` opt-in.
- Docker Compose is the reference deploy. Bare-metal is a stretch goal, not a constraint.

### Embedder posture (deliberate divergence from portfolio-canonical)
- Local uses **`nomic-embed-text`** (768-d native) truncated + L2-renormalized to **`halfvec(512)`** via MRL, served from Ollama.
- Portfolio-canonical per `techspec/principles.md` §2 + §12 is **Qwen3-Embedding-4B + Qwen3-Reranker via llmproxy → DeepInfra/Together** (open weights, managed API, off Workers AI post the May-2026 cost incident).
- The divergence is deliberate: the local node's use case is self-hostable / air-gapped operators, so a small model that runs under Ollama on modest hardware wins over the portfolio's managed-API choice.
- **Consequence — embeddings are NOT cross-node comparable.** Cosine similarity between a vector produced locally (`nomic-embed-text@ollama-mrl-512`) and one produced upstream (`qwen3-embedding-0.6B` via llmproxy) is meaningless. `skill_embeddings.embed_model` stamps the identity on every row so consumers can gate on identity match before comparing; the local node MUST re-embed on any cross-source ingestion path.
- Cross-node embedding **sync is out of scope**. Trust scores and skill metadata sync; vectors don't.

### Tenancy
- Single tenant per install. `TENANT_ID` and `MOTHERSHIP_API_KEY` are env vars, baked at deploy.
- Schema retains the `tenant_id` column for migration-compat with mothership, but every local row has the same value.

### Upstream
- One and only one module (`apps/local/src/upstream-client.ts`) talks to `api.skillsregistry.net`.
- Every upstream call is budgeted, rate-limited, and circuit-broken.
- Air-gap is a supported mode: with `MOTHERSHIP_URL` unset, search + MCP + composition + local publish keep working; upstream-dependent endpoints return 402/503 with reason codes.

### API compatibility
- Every public API route in `apps/local` conforms to a Zod schema in `@skillsregistry/contracts`.
- The mothership's corresponding routes conform to the same schemas.
- Breaking a schema is a major version bump on `contracts` AND a coordinated PR in mothership.

### No queues
- `apps/local` has no queue infrastructure. The mothership's 7 CF Queues do not exist here. Any deferred work is either (a) `AfterResponse.defer(...)` for observability, or (b) a foreground script run manually.

### Vendoring
- No `file:` dependencies except across workspace packages within this repo.
- `@skillsregistry/dag` moves from mothership's vendored `packages/dag/` to `packages/dag/` here; mothership consumes it from npm.

## 5. Acceptance criteria

The MVP is complete when **all** of the following pass:

| # | Criterion | Verification |
|---|---|---|
| 1 | All six SDK packages publish to npm at `1.0.0` under `@skillsregistry/*` | `npm view @skillsregistry/schema version` returns `1.0.0` for each package |
| 2 | Mothership repo has zero inlined copies of the extracted modules | `grep -r "db/schema" cogniumhq/skillsregistry/src/` returns only import statements from `@skillsregistry/schema` |
| 3 | Mothership eval suite passes with SDK packages consumed from npm | `scripts/run-eval.ts` reports R@5 ≥ 80% |
| 4 | Local Docker install starts within 5 minutes on a fresh machine | Timed run from `git clone` to `curl localhost:8787/health` returning 200 |
| 5 | Publish endpoint works locally | `POST /v1/skills` with a valid manifest creates a row with `origin='local'`, returns the local UUID |
| 6 | Search returns local skills | `GET /v1/search?q=<term>` returns at least one locally-published skill matching `<term>` |
| 7 | MCP endpoint mirrors REST | `POST /mcp` with `search_skills` returns the same results as `/v1/search`, same order |
| 8 | Trust score request succeeds and decrements budget | `POST /v1/trust/score?skill_id=<local>` succeeds; `GET /v1/admin/budget` shows `tokens_remaining` decreased |
| 9 | Migration door works end-to-end | `POST /v1/migrate/publish?skill_id=<local>` returns mothership skill ID; the skill is retrievable via `curl api.skillsregistry.net/v1/skills/<mothership-id>` |
| 10 | Air-gap works | With `MOTHERSHIP_URL` unset, `GET /v1/search` and `POST /mcp` succeed; `POST /v1/trust/score` returns `503 { reason: "upstream_not_configured" }` |
| 11 | Schema-version mismatch is caught at boot | Start node with an incompatible `SCHEMA_MIN_VERSION` env; container exits with clear error message |
| 12 | Eval suite runs against local endpoint | `pnpm -F @skillsregistry/eval run cli -- --endpoint http://localhost:8787/v1/search` produces R@5 within 5 percentage points of mothership baseline |
| 13 | Changeset CI works | PR touching `packages/schema` without a changeset fails CI; adding one and merging publishes a new npm version automatically |
| 14 | Docker image publishes to ghcr | `docker pull ghcr.io/cogniumhq/skillsregistry-local:1.0.0` succeeds |

## 6. Non-acceptance markers

If any of the following hold at MVP-cut time, the MVP is **not** complete regardless of what else works:

- Mothership still has an inlined `src/db/schema.ts` (extraction incomplete)
- Any module in `apps/local/` other than `upstream-client.ts` imports from a URL matching `*skillsregistry.net*` or `*mothership*`
- The `apps/local` docker image fails to boot on a machine that has never seen this repo before, using only the documented env vars
- Eval R@5 drops below 75% on either mothership or local (regression threshold)
- License text is missing from any published package's `package.json` `license` field or any distributed file that requires it

## 7. Roadmap posture — off-roadmap by design

`techspec/roadmap.md` v1.4 does not name this repo, `@skillsregistry/*` package versions, `apps/local`, or the "local node" / "self-host" concept anywhere. Every SkillsRegistry milestone in the roadmap (30K/50K trust, public beta/launch, ≥100 publishers) refers to the mothership at `api.skillsregistry.net`, not the self-host deliverable.

**This is by design, not an omission.** The local node is:
- **Community-owned in intent** — `@skillsregistry/*` packages on npm are the public SDK; anyone can build against them.
- **Ahead of the platform's stated timeline** — `techspec/architecture.md` §7 Goal 2 defers on-prem/BYOC until "the first regulated enterprise demands it," but the local node exists now as a self-host convenience.
- **Off-critical-path** — no roadmap milestone depends on the local node shipping or updating.
- **On-thesis for CF-exit** — `techspec/principles.md` §7 mandates portable substrate (Node/Hono/Postgres/Ollama) for new components; the local node's stack matches, making it a happy accident of alignment.

**Consequence — this repo cadences on its own.** SDK versions bump on real code demand (`.changeset/`), the Docker image bumps on operator-facing changes, and there is no external gate we're racing against. `.specifica/mvp/tasks.md` is the authoritative work-plan; roadmap milestones do not appear here.

If this changes — a roadmap item lands that IS gated on us — that gate should be recorded here in a "Roadmap dependencies" subsection.

---

*Version tag: `mvp`. Ships when all §5 criteria pass. Cut to `0.1` on first tagged release.*
