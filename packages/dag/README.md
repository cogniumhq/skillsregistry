# @skillsregistry/dag

Portable workflow DAG schema, validation, and interpreter for [SkillsRegistry](https://skillsregistry.net).

Zero-dependency (modulo `zod`) primitives for declaring multi-step skill workflows as a directed acyclic graph, validating them, computing parallel execution layers via topological sort, and resolving step inputs from upstream outputs.

## Install

```bash
npm install @skillsregistry/dag
```

## Usage

```ts
import {
  WorkflowDAG,
  validateDAG,
  toExecutionLayers,
  resolveInputs,
} from "@skillsregistry/dag";

const dag = WorkflowDAG.parse({
  schemaVersion: "1.0",
  steps: [
    { id: "fetch",   skill: "@cognium/http-get",     inputs: {} },
    { id: "summary", skill: "@cognium/summarize",    inputs: { text: "$fetch.body" }, dependsOn: ["fetch"] },
  ],
});

const result = validateDAG(dag);
if (!result.valid) throw new Error(result.errors.join("\n"));

const layers = toExecutionLayers(dag); // [["fetch"], ["summary"]]
```

## Exports

| Export | Kind | Purpose |
| --- | --- | --- |
| `DAG_SCHEMA_VERSION` | const | Current schema version string |
| `RetryPolicy`, `InputMapping`, `WorkflowStep`, `WorkflowDAG` | Zod schemas | Runtime validation |
| `RetryPolicyType`, `InputMappingType`, `WorkflowStepType`, `WorkflowDAGType` | TS types | Inferred from Zod |
| `ValidationResult`, `ExecutionLayer` | TS types | Helper return types |
| `validateDAG(dag)` | fn | Full structural + cycle validation |
| `hasCycle(dag)` | fn | Cycle check only |
| `toExecutionLayers(dag)` | fn | Topological sort into parallel layers |
| `resolveInputs(step, ctx)` | fn | Substitute `$stepId.field` references |
| `evaluateCondition(expr, ctx)` | fn | Evaluate guard expressions |

## History

Originally published as `@runics/dag` under the OpenMason monorepo. Renamed to `@skillsregistry/dag` in June 2026 when Runics became SkillsRegistry. The legacy `@runics/dag` package is deprecated — see CHANGELOG.

## License

MIT © Cognium Labs
