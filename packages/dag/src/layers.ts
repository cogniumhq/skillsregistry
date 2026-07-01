import type { ExecutionLayer, WorkflowStep } from "./types.js";

/**
 * Topological sort that produces execution layers.
 * Steps within the same layer have no dependencies on each other and can run in parallel.
 *
 * @throws Error if the DAG has unresolvable dependencies (cycle or missing step).
 *         Call `validateDAG()` first for detailed error messages.
 */
export function toExecutionLayers(steps: WorkflowStep[]): ExecutionLayer[] {
	const inDegree = new Map<string, number>();
	const dependents = new Map<string, string[]>();

	// Initialize in-degree counts and reverse adjacency
	for (const step of steps) {
		inDegree.set(step.id, step.dependsOn.length);
		for (const dep of step.dependsOn) {
			const existing = dependents.get(dep) ?? [];
			existing.push(step.id);
			dependents.set(dep, existing);
		}
	}

	const layers: ExecutionLayer[] = [];
	const remaining = new Set(steps.map((s) => s.id));

	let layerIndex = 0;
	while (remaining.size > 0) {
		// Find all steps with in-degree 0 (no unresolved dependencies)
		const ready: string[] = [];
		for (const id of remaining) {
			if (inDegree.get(id) === 0) {
				ready.push(id);
			}
		}

		if (ready.length === 0) {
			throw new Error("Unresolvable dependencies — cycle or missing step");
		}

		// Sort for deterministic ordering within a layer
		ready.sort();
		layers.push({ index: layerIndex++, stepIds: ready });

		// Remove ready steps and decrement dependents' in-degree
		for (const id of ready) {
			remaining.delete(id);
			for (const dep of dependents.get(id) ?? []) {
				inDegree.set(dep, (inDegree.get(dep) ?? 1) - 1);
			}
		}
	}

	return layers;
}
