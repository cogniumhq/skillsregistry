# Cognium Labs SkillsRegistry 

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

**Open-source runtime + SDK for the [SkillsRegistry](https://skillsregistry.net) ecosystem.**

The hosted catalog also exposes a public, read-only MCP endpoint at
`https://api.skillsregistry.net/mcp`. It uses Streamable HTTP, requires no key,
and is packaged in this repository for Cursor and Claude. See
[`docs/listings/README.md`](docs/listings/README.md) for install configuration,
verified listing copy, limitations, and submission status.

This monorepo produces two things:

1. **The SDK packages** (`packages/*`) that back both the hosted mothership at `api.skillsregistry.net` and this local node. Published to npm under the `@skillsregistry/*` scope.
2. **The local node app** (`apps/local`) — a single-tenant, Docker-friendly Node deployment users run in their own environment.

## What this is for

Run a private SkillsRegistry instance in isolation. You get your own tenant subtree, publish your own skills locally, and reach out to the mothership only for global concerns (trust scoring, leaderboards, skill fallback). Later, migrate to the hosted enterprise tier without rewriting anything.

```
┌─ Your infra ───────────────────────────┐        ┌─ api.skillsregistry.net ─┐
│  apps/local (this repo)                │        │  Mothership              │
│  • Postgres + pgvector                 │        │  • live catalog totals   │
│  • Ollama embeddings (default)         │◄──────►│  • Trust scoring (paid)  │
│  • Search + MCP + composition (local)  │  API   │  • Trust leaderboard     │
│  • Local skill publishing              │        │  • Publisher PKI         │
│  • Budget meter + migration door       │        │  • Sync workers          │
└────────────────────────────────────────┘        └──────────────────────────┘
```

Hosted catalog totals move independently of this repository. Read the live
figures at `https://api.skillsregistry.net/v1/analytics/heartbeat` rather than
copying a snapshot from this README.

## Status

**Shipped and usable.** All six SDK packages are published on npm, and the local
node runs from a `docker compose up`.

| package | version |
|---|---|
| [`@skillsregistry/contracts`](https://www.npmjs.com/package/@skillsregistry/contracts) | 2.0.0 |
| [`@skillsregistry/mcp`](https://www.npmjs.com/package/@skillsregistry/mcp) | 1.2.1 |
| [`@skillsregistry/domain`](https://www.npmjs.com/package/@skillsregistry/domain) | 1.1.1 |
| [`@skillsregistry/schema`](https://www.npmjs.com/package/@skillsregistry/schema) | 1.1.0 |
| [`@skillsregistry/dag`](https://www.npmjs.com/package/@skillsregistry/dag) | 1.1.0 |
| [`@skillsregistry/eval`](https://www.npmjs.com/package/@skillsregistry/eval) | 1.0.3 |

**Air-gap mode is the supported path today.** Search, MCP, composition and local
publishing all work with no account and no network. Connected mode — trust
scoring, global leaderboards and the migration door — needs a mothership API key,
and self-serve signup does not exist yet, so treat that half as preview.

Design and roadmap are tracked internally. For anything non-trivial, open an
issue first — see [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Quickstart

```bash
git clone https://github.com/cogniumhq/skillsregistry.git
cd skillsregistry/apps/local
cp .env.example .env          # then set ADMIN_TOKEN — openssl rand -hex 32
docker compose up -d
```

Then `curl http://localhost:3000/v1/health`. Full walkthrough, verification
commands, auth model and troubleshooting: **[`apps/local/README.md`](apps/local/README.md)**.

## Layout

```
skillsregistry/
├── apps/
│   └── local/               # Node app (docker + admin UI)
├── packages/
│   ├── schema/              # @skillsregistry/schema      — Drizzle schema + migrations
│   ├── contracts/           # @skillsregistry/contracts   — Zod schemas, API + MCP + upstream types
│   ├── domain/              # @skillsregistry/domain      — Search, confidence gate, reranker, composition, adapter interfaces
│   ├── mcp/                 # @skillsregistry/mcp         — MCP tool handlers (delegate to domain)
│   ├── eval/                # @skillsregistry/eval        — Fixtures + runner + metrics
│   └── dag/                 # @skillsregistry/dag         — Graph library (moved from mothership vendored copy)
└── LICENSE                  # Apache-2.0
```

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

The hosted service at `api.skillsregistry.net` runs a separate, private proprietary codebase that consumes these SDK packages via npm. This repository — `cogniumhq/skillsregistry` — is the open-source half.

## Contributing

CLA-gated. See [`CONTRIBUTING.md`](CONTRIBUTING.md). Open an issue before starting non-trivial work.

---

*Cognium Labs · 2026*
