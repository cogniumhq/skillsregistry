import { describe, expect, it } from "vitest";
import { RetryPolicy, WorkflowDAG, WorkflowStep } from "../schema.js";

describe("RetryPolicy", () => {
	it("accepts valid retry policy", () => {
		const result = RetryPolicy.parse({ count: 3, backoff: "exponential", delayMs: 2000 });
		expect(result.count).toBe(3);
		expect(result.backoff).toBe("exponential");
		expect(result.delayMs).toBe(2000);
	});

	it("applies default delayMs", () => {
		const result = RetryPolicy.parse({ count: 1, backoff: "fixed" });
		expect(result.delayMs).toBe(1000);
	});

	it("rejects count < 1", () => {
		expect(() => RetryPolicy.parse({ count: 0, backoff: "fixed" })).toThrow();
	});

	it("rejects count > 10", () => {
		expect(() => RetryPolicy.parse({ count: 11, backoff: "fixed" })).toThrow();
	});

	it("rejects delayMs < 100", () => {
		expect(() => RetryPolicy.parse({ count: 1, backoff: "fixed", delayMs: 50 })).toThrow();
	});

	it("rejects delayMs > 300000", () => {
		expect(() => RetryPolicy.parse({ count: 1, backoff: "fixed", delayMs: 400_000 })).toThrow();
	});

	it("rejects invalid backoff strategy", () => {
		expect(() => RetryPolicy.parse({ count: 1, backoff: "linear" })).toThrow();
	});
});

describe("WorkflowStep", () => {
	const minimal = { id: "step-1", skillRef: "flight-search@1.0.0" };

	it("accepts minimal step with defaults", () => {
		const result = WorkflowStep.parse(minimal);
		expect(result.id).toBe("step-1");
		expect(result.skillRef).toBe("flight-search@1.0.0");
		expect(result.binding).toBe("static");
		expect(result.dependsOn).toEqual([]);
		expect(result.inputMap).toEqual({});
		expect(result.onError).toBe("fail");
		expect(result.requiresApproval).toBe(false);
	});

	it("accepts fully specified step", () => {
		const result = WorkflowStep.parse({
			id: "book",
			skillRef: "booking-agent@1.0.0",
			binding: "dynamic",
			dependsOn: ["flights", "hotels"],
			inputMap: { plan: "{{itinerary.output}}" },
			condition: "{{research.output.count}} > 0",
			onError: "retry",
			retry: { count: 3, backoff: "exponential", delayMs: 2000 },
			requiresApproval: true,
			title: "Book everything",
			description: "Book flights and hotels based on itinerary",
		});
		expect(result.requiresApproval).toBe(true);
		expect(result.retry?.count).toBe(3);
	});

	it("rejects empty id", () => {
		expect(() => WorkflowStep.parse({ id: "", skillRef: "x@1.0.0" })).toThrow();
	});

	it("rejects id > 64 chars", () => {
		expect(() => WorkflowStep.parse({ id: "a".repeat(65), skillRef: "x@1.0.0" })).toThrow();
	});

	it("rejects id starting with hyphen", () => {
		expect(() => WorkflowStep.parse({ id: "-bad", skillRef: "x@1.0.0" })).toThrow();
	});

	it("rejects id with uppercase", () => {
		expect(() => WorkflowStep.parse({ id: "Step1", skillRef: "x@1.0.0" })).toThrow();
	});

	it("rejects id with spaces", () => {
		expect(() => WorkflowStep.parse({ id: "step one", skillRef: "x@1.0.0" })).toThrow();
	});

	it("accepts id with underscore", () => {
		const result = WorkflowStep.parse({ id: "step_1", skillRef: "x@1.0.0" });
		expect(result.id).toBe("step_1");
	});

	it("rejects empty skillRef", () => {
		expect(() => WorkflowStep.parse({ id: "s1", skillRef: "" })).toThrow();
	});
});

describe("WorkflowDAG", () => {
	const tripPlanning = {
		id: "trip-planning",
		name: "Plan a trip",
		version: "1.0.0",
		steps: [
			{ id: "flights", skillRef: "flight-search@1.2.0", dependsOn: [] },
			{ id: "hotels", skillRef: "hotel-search@1.0.0", dependsOn: [] },
			{
				id: "itinerary",
				skillRef: "itinerary-builder@2.0.0",
				dependsOn: ["flights", "hotels"],
				inputMap: {
					flights: "{{flights.output}}",
					hotels: "{{hotels.output}}",
				},
			},
			{
				id: "book",
				skillRef: "booking-agent@1.0.0",
				dependsOn: ["itinerary"],
				inputMap: { plan: "{{itinerary.output}}" },
				requiresApproval: true,
			},
		],
	};

	it("accepts a valid DAG", () => {
		const result = WorkflowDAG.parse(tripPlanning);
		expect(result.id).toBe("trip-planning");
		expect(result.steps).toHaveLength(4);
		expect(result.tags).toEqual([]);
	});

	it("accepts DAG with optional metadata", () => {
		const result = WorkflowDAG.parse({
			...tripPlanning,
			description: "Research, plan, and book a trip",
			tags: ["travel", "booking"],
			author: "cognium",
			createdAt: "2026-04-15T00:00:00Z",
		});
		expect(result.description).toBe("Research, plan, and book a trip");
		expect(result.tags).toEqual(["travel", "booking"]);
	});

	it("rejects empty steps", () => {
		expect(() =>
			WorkflowDAG.parse({ id: "empty", name: "Empty", version: "1.0.0", steps: [] }),
		).toThrow();
	});

	it("rejects > 100 steps", () => {
		const steps = Array.from({ length: 101 }, (_, i) => ({
			id: `s${i}`,
			skillRef: `skill@1.0.0`,
		}));
		expect(() =>
			WorkflowDAG.parse({ id: "big", name: "Big", version: "1.0.0", steps }),
		).toThrow();
	});

	it("rejects invalid version format", () => {
		expect(() =>
			WorkflowDAG.parse({
				id: "x",
				name: "X",
				version: "v1.0",
				steps: [{ id: "s1", skillRef: "x@1.0.0" }],
			}),
		).toThrow();
	});

	it("accepts valid semver version", () => {
		const result = WorkflowDAG.parse({
			id: "x",
			name: "X",
			version: "12.3.456",
			steps: [{ id: "s1", skillRef: "x@1.0.0" }],
		});
		expect(result.version).toBe("12.3.456");
	});
});
