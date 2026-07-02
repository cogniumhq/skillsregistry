// ══════════════════════════════════════════════════════════════════════════════
// CompositionDetector — multi-skill query detection
// ══════════════════════════════════════════════════════════════════════════════
//
// Detects queries that span multiple skills and decomposes them into an
// ordered sequence of sub-tasks with matched skills.
//
// Example: "lint my rust code, check licenses, then deploy to production"
// → [{purpose: "lint rust",       skill: clippy},
//    {purpose: "check licenses",  skill: cargo-deny},
//    {purpose: "deploy production", skill: cloudflare-deploy}]
//
// ══════════════════════════════════════════════════════════════════════════════

import type { LlmAdapter } from '../adapters/llm.js';
import type { SearchProvider } from '../providers/search-provider.js';
import type { CircuitBreaker } from '../resilience/circuit-breaker.js';
import type { CompositionResult, ScoredSkill } from '../types.js';

const COMPOSITION_PROMPT = `You are analyzing a user query to detect if it requires multiple tools/skills in sequence.

A "composition" query is one where the user describes a multi-step workflow that would need different specialized tools for each step.

Examples of composition queries:
- "lint code, run tests, then deploy" → 3 skills needed
- "scan for vulnerabilities and check licenses" → 2 skills needed

Examples of NON-composition queries:
- "format my code" → 1 skill
- "deploy to production" → 1 skill
- "set up monitoring" → might involve multiple tools but the query describes a single concern

Analyze the query and respond as JSON:
{
  "is_composition": boolean,
  "parts": string[],
  "reasoning": string
}

If is_composition is false, parts should be empty.
Each part should be a concise sub-task description (3-8 words).`;

export interface CompositionDetectorOptions {
  llm: LlmAdapter;
  provider: SearchProvider;
  embedFn: (text: string) => Promise<number[]>;
  circuitBreaker: CircuitBreaker;
  /** Provider token budget for the composition-detection call. Defaults to 200. */
  maxTokens?: number;
}

export class CompositionDetector {
  private llm: LlmAdapter;
  private provider: SearchProvider;
  private embedFn: (text: string) => Promise<number[]>;
  private circuitBreaker: CircuitBreaker;
  private maxTokens: number;

  constructor(opts: CompositionDetectorOptions) {
    this.llm = opts.llm;
    this.provider = opts.provider;
    this.embedFn = opts.embedFn;
    this.circuitBreaker = opts.circuitBreaker;
    this.maxTokens = opts.maxTokens ?? 200;
  }

  async detect(
    query: string,
    _results: ScoredSkill[],
    filters: { tenantId: string }
  ): Promise<CompositionResult> {
    const notDetected: CompositionResult = {
      detected: false,
      parts: [],
      reasoning: 'Composition detection skipped (circuit breaker)',
    };

    const { result: parsed, degraded } = await this.circuitBreaker.execute(
      async () => {
        const body = await this.llm.complete({
          system: COMPOSITION_PROMPT,
          user: query,
          maxTokens: this.maxTokens,
        });
        return JSON.parse(body) as {
          is_composition?: boolean;
          parts?: string[];
          reasoning?: string;
        };
      },
      null
    );

    if (degraded || !parsed) {
      return notDetected;
    }

    if (
      !parsed.is_composition ||
      !Array.isArray(parsed.parts) ||
      parsed.parts.length === 0
    ) {
      return {
        detected: false,
        parts: [],
        reasoning: parsed.reasoning ?? 'Single-skill query',
      };
    }

    // Search for each composition part
    const parts = await Promise.all(
      parsed.parts.map(async (part: string) => {
        const embedding = await this.embedFn(part);
        const result = await this.provider.search(
          part,
          embedding,
          { tenantId: filters.tenantId, contentSafetyRequired: true },
          { limit: 1 }
        );

        return {
          purpose: part,
          skill: result.results[0] ?? null,
        };
      })
    );

    return {
      detected: true,
      parts,
      reasoning: parsed.reasoning ?? 'Multi-skill workflow detected',
    };
  }
}
