---
'@skillsregistry/domain': minor
---

T-1.4e: Port `src/composition/*` from mothership behind the composition
adapter bundle.

New module at `packages/domain/src/composition/`:

- `forkSkill(sourceId, authorId, authorType, adapters)` — clone a
  published skill as a `forked` draft with lineage. Trust reset via
  `BASE_TRUST[root_source]`; composition sources copy their step list.
- `copySkill(sourceId, authorId, authorType, adapters)` — clone with a
  hard trust reset (0.5) and no lineage.
- `createComposition(input, adapters)` — build an `auto-composite` from
  an ordered step list. v5.0 trust rule preserved: `min(step trusts) ×
  0.90`.
- `extendComposition(compositionId, newSteps, authorId, authorType,
  adapters)` — fork a composition and append steps, recomputing trust +
  capabilities.
- `publishComposition(compositionId, pool)` — draft → published, gated
  on every step still being published.
- `getAncestry(id, pool)`, `getForks(id, pool)`, `getDependents(id, pool)`
  — lineage projections.
- `getCompositionBySlug(pool, slug, tenantId, options)` — allowlisted
  composition-detail loader with tenant visibility filter and
  configurable `shareUrlHost`.

New adapter bundle at `composition/adapters.ts`:

- `CompositionAdapters { pool, embedQueue, scanQueue }` — every
  write-side function takes this instead of ad-hoc `Env` bindings.
- `EmbedQueueMessage { skillId, action: 'embed' }` and
  `CogniumScanQueueMessage { skillId, priority, timestamp }` — typed
  queue payloads matching mothership's on-wire shape.
- Both queues are consumed via the existing `QueueAdapter<T>` port —
  no new adapter interface, just typed instantiations.

Typed error classes at `composition/errors.ts`:

- `NotFoundError` (source skill missing / not published).
- `ValidationError` (bad input, wrong state, unpublished step, etc.).

Zod input validators at `composition/schema.ts` — verbatim port of
`forkInputSchema`, `copyInputSchema`, `compositionInputSchema`,
`extendInputSchema` for consumers to run at the transport boundary.

New dependencies (both peer-safe, small, no native bindings):

- `nanoid ^5.1.6` — used for slug suffixes on fork/copy/compose.
- `zod ^3.23.0` — direct dep for `composition/schema.ts` (was already
  transitive via `@skillsregistry/contracts`).

Ships new subpath: `@skillsregistry/domain/composition`.

Env-binding refactor: mothership's `env.EMBED_QUEUE.send(...)` and
`env.COGNIUM_QUEUE.send(...)` calls are now routed through the two
`QueueAdapter<T>` slots in `CompositionAdapters`. Mothership binds them
to CF Queues; the local node binds them to Postgres LISTEN/NOTIFY or
in-memory. Best-effort semantics preserved (queue failures logged +
swallowed so the write itself always succeeds).

No behavioral change to the trust math, lineage traversal, or tenant
visibility filter versus mothership.
