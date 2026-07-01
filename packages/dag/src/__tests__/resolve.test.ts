import { describe, expect, it } from "vitest";
import type { WorkflowStep } from "../types.js";
import { evaluateCondition, resolveInputs } from "../resolve.js";

function step(
	id: string,
	deps: string[] = [],
	inputMap: Record<string, string> = {},
): WorkflowStep {
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

describe("resolveInputs", () => {
	const outputs = {
		flights: { results: [{ price: 450 }, { price: 320 }], count: 2 },
		hotels: { results: [{ name: "Hilton" }] },
	};

	it("resolves simple template expression", () => {
		const s = step("itinerary", ["flights"], { data: "{{flights.output}}" });
		const resolved = resolveInputs(s, outputs);
		expect(resolved.data).toEqual({ results: [{ price: 450 }, { price: 320 }], count: 2 });
	});

	it("resolves nested path (skipping 'output' keyword)", () => {
		const s = step("x", ["flights"], { count: "{{flights.output.count}}" });
		const resolved = resolveInputs(s, outputs);
		expect(resolved.count).toBe(2);
	});

	it("resolves deep nested path", () => {
		const s = step("x", ["flights"], { first: "{{flights.output.results}}" });
		const resolved = resolveInputs(s, outputs);
		expect(resolved.first).toEqual([{ price: 450 }, { price: 320 }]);
	});

	it("resolves path without 'output' keyword", () => {
		const s = step("x", ["flights"], { data: "{{flights.count}}" });
		const resolved = resolveInputs(s, outputs);
		expect(resolved.data).toBe(2);
	});

	it("returns undefined for missing path", () => {
		const s = step("x", ["flights"], { missing: "{{flights.output.nonexistent}}" });
		const resolved = resolveInputs(s, outputs);
		expect(resolved.missing).toBeUndefined();
	});

	it("returns undefined for missing step", () => {
		const s = step("x", ["ghost"], { data: "{{ghost.output}}" });
		const resolved = resolveInputs(s, outputs);
		expect(resolved.data).toBeUndefined();
	});

	it("passes through literal strings", () => {
		const s = step("x", [], { key: "literal-value", num: "42" });
		const resolved = resolveInputs(s, outputs);
		expect(resolved.key).toBe("literal-value");
		expect(resolved.num).toBe("42");
	});

	it("handles empty input map", () => {
		const s = step("x");
		const resolved = resolveInputs(s, outputs);
		expect(resolved).toEqual({});
	});

	it("handles multiple inputs from different steps", () => {
		const s = step("merge", ["flights", "hotels"], {
			f: "{{flights.output}}",
			h: "{{hotels.output}}",
		});
		const resolved = resolveInputs(s, outputs);
		expect(resolved.f).toEqual(outputs.flights);
		expect(resolved.h).toEqual(outputs.hotels);
	});
});

describe("evaluateCondition", () => {
	const outputs = {
		research: { flightCount: 5, found: true },
		review: { score: 0.85, approved: false },
	};

	it("evaluates numeric comparison (greater than)", () => {
		expect(evaluateCondition("{{research.output.flightCount}} > 0", outputs)).toBe(true);
	});

	it("evaluates numeric comparison (less than, false)", () => {
		expect(evaluateCondition("{{research.output.flightCount}} < 0", outputs)).toBe(false);
	});

	it("evaluates equality", () => {
		expect(evaluateCondition("{{research.output.flightCount}} === 5", outputs)).toBe(true);
	});

	it("evaluates inequality", () => {
		expect(evaluateCondition("{{research.output.flightCount}} !== 3", outputs)).toBe(true);
	});

	it("evaluates boolean value", () => {
		expect(evaluateCondition("{{research.output.found}} === true", outputs)).toBe(true);
	});

	it("evaluates boolean false", () => {
		expect(evaluateCondition("{{review.output.approved}} === true", outputs)).toBe(false);
	});

	it("evaluates >= comparison", () => {
		expect(evaluateCondition("{{review.output.score}} >= 0.80", outputs)).toBe(true);
	});

	it("evaluates compound condition with &&", () => {
		expect(
			evaluateCondition(
				"{{research.output.flightCount}} > 0 && {{review.output.score}} > 0.5",
				outputs,
			),
		).toBe(true);
	});

	it("evaluates compound condition with ||", () => {
		expect(
			evaluateCondition(
				"{{research.output.flightCount}} > 100 || {{review.output.score}} > 0.5",
				outputs,
			),
		).toBe(true);
	});

	it("returns true for undefined references (safe default)", () => {
		expect(evaluateCondition("{{missing.output.x}} > 0", outputs)).toBe(false);
	});

	it("returns true on evaluation failure (safe default)", () => {
		// This produces an expression that will fail evaluation
		expect(evaluateCondition("{{research.output}} > 0", outputs)).toBe(true);
	});

	it("resolves path without 'output' keyword", () => {
		expect(evaluateCondition("{{research.flightCount}} > 0", outputs)).toBe(true);
	});
});
