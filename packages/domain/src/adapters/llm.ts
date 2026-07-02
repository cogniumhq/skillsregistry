// ══════════════════════════════════════════════════════════════════════════════
// LlmAdapter — chat-completion port used by the intelligence layer
// ══════════════════════════════════════════════════════════════════════════════
//
// The intelligence layer (deep-search, composition-detector) needs to ask a
// language model for JSON-shaped decisions: alternate query phrasings, is-
// this-a-composition-query, and so on. Every consumer wires its own concrete
// LLM at boot — Workers AI's `env.AI.run(model, {messages})`, a raw HTTP
// POST to an OpenAI-compatible proxy, a local Ollama process — and passes
// it through to the domain classes.
//
// The domain code never touches provider-specific request/response shapes;
// it just calls `complete({ system, user, maxTokens })` and gets a string
// back. Providers are responsible for extracting the message body from
// their own response envelope (`response.response`, `choices[0].message.content`,
// etc.) before returning.
//
// `identity` is a free-form stamp (`"workers-ai:@cf/meta/llama-3.3-70b"`,
// `"litellm:cognium/qwen3-32b"`) used purely for logging + eventual cache
// keys — the domain does not parse it.
//
// Failure contract: MUST throw on transport / parse errors so the caller's
// circuit breaker can record the failure.
//
// ══════════════════════════════════════════════════════════════════════════════

export interface LlmCompleteInput {
  /** Optional system prompt. Callers usually pin the JSON contract here. */
  system?: string;
  /** The user message. Domain callers pass the actual query / instruction. */
  user: string;
  /** Provider-side token budget. Domain callers pass appetite-appropriate values. */
  maxTokens?: number;
}

export interface LlmAdapter {
  /**
   * Free-form identity stamp (`"workers-ai:llama-3.3-70b"`, etc.) — used
   * for logging + eventual cache keys. Domain code never parses this.
   */
  readonly identity: string;

  /**
   * Chat-completion: returns the assistant message body as a plain string.
   * MUST throw on transport / parse failure.
   */
  complete(input: LlmCompleteInput): Promise<string>;
}
