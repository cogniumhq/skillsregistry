import type { z } from "zod";
import type * as schema from "./schema.js";

export type RetryPolicy = z.infer<typeof schema.RetryPolicy>;
export type InputMapping = z.infer<typeof schema.InputMapping>;
export type WorkflowStep = z.infer<typeof schema.WorkflowStep>;
export type WorkflowDAG = z.infer<typeof schema.WorkflowDAG>;

/** Result of DAG structural validation. */
export interface ValidationResult {
	valid: boolean;
	errors: string[];
}

/** A group of steps that can execute in parallel. */
export interface ExecutionLayer {
	index: number;
	stepIds: string[];
}
