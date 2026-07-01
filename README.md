# SkillsRegistry Local

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

**Open-source runtime + SDK for the [SkillsRegistry](https://skillsregistry.net) ecosystem.**

This monorepo produces two things:

1. **The SDK packages** (`packages/*`) that back both the hosted mothership at `api.skillsregistry.net` and this local node. Published to npm under the `@skillsregistry/*` scope.
2. **The local node app** (`apps/local`) — a single-tenant, Docker-friendly Node deployment users run in their own environment.

## What this is for

Run a private SkillsRegistry instance in isolation. You get your own tenant subtree, publish your own skills locally, and reach out to the mothership only for global concerns (trust scoring, leaderboards, skill fallback). Later, migrate to the hosted enterprise tier without rewriting anything.

```
┌─ Your infra ───────────────────────────┐        ┌─ api.skillsregistry.net ─┐
│  apps/local (this repo)                │        │  Mothership              │
│  • Postgres + pgvector                 │        │  • 63K skill corpus      │
│  • Ollama embeddings (default)         │◄──────►│  • Trust scoring (paid)  │
│  • Search + MCP + composition (local)  │  API   │  • Global leaderboards   │
│  • Local skill publishing              │        │  • Publisher PKI         │
│  • Budget meter + migration door       │        │  • Sync workers          │
└────────────────────────────────────────┘        └──────────────────────────┘
```

## Status

**MVP — pre-alpha.** No `1.0.0` publishes yet. Design is captured under `.specifica/mvp/`; see `spec.md`, `design.md`, `tasks.md` there.

## Quickstart

*Not yet — see `.specifica/mvp/tasks.md` for the ship checklist.*

## Layout

```
skillsregistry-local/
├── apps/
│   └── local/               # Node app (docker + admin UI)
├── packages/
│   ├── schema/              # @skillsregistry/schema      — Drizzle schema + migrations
│   ├── contracts/           # @skillsregistry/contracts   — Zod schemas, API + MCP + upstream types
│   ├── domain/              # @skillsregistry/domain      — Search, confidence gate, reranker, composition, adapter interfaces
│   ├── mcp/                 # @skillsregistry/mcp         — MCP tool handlers (delegate to domain)
│   ├── eval/                # @skillsregistry/eval        — Fixtures + runner + metrics
│   └── dag/                 # @skillsregistry/dag         — Graph library (moved from mothership vendored copy)
├── .specifica/              # spec/design/tasks (Specifica protocol)
└── LICENSE                  # Apache-2.0
```

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

The hosted service at `api.skillsregistry.net` runs a separate proprietary codebase (`cogniumhq/skillsregistry`) that consumes these SDK packages via npm.

## Contributing

CLA-gated. See `CONTRIBUTING.md` once published. Design decisions flow through `.specifica/mvp/`.

---

*Cognium Labs · 2026*
