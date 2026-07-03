---
"@skillsregistry/domain": major
---

Scaffold `@skillsregistry/domain` at `0.1.0` with the five adapter
interfaces that define the ports side of the hexagonal boundary:

- `KvAdapter` — key-value cache (CF KV / Postgres `kv_store`)
- `QueueAdapter<T>` — background dispatch (CF Queues / in-memory)
- `ArtifactAdapter` — blob storage (R2 / filesystem)
- `EmbedderAdapter` — text embeddings with `EmbedderIdentity` for
  cross-model write safety
- `AfterResponse` — deferred work (`waitUntil` / `setImmediate`)

No domain logic yet. Sub-modules land per subtasks T-1.4b → T-1.4f
in the parent monorepo's `.specifica/mvp/tasks.md`; `1.0.0` publishes
after all are complete so consumers see one stable surface.
