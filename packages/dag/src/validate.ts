import type { ValidationResult, WorkflowDAG, WorkflowStep } from "./types.js";

const TEMPLATE_EXPR = /^\{\{(\w+)\./;

/**
 * Validate DAG structural integrity: unique IDs, dependency references,
 * cycle detection, and input mapping consistency.
 */
export function validateDAG(dag: { steps: WorkflowStep[] }): ValidationResult {
	const errors: string[] = [];
	const stepIds = new Set<string>();

	// Collect step IDs and check for duplicates
	for (const step of dag.steps) {
		if (stepIds.has(step.id)) {
			errors.push(`Duplicate step ID "${step.id}"`);
		}
		stepIds.add(step.id);
	}

	for (const step of dag.steps) {
		// Check all dependsOn references exist
		for (const dep of step.dependsOn) {
			if (!stepIds.has(dep)) {
				errors.push(`Step "${step.id}" depends on unknown step "${dep}"`);
			}
			if (dep === step.id) {
				errors.push(`Step "${step.id}" depends on itself`);
			}
		}

		// Check input mapping references
		for (const [param, expr] of Object.entries(step.inputMap)) {
			const refMatch = expr.match(TEMPLATE_EXPR);
			if (refMatch) {
				const sourceStepId = refMatch[1];
				if (!stepIds.has(sourceStepId)) {
					errors.push(
						`Step "${step.id}" input "${param}" maps to unknown step "${sourceStepId}"`,
					);
				} else if (!step.dependsOn.includes(sourceStepId)) {
					errors.push(
						`Step "${step.id}" input "${param}" maps from "${sourceStepId}" but doesn't declare it in dependsOn`,
					);
				}
			}
		}

		// Check retry is set when onError = 'retry'
		if (step.onError === "retry" && !step.retry) {
			errors.push(`Step "${step.id}" has onError "retry" but no retry policy`);
		}
	}

	// Check for cycles
	if (hasCycle(dag.steps)) {
		errors.push("DAG contains a cycle");
	}

	return { valid: errors.length === 0, errors };
}

/** Detect cycles using DFS with a recursion stack. */
export function hasCycle(steps: WorkflowStep[]): boolean {
	const adj = new Map<string, string[]>();
	for (const step of steps) {
		adj.set(step.id, step.dependsOn);
	}

	const visited = new Set<string>();
	const inStack = new Set<string>();

	function dfs(nodeId: string): boolean {
		if (inStack.has(nodeId)) return true; // cycle
		if (visited.has(nodeId)) return false;

		visited.add(nodeId);
		inStack.add(nodeId);

		for (const dep of adj.get(nodeId) ?? []) {
			if (dfs(dep)) return true;
		}

		inStack.delete(nodeId);
		return false;
	}

	for (const step of steps) {
		if (dfs(step.id)) return true;
	}
	return false;
}
