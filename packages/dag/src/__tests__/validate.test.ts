import { describe, expect, it } from "vitest";
import type { WorkflowStep } from "../types.js";
import { hasCycle, validateDAG } from "../validate.js";

function step(id: string, deps: string[] = [], inputMap: Record<string, string> = {}): WorkflowStep {
	return {
		id,
		skillRef: `${id}-skill@1.0.0`,
		binding: "static",
		dependsOn: deps,
		inputMap,
		onError: "fail",
		requiresApproval: false,
	};
}

describe("validateDAG", () => {
	it("validates a simple linear DAG", () => {
		const result = validateDAG({
			steps: [step("a"), step("b", ["a"]), step("c", ["b"])],
		});
		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
	});

	it("validates a diamond DAG", () => {
		const result = validateDAG({
			steps: [
				step("a"),
				step("b", ["a"]),
				step("c", ["a"]),
				step("d", ["b", "c"]),
			],
		});
		expect(result.valid).toBe(true);
	});

	it("validates a single-step DAG", () => {
		const result = validateDAG({ steps: [step("only")] });
		expect(result.valid).toBe(true);
	});

	it("validates parallel roots", () => {
		const result = validateDAG({
			steps: [step("a"), step("b"), step("c", ["a", "b"])],
		});
		expect(result.valid).toBe(true);
	});

	it("detects duplicate step IDs", () => {
		const result = validateDAG({ steps: [step("a"), step("a")] });
		expect(result.valid).toBe(false);
		expect(result.errors).toContain('Duplicate step ID "a"');
	});

	it("detects unknown dependency", () => {
		const result = validateDAG({ steps: [step("a", ["ghost"])] });
		expect(result.valid).toBe(false);
		expect(result.errors).toContain('Step "a" depends on unknown step "ghost"');
	});

	it("detects self-dependency", () => {
		const result = validateDAG({ steps: [step("a", ["a"])] });
		expect(result.valid).toBe(false);
		expect(result.errors).toContain('Step "a" depends on itself');
	});

	it("detects simple cycle (a→b→a)", () => {
		const result = validateDAG({
			steps: [step("a", ["b"]), step("b", ["a"])],
		});
		expect(result.valid).toBe(false);
		expect(result.errors).toContain("DAG contains a cycle");
	});

	it("detects 3-node cycle", () => {
		const result = validateDAG({
			steps: [step("a", ["c"]), step("b", ["a"]), step("c", ["b"])],
		});
		expect(result.valid).toBe(false);
		expect(result.errors).toContain("DAG contains a cycle");
	});

	it("detects input mapping to unknown step", () => {
		const result = validateDAG({
			steps: [step("a", [], { data: "{{ghost.output}}" })],
		});
		expect(result.valid).toBe(false);
		expect(result.errors).toContain(
			'Step "a" input "data" maps to unknown step "ghost"',
		);
	});

	it("detects input mapping without dependency declaration", () => {
		const result = validateDAG({
			steps: [step("a"), step("b", [], { data: "{{a.output}}" })],
		});
		expect(result.valid).toBe(false);
		expect(result.errors).toContain(
			'Step "b" input "data" maps from "a" but doesn\'t declare it in dependsOn',
		);
	});

	it("accepts input mapping with proper dependency", () => {
		const result = validateDAG({
			steps: [step("a"), step("b", ["a"], { data: "{{a.output}}" })],
		});
		expect(result.valid).toBe(true);
	});

	it("accepts literal input mappings (no template)", () => {
		const result = validateDAG({
			steps: [step("a", [], { key: "literal-value" })],
		});
		expect(result.valid).toBe(true);
	});

	it("detects retry policy missing when onError is retry", () => {
		const result = validateDAG({
			steps: [
				{
					...step("a"),
					onError: "retry" as const,
					// retry is undefined
				},
			],
		});
		expect(result.valid).toBe(false);
		expect(result.errors).toContain('Step "a" has onError "retry" but no retry policy');
	});

	it("collects multiple errors", () => {
		const result = validateDAG({
			steps: [
				step("a", ["unknown"]),
				step("a"), // duplicate
				step("b", [], { x: "{{ghost.output}}" }),
			],
		});
		expect(result.valid).toBe(false);
		expect(result.errors.length).toBeGreaterThanOrEqual(3);
	});
});

describe("hasCycle", () => {
	it("returns false for empty array", () => {
		expect(hasCycle([])).toBe(false);
	});

	it("returns false for acyclic graph", () => {
		expect(hasCycle([step("a"), step("b", ["a"]), step("c", ["b"])])).toBe(false);
	});

	it("returns true for direct cycle", () => {
		expect(hasCycle([step("a", ["b"]), step("b", ["a"])])).toBe(true);
	});

	it("returns true for indirect cycle", () => {
		expect(
			hasCycle([step("a", ["c"]), step("b", ["a"]), step("c", ["b"])]),
		).toBe(true);
	});

	it("returns false for diamond (no cycle)", () => {
		expect(
			hasCycle([
				step("a"),
				step("b", ["a"]),
				step("c", ["a"]),
				step("d", ["b", "c"]),
			]),
		).toBe(false);
	});

	it("detects cycle in subgraph", () => {
		// a → b (acyclic), c → d → c (cycle)
		expect(
			hasCycle([step("a"), step("b", ["a"]), step("c", ["d"]), step("d", ["c"])]),
		).toBe(true);
	});
});
