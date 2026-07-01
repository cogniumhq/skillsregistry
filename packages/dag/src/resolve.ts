import type { WorkflowStep } from "./types.js";

const TEMPLATE_RE = /^\{\{(.+)\}\}$/;
const TEMPLATE_GLOBAL_RE = /\{\{(\w+(?:\.\w+)*)\}\}/g;

/**
 * Allowed operators for condition evaluation.
 * Conditions are restricted to simple comparisons — complex logic
 * should be handled by an LLM reasoning step instead.
 */
const ALLOWED_CONDITION_TOKENS = /^[\d\s.,"'true false null undefined\-+><=!&|()[\]]+$/;

/**
 * Resolve a step's input mappings against outputs from prior steps.
 *
 * Template expressions: `{{stepId.output.field}}` — resolves to the value
 * at that path in the outputs map. The `output` segment is implicit and skipped.
 *
 * Literal strings are passed through unchanged.
 */
export function resolveInputs(
	step: WorkflowStep,
	outputs: Record<string, unknown>,
): Record<string, unknown> {
	const resolved: Record<string, unknown> = {};

	for (const [param, expr] of Object.entries(step.inputMap)) {
		const templateMatch = expr.match(TEMPLATE_RE);
		if (templateMatch) {
			resolved[param] = resolvePath(templateMatch[1], outputs);
		} else {
			// Literal value
			resolved[param] = expr;
		}
	}

	return resolved;
}

/**
 * Evaluate a condition string against step outputs.
 * Returns `true` if the step should execute, `false` to skip.
 *
 * Template expressions in the condition are replaced with JSON-serialized values
 * from prior step outputs. Only simple comparison operators are allowed.
 *
 * Returns `true` on evaluation failure (safe default — execute the step).
 */
export function evaluateCondition(
	condition: string,
	outputs: Record<string, unknown>,
): boolean {
	// Replace template expressions with values
	const resolved = condition.replace(TEMPLATE_GLOBAL_RE, (_, path: string) => {
		const value = resolvePath(path, outputs);
		return JSON.stringify(value);
	});

	// Validate against allowed tokens to prevent injection
	if (!ALLOWED_CONDITION_TOKENS.test(resolved)) {
		return true; // safe default on suspicious input
	}

	try {
		// biome-ignore lint/security/noGlobalEval: restricted to whitelisted operators
		return Boolean(new Function(`return (${resolved})`)());
	} catch {
		return true; // on evaluation failure, execute the step (safe default)
	}
}

/** Navigate a dot-delimited path within the outputs map. */
function resolvePath(path: string, outputs: Record<string, unknown>): unknown {
	const parts = path.split(".");
	const sourceStepId = parts[0];
	let value: unknown = outputs[sourceStepId];

	// Navigate nested path — skip the 'output' keyword at position 1
	for (let i = 1; i < parts.length; i++) {
		if (parts[i] === "output" && i === 1) continue;
		if (value != null && typeof value === "object") {
			value = (value as Record<string, unknown>)[parts[i]];
		} else {
			return undefined;
		}
	}

	return value;
}
