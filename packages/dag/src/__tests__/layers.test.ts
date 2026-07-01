import { describe, expect, it } from "vitest";
import type { WorkflowStep } from "../types.js";
import { toExecutionLayers } from "../layers.js";

function step(id: string, deps: string[] = []): WorkflowStep {
	return {
		id,
		skillRef: `${id}-skill@1.0.0`,
		binding: "static",
		dependsOn: deps,
		inputMap: {},
		onError: "fail",
		requiresApproval: false,
	};
}

describe("toExecutionLayers", () => {
	it("single step → single layer", () => {
		const layers = toExecutionLayers([step("only")]);
		expect(layers).toEqual([{ index: 0, stepIds: ["only"] }]);
	});

	it("parallel roots → one layer", () => {
		const layers = toExecutionLayers([step("a"), step("b"), step("c")]);
		expect(layers).toEqual([{ index: 0, stepIds: ["a", "b", "c"] }]);
	});

	it("linear chain → one step per layer", () => {
		const layers = toExecutionLayers([
			step("a"),
			step("b", ["a"]),
			step("c", ["b"]),
		]);
		expect(layers).toEqual([
			{ index: 0, stepIds: ["a"] },
			{ index: 1, stepIds: ["b"] },
			{ index: 2, stepIds: ["c"] },
		]);
	});

	it("diamond DAG → 3 layers", () => {
		const layers = toExecutionLayers([
			step("a"),
			step("b", ["a"]),
			step("c", ["a"]),
			step("d", ["b", "c"]),
		]);
		expect(layers).toEqual([
			{ index: 0, stepIds: ["a"] },
			{ index: 1, stepIds: ["b", "c"] },
			{ index: 2, stepIds: ["d"] },
		]);
	});

	it("trip planning DAG (spec example)", () => {
		const layers = toExecutionLayers([
			step("flights"),
			step("hotels"),
			step("itinerary", ["flights", "hotels"]),
			step("book", ["itinerary"]),
		]);
		expect(layers).toEqual([
			{ index: 0, stepIds: ["flights", "hotels"] },
			{ index: 1, stepIds: ["itinerary"] },
			{ index: 2, stepIds: ["book"] },
		]);
	});

	it("complex DAG with multiple roots and convergence", () => {
		// a, b (roots) → c depends on a → d depends on b → e depends on c, d
		const layers = toExecutionLayers([
			step("a"),
			step("b"),
			step("c", ["a"]),
			step("d", ["b"]),
			step("e", ["c", "d"]),
		]);
		expect(layers).toEqual([
			{ index: 0, stepIds: ["a", "b"] },
			{ index: 1, stepIds: ["c", "d"] },
			{ index: 2, stepIds: ["e"] },
		]);
	});

	it("wide fan-out → two layers", () => {
		const layers = toExecutionLayers([
			step("root"),
			step("a", ["root"]),
			step("b", ["root"]),
			step("c", ["root"]),
			step("d", ["root"]),
		]);
		expect(layers).toEqual([
			{ index: 0, stepIds: ["root"] },
			{ index: 1, stepIds: ["a", "b", "c", "d"] },
		]);
	});

	it("wide fan-in → two layers", () => {
		const layers = toExecutionLayers([
			step("a"),
			step("b"),
			step("c"),
			step("sink", ["a", "b", "c"]),
		]);
		expect(layers).toEqual([
			{ index: 0, stepIds: ["a", "b", "c"] },
			{ index: 1, stepIds: ["sink"] },
		]);
	});

	it("throws on cycle", () => {
		expect(() =>
			toExecutionLayers([step("a", ["b"]), step("b", ["a"])]),
		).toThrow("Unresolvable dependencies");
	});

	it("deterministic order within layers", () => {
		// Steps provided in reverse order should still sort alphabetically within layers
		const layers = toExecutionLayers([
			step("z"),
			step("m"),
			step("a"),
		]);
		expect(layers[0].stepIds).toEqual(["a", "m", "z"]);
	});
});
