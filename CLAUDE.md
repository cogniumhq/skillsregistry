# SkillsRegistry (local node) — apps/local + @skillsregistry/*

Open-source runtime + SDK for the SkillsRegistry ecosystem. The proprietary mothership at `api.skillsregistry.net` lives in a **separate, private** repo; this repo is what operators self-host.

> *This project follows the Specifica protocol, but its tracker is **not in
> this repo** — it lives in the private mothership repo under
> `.specifica/skillsregistry/` (moved 2026-09-19 because cross-repo entries
> named private repos and paths from a public artifact). A session working
> here without access to that tracker should say so rather than guess at
> intent, and should not recreate a `.specifica/` directory here.*

## What this repo owns

This monorepo produces two deliverables under **one Apache-2.0 license**:

| Deliverable | Location | Consumers |
|---|---|---|
| SDK packages (`@skillsregistry/*`) | `packages/*` — published to npm | Both this repo's `apps/local` **and** the mothership (`cogniumhq/skillsregistry`) |
| Local node app | `apps/local` — published as Docker image (`ghcr.io/cogniumhq/skillsregistry-local`) | End users self-hosting a private SkillsRegistry |

## Source of truth

- **Specifica tracker** — in the private mothership repo at
  `.specifica/skillsregistry/` (principles + mvp spec/design/tasks)
- **Package READMEs** — `packages/*/README.md`, `apps/local/README.md`; the
  adapter interfaces and invariants a change must hold are documented there
- **Platform specs** (private repo) — `skillsregistry.md`, `skill-convention.md`, etc. Read when the local node's behavior must match the platform contract.

## Sacred boundaries

- **Work stays inside this repository.** No edits, writes, or file creation in sibling private repos (the mothership, the platform specs, and the other Cognium services) from this project's sessions. Cross-repo work (e.g., mothership consuming a new `@skillsregistry/schema` version) is a coordination ask, not a direct edit. Exception: explicit user override for a specific sibling — see the 2026-07-13 `cognium-skills` bundle fix.
- **The mothership is proprietary.** This repo never publishes anything that assumes access to mothership internals. All mothership interaction is via the public HTTP API defined in `@skillsregistry/contracts`.
- **One upstream module.** `apps/local/src/upstream-client.ts` is the **only** place code here talks to `api.skillsregistry.net`. Every other module goes through it.
- **This repo is public.** Do not copy material from any other checkout into this tree. No scan output, customer findings, tokens, or unpublished internal design. See `.cursor/rules/public-repo.mdc`.

## Stack (target)

- Node 22+ · TypeScript · Hono (`@hono/node-server`)
- Postgres 16 + pgvector (Docker for local dev)
- Ollama (default) or upstream-embedder for embeddings
- pnpm workspaces + changesets for releases
- Docker Compose for one-command deploy
- Astro + `@astrojs/node` for the admin UI (`apps/local/web/`)

## Commands

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
| Mothership (private) | Proprietary hosted service. Imports `@skillsregistry/*` from npm. Referenced here only via its public HTTP API. |
| Platform specs (private) | Read-only reference. |
| First-party skills (private) | Skill packages published INTO the registry (unrelated concern — do not conflate). |
| Semantic engine (private) | Circle-IR scanning + trust analysis. Runs on the mothership; the local node delegates via a metered API. |

---

*Cognium Labs · 2026*
