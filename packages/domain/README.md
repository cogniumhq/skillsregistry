# @skillsregistry/domain

Runtime-agnostic domain layer for SkillsRegistry.

**License:** Apache-2.0. This package holds the business logic —
search intelligence, composition, resilience, scoring policy — with
zero direct dependency on any runtime, driver, or framework.
Consumers (mothership Cloudflare Worker, local Node app) provide
concrete adapters at boot.

## What ships

This package includes adapters, resilience utilities, providers,
search intelligence, scoring policy, and composition modules. Check
`package.json` for the source version and npm for the latest published version.
The local node wires a subset of these capabilities; see
[its guide](../../apps/local/README.md) for runtime limitations.

## Adapter interfaces

| Interface | Purpose | Mothership binding | Local binding |
|---|---|---|---|
| `KvAdapter` | Key-value cache | Cloudflare KV | `kv_store` Postgres table |
| `QueueAdapter<T>` | Background dispatch | Cloudflare Queues | In-memory queue |
| `ArtifactAdapter` | Blob storage | R2 | `./data/artifacts/` |
| `EmbedderAdapter` | Text embeddings | Hosted embedding service | Ollama; upstream embedding is not implemented locally |
| `AfterResponse` | Deferred work | `executionCtx.waitUntil()` | `setImmediate()` |

## Usage

```ts
import type {
  KvAdapter,
  QueueAdapter,
  ArtifactAdapter,
  EmbedderAdapter,
  AfterResponse,
} from '@skillsregistry/domain/adapters';

// Consumer implements each interface against its host and injects
// concrete instances into domain services at boot.
```

## Design intent

- **No `env`, no `ctx`, no CF bindings.** Nothing in this package
  imports from `@cloudflare/workers-types` or references
  `executionCtx`. The whole point of the package is to be liftable
  onto any runtime.
- **Adapters are ports.** Adding a method to an existing adapter is
  a MINOR bump. Renaming or removing one is MAJOR.
- **Errors are exceptions.** No silent fallbacks in adapters — the
  domain layer decides whether to swallow, retry, or surface.

## Semver rules

- **Major** (`1.0.0` → `2.0.0`): rename or remove any adapter method;
  change an interface's shape; rename an exported type
- **Minor** (`1.0.0` → `1.1.0`): add a new adapter interface; add an
  optional method to an existing adapter; add a new domain service
- **Patch** (`1.0.0` → `1.0.1`): docstrings, README, internal
  refactors that keep the public surface identical

## License

Apache-2.0 — see [LICENSE](../../LICENSE) in the monorepo root.
