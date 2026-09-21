# Changelog

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

- **`resolveInputs`** does *not* walk nested leaves — non-string values are
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
