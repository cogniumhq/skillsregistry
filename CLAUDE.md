# SkillsRegistry Local

Open-source runtime + SDK for the SkillsRegistry ecosystem. Companion to `~/work/cogniumhq/skillsregistry` (the proprietary mothership at `api.skillsregistry.net`).

> *This project follows the Specifica protocol. Read `specifica-skill.md` in project knowledge before responding. Treat `.specifica/principles.md` as authoritative for cross-cutting rules.*

Current Specifica version: **mvp** at `.specifica/mvp/{spec,design,tasks}.md`.

## What this repo owns

This monorepo produces two deliverables under **one Apache-2.0 license**:

| Deliverable | Location | Consumers |
|---|---|---|
| SDK packages (`@skillsregistry/*`) | `packages/*` — published to npm | Both this repo's `apps/local` **and** the mothership (`cogniumhq/skillsregistry`) |
| Local node app | `apps/local` — published as Docker image (`ghcr.io/cogniumhq/skillsregistry-local`) | End users self-hosting a private SkillsRegistry |

## Source of truth

- **`.specifica/principles.md`** — cross-cutting rules for this repo
- **`.specifica/mvp/{spec,design,tasks}.md`** — current version's intent + design + open work
- **`~/work/cogniumhq/techspec/`** — platform-level specs (skillsregistry.md, skill-convention.md, etc.). Read when the local node's behavior must match the platform contract.

## Sacred boundaries

- **Work stays inside `~/work/cogniumhq/skillsregistry-local/`.** No edits, writes, or file creation in sibling repos (`skillsregistry/`, `techspec/`, `cognium-ai/`, etc.) from this project's sessions. Cross-repo work (e.g., mothership consuming a new `@skillsregistry/schema` version) is a coordination ask, not a direct edit.
- **The mothership is proprietary.** This repo never publishes anything that assumes access to mothership internals. All mothership interaction is via the public HTTP API defined in `@skillsregistry/contracts`.
- **One upstream module.** `apps/local/src/upstream-client.ts` is the **only** place code here talks to `api.skillsregistry.net`. Every other module goes through it.

## Stack (target)

- Node 22+ · TypeScript · Hono (`@hono/node-server`)
- Postgres 16 + pgvector (Docker for local dev)
- Ollama (default) or upstream-embedder for embeddings
- pnpm workspaces + changesets for releases
- Docker Compose for one-command deploy
- Astro + `@astrojs/node` for the admin UI (`apps/local/web/`)

## Commands (planned — see `tasks.md`)

```
pnpm install                 # install workspace deps
pnpm build                   # build every package + app
pnpm test                    # unit tests across packages
pnpm typecheck               # tsc across workspaces
pnpm changeset               # add a changeset for a package bump
docker compose up            # local run (apps/local)
```

## Related repos

| Repo | Role |
|---|---|
| `cogniumhq/skillsregistry` | Mothership (proprietary). Imports `@skillsregistry/*` from npm. |
| `cogniumhq/techspec` | Platform specs. Read-only reference. |
| `cogniumhq/cognium-skills` | First-party skill packages published INTO the registry (unrelated concern — do not conflate). |
| `cogniumhq/cognium-ai` | Circle-IR semantic engine (PolyForm-NC). Runs on mothership; local node delegates via metered API. |

---

*Cognium Labs · 2026*
