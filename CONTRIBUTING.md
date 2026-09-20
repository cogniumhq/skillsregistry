# Contributing to SkillsRegistry Local

Thanks for your interest. This repo is Apache-2.0 and welcomes external
contributions. A few ground rules keep the codebase coherent.

## Before you start

1. **Open a discussion issue first** for anything non-trivial. Design
   and roadmap are tracked internally, so an issue is how you find out
   whether a change fits the direction before you build it — and it is
   the fastest way to get that answer. Please don't land a large PR
   unannounced.
2. Read the package README for whatever you're touching
   (`packages/*/README.md`, `apps/local/README.md`). Those document the
   adapter interfaces and the invariants a change has to hold.
3. Match the surrounding code. Existing structure encodes decisions that
   aren't always restated in the diff; if something looks arbitrary, ask
   in the issue rather than changing it in passing.

## Scope of contributions

**In scope:**

- Bug fixes in `packages/*` or `apps/local`
- New SDK adapters (KV, queue, artifact, embedder) that fit the
  documented interfaces
- Improvements to the local admin UI (`apps/local/web/`)
- Documentation, examples, and tests

**Out of scope in this repo:**

- Changes that require access to `api.skillsregistry.net` internals —
  the mothership is proprietary and not part of this codebase.
- Changes that break the public contract in `@skillsregistry/contracts`
  without a coordinated major bump (see release discipline).
- Trust-scoring implementations. Trust scoring lives on the mothership
  and is consumed here via `POST /v1/trust/score` (metered). Local
  proxies of the scoring pipeline are not accepted.

## Contributor License Agreement

By submitting a pull request you agree that your contribution is
licensed under the Apache License 2.0 (see `LICENSE`). No CLA form to
sign for now; the Apache-2.0 grant is sufficient. If we ever need a
CLA, we'll switch to one before merging further PRs and give notice.

## Development workflow

```bash
git clone https://github.com/cogniumhq/skillsregistry
cd skillsregistry
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Requirements: **Node 22+**, **pnpm 9+**. Older versions are not
supported.

## Pull requests

1. Branch from `main`. Keep PRs focused — one concern per PR.
2. Every PR that touches `packages/*` requires a changeset. Run
   `pnpm changeset` and commit the generated file. CI enforces this.
3. Every PR must pass the CI merge gates below (not only a local
   `pnpm typecheck` / `test` / `build`).
4. Add tests for new behavior. Bug fixes need a regression test that
   fails on `main` and passes on your branch.
5. Follow the existing code style. There is no separate formatting
   step — match the surrounding code.
6. PR description should link to the relevant `tasks.md` entry (e.g.,
   "closes T-2.4") or the issue the PR resolves.

## CI merge gates

Workflow: [`.github/workflows/ci.yml`](.github/workflows/ci.yml). Job
`name:` strings **are** the GitHub required-check contexts — keep them
stable when editing the workflow.

| Check name | What it runs | Runner |
|---|---|---|
| `build + typecheck + test` | `pnpm build`, `pnpm typecheck`, `pnpm --filter @skillsregistry/local-web run check` (Astro), `pnpm test` | self-hosted `grace` inside `node:22-bookworm` |
| `changeset required on packages/* PRs` | `pnpm changeset status --since=origin/main` (skipped on version PRs) | self-hosted `grace` |
| `docker build (local app)` | `apps/local/Dockerfile` linux/amd64, **no push** | GitHub-hosted `ubuntu-latest` |
| `compose + air-gap smoke` | compose stack + `apps/local/scripts/smoke-airgap.sh` | GitHub-hosted `ubuntu-latest` |

The `main` branch ruleset already requires `build + typecheck + test`.
After this workflow has a green streak, also require `docker build (local
app)` and `compose + air-gap smoke`. The changeset job is pull-request
only, so it cannot be a push-to-main required check.

Docker jobs **must not** run on `grace` — that runner has no Docker
socket. Multi-arch (`linux/arm64`) stays on `publish-app.yml` for `v*`
tags; PR/main image builds are amd64 only so they stay reliable.

The compose smoke job is **not path-filtered**. A broken Dockerfile,
compose file, or air-gap boot path is merge-critical. First run pulls
`ollama/ollama` and `nomic-embed-text` (~275MB) and can take 15–45
minutes; later runs reuse the GHA buildx cache and the Ollama model
cache. Failures dump `docker compose logs` in the job log.

`validate:listings` (live production MCP) is **not** a PR gate.

Reproduce the smoke stack locally from `apps/local`:

```bash
./scripts/ci-write-env.sh
# optional: docker build -t skillsregistry-local:ci -f Dockerfile ../..
./scripts/ci-compose-smoke.sh
```

## Commit messages

- Present-tense, imperative mood: "add x", not "added x" or "adds x".
- First line ≤ 72 chars.
- Body explains **why**, not **what** (the diff shows the what).
- Reference the issue you opened: `fix(domain): handle empty rerank set (#123)`.

## Semver and releases

Release discipline is enforced by CI — every PR touching `packages/*`
needs a changeset. Summary per SDK package:

- `@skillsregistry/schema` — major on any column rename or drop
- `@skillsregistry/contracts` — major on any request/response field
  rename or removal
- `@skillsregistry/domain` — major on any adapter interface change
- `@skillsregistry/mcp` — major on any MCP tool signature change
- `@skillsregistry/eval` — major on scoring metric rename

The local app (`@skillsregistry/local`) is versioned separately
via Docker tags and does not use changesets.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Do not open a public issue for security vulnerabilities. See
[SECURITY.md](SECURITY.md) for how to report privately.

## Questions

Open a discussion on GitHub or email `hello@cognium.net`.
