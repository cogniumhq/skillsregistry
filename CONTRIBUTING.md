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

### Pull request / push-to-`main` checks

| Check name | What it runs | Runner | Ruleset today |
|---|---|---|---|
| `build + typecheck + test` | `pnpm build`, `pnpm typecheck`, `pnpm --filter @skillsregistry/local-web run check` (Astro), `pnpm test` | self-hosted `grace` inside `node:22-bookworm` | **already required** |
| `changeset required on packages/* PRs` | `pnpm changeset status --since=origin/main` (skipped on version PRs) | self-hosted `grace` | PR-only — cannot be a push-to-main required check |
| `docker build (local app)` | `apps/local/Dockerfile` linux/amd64, **no push** | GitHub-hosted `ubuntu-latest` | add after a green streak |
| `compose + air-gap smoke` | compose stack + `apps/local/scripts/smoke-airgap.sh` | GitHub-hosted `ubuntu-latest` | add once reliable on `main` |
| `dependency audit` | `pnpm audit:prod` — `pnpm audit --prod` gated to **high/critical** only (low/moderate do not fail CI). A small ignore list covers GHSAs that need dedicated upgrades (astro 6/7, drizzle-orm 0.45, Astro/Vite transitives); new high/critical findings fail the job. See `scripts/audit-prod.mjs`. | GitHub-hosted `ubuntu-latest` | **suggest require** |
| `hadolint (Dockerfile)` | hadolint on `apps/local/Dockerfile`; fail on errors, warnings do not fail | GitHub-hosted `ubuntu-latest` | **suggest require** |
| `sdk pack dry-run` | after build, entrypoint checks + `npm pack --dry-run` for each publishable `@skillsregistry/*` package (skips `@skillsregistry/local` and `@skillsregistry/local-web`; pnpm 9 has no `pack --dry-run`) | GitHub-hosted `ubuntu-latest` | **suggest require** |
| `coverage` | `pnpm test:coverage` then `pnpm coverage:check` | GitHub-hosted `ubuntu-latest` | add if the floor stays stable |
| `cognium-dev SAST` | Cognium SAST via `cogniumhq/cognium-dev` (`severity: high`, `category: security`, tests excluded). Scans first-party `apps/local/src`, `apps/local/web/src`, and `packages/*/src` only — never `node_modules`. | GitHub-hosted `ubuntu-latest` | **suggest require** |

A separate workflow, [`.github/workflows/cognium-dev.yml`](.github/workflows/cognium-dev.yml), runs **`cognium-dev SAST`** on pull requests to `main` and pushes to `main`. That is the security scan for this repo. CodeQL is intentionally not used.

The scan uses `cognium.config.json`: first-party `src` only (never `node_modules`), `--severity high` (high + critical), `--category security`, tests excluded. The CLI exits 1 on security findings at that threshold. Reviewed false positives (parameterized SQL, static DDL, non-SQL call sites) are listed in `suppressions` there — do not add entries to silence a new finding.

Docker jobs **must not** run on `grace` — that runner has no Docker
socket. Multi-arch (`linux/arm64`) stays on `publish-app.yml` for `v*`
tags; PR/main image builds are amd64 only so they stay reliable.

The compose smoke job is **not path-filtered**. A broken Dockerfile,
compose file, or air-gap boot path is merge-critical. First run pulls
`ollama/ollama` and `nomic-embed-text` (~275MB) and can take 15–45
minutes; later runs reuse the GHA buildx cache and the Ollama model
cache. Failures dump `docker compose logs` in the job log.

### Coverage floor

Overall (all workspaces combined — `packages/*`, `apps/local`,
`apps/local/web`), enforced by `scripts/check-coverage.mjs`:

| Metric | Floor |
|---|---|
| lines | ≥ 50% |
| statements | ≥ 50% |
| functions | ≥ 45% |
| branches | ≥ 40% |

This is a modest floor below the totals the current suite already
clears (2026-09-20: 69.5% lines/statements, 80.6% functions, 86.0%
branches). The same numbers live in `vitest.config.ts` (native vitest
thresholds) and `scripts/check-coverage.mjs`. Bump all three together.
Locally: `pnpm test:coverage && pnpm coverage:check`.

### Dependency audit threshold

`pnpm audit:prod` runs `pnpm audit --prod` and fails the job only on
**high** or **critical** advisories. Low and moderate findings are
printed and do not fail CI.

A checked-in ignore list in `scripts/audit-prod.mjs` holds high/critical
GHSAs that need a dedicated upgrade (astro 5 → 6/7, drizzle-orm 0.36 →
0.45, and in-range transitives of that Astro/Vite graph). **Do not add
IDs there to silence a new finding** — fix it or open a tracked upgrade.
Remove an ID once the upgrade lands.

### Scheduled / settings-layer checks (not PR merge gates)

| Check | When | Required to merge? |
|---|---|---|
| `production listings` ([`.github/workflows/validate-listings.yml`](.github/workflows/validate-listings.yml)) | nightly 06:20 UTC + `workflow_dispatch`; runs `pnpm validate:listings` against live `api.skillsregistry.net` and `registry.modelcontextprotocol.io` | **No** — a red run means production listings drifted |
| Dependabot version updates ([`.github/dependabot.yml`](.github/dependabot.yml)) | weekly npm (root), GitHub Actions, and Docker (`apps/local/Dockerfile`); minor/patch grouped; open-PR limit 10 per ecosystem | n/a (opens PRs) |
| Dependabot security updates | repo **Settings → Code security** (not this repo's YAML) | n/a |
| Secret scanning / push protection | repo **Settings → Code security** (GitHub-hosted, not a workflow in this repo) | n/a — may already be on for a public repo |

`validate:listings` (live production MCP) is **not** a PR gate and
must not be added to the `main` required-check ruleset.

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

The local app (`@skillsregistry/local`) and admin UI
(`@skillsregistry/local-web`) are private and versioned with the Docker
image — they are in the changesets `ignore` list and do not use
changesets.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Do not open a public issue for security vulnerabilities. See
[SECURITY.md](SECURITY.md) for how to report privately.

## Questions

Open a discussion on GitHub or email `hello@cognium.net`.
