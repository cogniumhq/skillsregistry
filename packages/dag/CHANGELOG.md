# Changelog

All notable changes to `@skillsregistry/dag` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
