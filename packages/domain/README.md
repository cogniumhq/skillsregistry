# @skillsregistry/domain

Runtime-agnostic domain layer for SkillsRegistry.

**License:** Apache-2.0. This package holds the business logic —
search intelligence, composition, resilience, scoring policy — with
zero direct dependency on any runtime, driver, or framework.
Consumers (mothership Cloudflare Worker, local Node app) provide
concrete adapters at boot.

## Status

**`0.1.0` — adapter interfaces only.** The domain-logic modules land
incrementally per the internal roadmap
subtasks T-1.4a → T-1.4f. `1.0.0` gates on completing all six
sub-tasks so consumers see one coherent surface, not a moving target.

## Adapter interfaces

| Interface | Purpose | Mothership binding | Local binding |
|---|---|---|---|
| `KvAdapter` | Key-value cache | Cloudflare KV | `kv_store` Postgres table |
| `QueueAdapter<T>` | Background dispatch | Cloudflare Queues | In-memory (MVP) / Postgres LISTEN-NOTIFY (post-MVP) |
| `ArtifactAdapter` | Blob storage | R2 | `./data/artifacts/` |
| `EmbedderAdapter` | Text embeddings | hosted qwen3-embedding-0.6B (MRL-512) | Ollama (default) or budgeted upstream |
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
