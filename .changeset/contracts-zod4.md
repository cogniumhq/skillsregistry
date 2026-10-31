---
"@skillsregistry/contracts": major
"@skillsregistry/domain": major
"@skillsregistry/dag": major
---

Move to **zod 4** (`^4.6.7`) and **`@hono/zod-openapi` 1.x** (`^1.6.3`). zod 3 has no fix for GHSA-mrhx-c7xc-m3w5 (memory exhaustion validating oversized constrained collections; patched in zod `>=4.6.6`), so the SDK has to cross the zod major for consumers to clear it.

Wire shapes are unchanged: no field, enum value or OpenAPI component name changed, and ids are still checked with the zod 3 UUID shape (`z.guid()`, no RFC 9562 version/variant check), so every payload accepted by 2.x / 1.x is still accepted.

Breaking for TypeScript / runtime consumers:

- Exported schemas (`@skillsregistry/contracts`, `@skillsregistry/domain/composition` input schemas, `@skillsregistry/dag` `WorkflowDAG` / `WorkflowStep` / `RetryPolicy` / `InputMapping`) are zod 4 instances. Consumers must be on zod 4 themselves to compose them (`.extend`, `.merge`, `z.object({ x: ContractSchema })`), and on `@hono/zod-openapi` 1.x (peer `hono >=4.10`) to use them in `createRoute`.
- Validation errors are zod 4 `ZodError`s: read `.issues` (`.errors` is gone), `.format()` / `.flatten()` are deprecated in favour of `z.treeifyError()` / `z.flattenError()`, and default messages changed (e.g. `Required` → `Invalid input: expected string, received undefined`). Code or tests that match on message text need updating.
- `SkillIdParam` is now a `ZodGUID` (was `ZodString` with `.uuid()`); it still emits `format: uuid` in OpenAPI. Composition `authorId` / `skillId` likewise.
- Single-argument `z.record(valueSchema)` was replaced by `z.record(z.string(), valueSchema)` (`MatchSourcesResponseSchema.matchSources`, `EvalCompareResponseSchema.metrics` / `summary` / `tierDistribution`, composition `inputMapping`); inferred types are unchanged.
