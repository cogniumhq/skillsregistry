import { z } from "zod";

export const DAG_SCHEMA_VERSION = "1.0";

/** Retry policy for a workflow step. */
export const RetryPolicy = z.object({
	count: z.number().int().min(1).max(10),
	backoff: z.enum(["fixed", "exponential"]),
	delayMs: z.number().int().min(100).max(300_000).default(1000),
});

/** Maps target input parameter names to source expressions or literals. */
export const InputMapping = z.record(
	z.string(), // target input parameter name
	z.string(), // source: "{{stepId.output.field}}" or literal value
);

const STEP_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** A single step in a workflow DAG. */
export const WorkflowStep = z.object({
	// Identity
	id: z.string().min(1).max(64).regex(STEP_ID_PATTERN, {
		message: "Step ID must be lowercase alphanumeric with hyphens/underscores, starting with alphanumeric",
	}),

	// Skill reference
	skillRef: z.string().min(1), // slug@version (static) or natural language query (dynamic)
	binding: z.enum(["static", "dynamic"]).default("static"),

	// DAG structure
	dependsOn: z.array(z.string()).default([]), // step IDs — defines the DAG edges

	// Data flow
	inputMap: InputMapping.default({}),

	// Conditional execution
	condition: z.string().optional(), // expression evaluated against prior step outputs

	// Error handling
	onError: z.enum(["fail", "skip", "retry"]).default("fail"),
	retry: RetryPolicy.optional(),

	// Approval
	requiresApproval: z.boolean().default(false),

	// Metadata (informational, not used by executor)
	title: z.string().optional(),
	description: z.string().optional(),
});

/**
 * WorkflowDAG — the top-level workflow definition.
 *
 * Structural validation (cycles, dependencies, input mapping) is performed
 * separately via `validateDAG()` rather than in the Zod refine, so callers
 * get detailed error messages instead of a single generic failure.
 */
export const WorkflowDAG = z.object({
	// Identity
	id: z.string().min(1).max(64),
	name: z.string().min(1).max(200),
	version: z.string().regex(/^\d+\.\d+\.\d+$/, {
		message: "Version must be semver (e.g. 1.0.0)",
	}),

	// Steps — the nodes and edges of the DAG
	steps: z.array(WorkflowStep).min(1).max(100),

	// Metadata
	description: z.string().optional(),
	tags: z.array(z.string()).default([]),
	author: z.string().optional(),
	createdAt: z.string().datetime().optional(),
});
