# Contributing to SkillsRegistry Local

Thanks for your interest. This repo is Apache-2.0 and welcomes external
contributions. A few ground rules keep the codebase coherent.

## Before you start

1. Read `.specifica/principles.md` — the cross-cutting rules for this
   repo. Anything that violates a principle will be sent back.
2. Read `.specifica/mvp/{spec,design,tasks}.md` for the current
   version's intent, design, and open work. Match the design or propose
   an amendment in the PR.
3. For non-trivial work, open a discussion issue first. Please don't
   land a large PR unannounced.

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
git clone https://github.com/cogniumhq/skillsregistry-local
cd skillsregistry-local
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
3. Every PR must pass:
   - `pnpm typecheck`
   - `pnpm test`
   - `pnpm build`
4. Add tests for new behavior. Bug fixes need a regression test that
   fails on `main` and passes on your branch.
5. Follow the existing code style. There is no separate formatting
   step — match the surrounding code.
6. PR description should link to the relevant `tasks.md` entry (e.g.,
   "closes T-2.4") or the issue the PR resolves.

## Commit messages

- Present-tense, imperative mood: "add x", not "added x" or "adds x".
- First line ≤ 72 chars.
- Body explains **why**, not **what** (the diff shows the what).
- Reference tasks: `T-2.4: implement embedder adapter for Ollama`.

## Semver and releases

See `.specifica/principles.md` §Release discipline for the full rules.

Summary per SDK package:

- `@skillsregistry/schema` — major on any column rename or drop
- `@skillsregistry/contracts` — major on any request/response field
  rename or removal
- `@skillsregistry/domain` — major on any adapter interface change
- `@skillsregistry/mcp` — major on any MCP tool signature change
- `@skillsregistry/eval` — major on scoring metric rename

The local app (`@skillsregistry/local-app`) is versioned separately
via Docker tags and does not use changesets.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Do not open a public issue for security vulnerabilities. See
[SECURITY.md](SECURITY.md) for how to report privately.

## Questions

Open a discussion on GitHub or email `hello@cognium.net`.
