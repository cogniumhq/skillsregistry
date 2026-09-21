# SkillsRegistry

[![Cognium Labs Inc](https://img.shields.io/badge/Cognium_Labs_Inc-cognium.net-0a0a0b?labelColor=6ee7b7&color=111111)](https://cognium.net)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

**Find MCP servers and agent skills by what they do, with explicit trust and
scan-coverage signals.** [SkillsRegistry](https://skillsregistry.net) is built
by **[Cognium Labs Inc](https://cognium.net)**. This Apache-2.0 repository
contains its TypeScript SDK and self-hosted local node; the public catalog runs
as a separate hosted service.

## Try the public MCP catalog

Connect Claude Code to the hosted, read-only MCP endpoint. The public tools
require no API key or signup:

```bash
claude mcp add --transport http --scope user skillsregistry https://api.skillsregistry.net/mcp
```

Ask your client to find an MCP server by task. `search_skills` returns available
endpoint or repository links, an install-method classification, and the trust
and scan coverage recorded for each result. For other clients, see the
[generic MCP configuration](docs/listings/README.md#install-configuration) and
[product docs](https://skillsregistry.net/agents).

## Self-host the open-source node

Run a private SkillsRegistry instance over your own manifests. The local node
(`apps/local`) uses Postgres with pgvector and an embedding provider; Docker
Compose builds and wires up the supported air-gap deployment from source.

```bash
git clone https://github.com/cogniumhq/skillsregistry.git
cd skillsregistry/apps/local
cp .env.example .env          # then set ADMIN_TOKEN — openssl rand -hex 32
docker compose up -d
```

Then `curl http://localhost:3000/v1/health`. The
[local-node walkthrough](apps/local/README.md) covers prerequisites,
verification, authentication, and troubleshooting.

## What the trust signals mean

The hosted catalog reports the trust signals and scan coverage available for a
record. **Unscanned means unscanned, not safe or clean.** Coverage is not
universal, and a trust score is context for review rather than a guarantee that
a skill is safe to run. Use `get_trust_breakdown` to inspect the recorded signals
before deciding whether to install or invoke a result.

The public MCP endpoint is read-only. In air-gap mode, the local node uses your
local index for search, MCP discovery, and publishing without upstream API calls.
Its `resolve_composition` MCP tool does not yet resolve local compositions.
It does **not** run Cognium's hosted trust-scoring engine. Connected scoring,
leaderboards, and migration require a hosted API key; self-serve signup is not
available yet, so that mode remains a preview. See the
[security policy](SECURITY.md) to report a vulnerability privately.

## How the pieces fit

This monorepo publishes six `@skillsregistry/*` SDK packages and the
single-tenant local node. The hosted service consumes the SDK packages but runs
in a separate, proprietary codebase.

```
┌─ Your infra ───────────────────────────┐        ┌─ api.skillsregistry.net ─┐
│  apps/local (this repo)                │        │  Hosted SkillsRegistry   │
│  • Postgres + pgvector                 │        │  • live catalog totals   │
│  • Ollama embeddings (default)         │◄──────►│  • Trust scoring API     │
│  • Search + MCP (local)                │  API   │  • Trust leaderboard     │
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

Design and roadmap are tracked internally. For anything non-trivial, open an
issue first — see [`CONTRIBUTING.md`](CONTRIBUTING.md).

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
│   └── dag/                 # @skillsregistry/dag         — Workflow graph types, validation, and interpreter
└── LICENSE                  # Apache-2.0
```

## About Cognium

[Cognium Labs Inc](https://cognium.net) builds SkillsRegistry and
[Cognium SAST](https://cognium.dev). The company site is
[cognium.net](https://cognium.net); [SkillsRegistry](https://skillsregistry.net)
is the catalog and product documentation. Other open work is at
[github.com/cogniumhq](https://github.com/cogniumhq), and
[Specifica](https://specifica.org) documents the open spec format. Contact:
[hello@cognium.net](mailto:hello@cognium.net).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

The hosted service at `api.skillsregistry.net` is proprietary and consumes the
open-source SDK packages. This repository contains the Apache-2.0 runtime and
SDK.

## Contributing

External contributions are welcome; no separate CLA form is currently required.
See [`CONTRIBUTING.md`](CONTRIBUTING.md) and open an issue before starting
non-trivial work.

---

*[Cognium Labs Inc](https://cognium.net) · 2026*
