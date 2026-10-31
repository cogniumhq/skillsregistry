# Changelog

## 2.0.0

### Major Changes

- 870584d: Move to **zod 4** (`^4.6.7`) and **`@hono/zod-openapi` 1.x** (`^1.6.3`). zod 3 has no fix for GHSA-mrhx-c7xc-m3w5 (memory exhaustion validating oversized constrained collections; patched in zod `>=4.6.6`), so the SDK has to cross the zod major for consumers to clear it.

  Wire shapes are unchanged: no field, enum value or OpenAPI component name changed, and ids are still checked with the zod 3 UUID shape (`z.guid()`, no RFC 9562 version/variant check), so every payload accepted by 2.x / 1.x is still accepted.

  Breaking for TypeScript / runtime consumers:

  - Exported schemas (`@skillsregistry/contracts`, `@skillsregistry/domain/composition` input schemas, `@skillsregistry/dag` `WorkflowDAG` / `WorkflowStep` / `RetryPolicy` / `InputMapping`) are zod 4 instances. Consumers must be on zod 4 themselves to compose them (`.extend`, `.merge`, `z.object({ x: ContractSchema })`), and on `@hono/zod-openapi` 1.x (peer `hono >=4.10`) to use them in `createRoute`.
  - Validation errors are zod 4 `ZodError`s: read `.issues` (`.errors` is gone), `.format()` / `.flatten()` are deprecated in favour of `z.treeifyError()` / `z.flattenError()`, and default messages changed (e.g. `Required` → `Invalid input: expected string, received undefined`). Code or tests that match on message text need updating.
  - `SkillIdParam` is now a `ZodGUID` (was `ZodString` with `.uuid()`); it still emits `format: uuid` in OpenAPI. Composition `authorId` / `skillId` likewise.
  - Single-argument `z.record(valueSchema)` was replaced by `z.record(z.string(), valueSchema)` (`MatchSourcesResponseSchema.matchSources`, `EvalCompareResponseSchema.metrics` / `summary` / `tierDistribution`, composition `inputMapping`); inferred types are unchanged.

### Patch Changes

- cb6c3f6: Remove internal infrastructure hostnames and private-repo paths from published
  package contents.

  Internal hostnames appeared in the domain README and in source comments;
  `.specifica/...` paths appeared in several comments and in the
  `0025_mcp_invocations.sql` migration header. All are replaced with
  neutral wording.

  No API, type, runtime default or behaviour changes — every occurrence was a
  comment, a README line, or a test URL, never a functional default. This is a
  patch only because these packages publish `README.md` (and, for schema, the
  `.sql` file) inside the tarball, so the artifact contents genuinely differ.

All notable changes to `@skillsregistry/dag` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] — 2026-07

### Changed

- **`InputMapping` widened from `Record<string, string>` to `Record<string, unknown>`.**
  Nested objects, arrays, and primitives (numbers, booleans, `null`) are now
  valid leaves. Existing string-only mappings continue to parse and resolve
  unchanged — this is a compatible widening of the accepted input surface.
- `DAG_SCHEMA_VERSION` bumped to `"1.1"` to reflect the wider input surface.

### Compatibility notes

- **`resolveInputs`** does _not_ walk nested leaves — non-string values are
  passed through verbatim. Callers that need recursive template expansion
  inside nested structures must resolve them before calling `resolveInputs`,
  or use a higher-level resolver (a consumer-side resolver, not this package).
- **`validateDAG`** skips reference checks on non-string leaves. Inter-step
  references embedded inside nested structures are the caller's responsibility.
- **Downstream TypeScript consumers** that pinned the inferred
  `InputMappingType` as `Record<string, string>` will see a widening to
  `Record<string, unknown>`. Runtime remains fully backward-compatible.

## [1.0.0] — 2026-06

### Added

- Initial release under the `@skillsregistry/*` scope.
- Zod schemas: `RetryPolicy`, `InputMapping`, `WorkflowStep`, `WorkflowDAG`.
- Inferred TypeScript types for all schemas.
- `validateDAG`, `hasCycle` — structural and cycle validation.
- `toExecutionLayers` — Kahn's-algorithm topological sort into parallel-execution layers.
- `resolveInputs`, `evaluateCondition` — `$stepId.field` reference substitution and guard evaluation.
- Dual ESM + CJS build via `tsup`, with bundled `.d.ts`.

### Migration from `@runics/dag`

Identifiers and behaviour are unchanged. Replace the dependency:

```bash
npm uninstall @runics/dag
npm install @skillsregistry/dag
```

Then update imports:

```diff
- import { validateDAG } from "@runics/dag";
+ import { validateDAG } from "@skillsregistry/dag";
```

`@runics/dag@1.0.1` is published as a thin re-export shim and tagged
`deprecated` on the npm registry to nudge consumers off the legacy name.
