// ══════════════════════════════════════════════════════════════════════════════
// Reranker backend — cross-encoder port + LiteLLM/Cohere-shape implementation
// ══════════════════════════════════════════════════════════════════════════════
//
// The `Reranker` class owns candidate selection, summary fetching, and the
// rank merge. The cross-encoder call itself is one fetch — pluggable behind
// this backend interface so runtimes can swap between hosted rerankers
// (Workers AI bge-reranker-base, Cohere, Voyage) without changing the rest
// of the rerank path.
//
// Contract: `score(query, texts)` returns one relevance score per text, in
// the SAME ORDER as the input texts. Higher = more relevant. Callers never
// see backend-specific response shapes.
//
// Backends that require runtime bindings (Workers AI's `env.AI.run`) live
// in the consumer, not in the domain package — they implement
// `RerankerBackend` directly against their host binding. The domain ships
// only the port and the runtime-agnostic Cohere-shape HTTP backend that
// works anywhere `fetch` exists (Workers, Node 20+, Deno).
//
// ══════════════════════════════════════════════════════════════════════════════

export interface RerankerBackend {
  /** Identity string baked into logs + (eventually) cache keys. */
  readonly identity: string;

  /**
   * Returns one relevance score per text, in the same index order as the
   * input. Higher = more relevant. MUST throw on transport / parse failure
   * so the caller's circuit breaker can record it.
   */
  score(query: string, texts: string[]): Promise<number[]>;
}

// ────────────────────────────────────────────────────────────────────────────
// LiteLLMRerankBackend — Cohere-shape `/v1/rerank` at any OpenAI-compatible
// proxy (LiteLLM / Cohere itself). Runtime-agnostic.
// ────────────────────────────────────────────────────────────────────────────
//
// Request:
//   POST {baseUrl}/v1/rerank
//   { model, query, documents, top_n }
// Response:
//   { results: [{ index, relevance_score }], ... }
//
// We send `top_n = documents.length` to force a score for every input doc
// (the proxy may truncate otherwise) and re-key by `index`.

export interface LiteLLMRerankBackendOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Optional override for tests; defaults to `fetch`. */
  fetchImpl?: typeof fetch;
}

export class LiteLLMRerankBackend implements RerankerBackend {
  readonly identity: string;
  private fetchImpl: typeof fetch;

  constructor(private opts: LiteLLMRerankBackendOptions) {
    this.identity = `litellm:${opts.model}`;
    // Some runtimes (Cloudflare Workers) require `fetch` to be called on
    // `globalThis`; storing it as a bare method ref loses that binding and
    // trips "Illegal invocation". Wrap it so the runtime sees a plain
    // function call. Tests inject their own `fetchImpl`, which is
    // unaffected.
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  async score(query: string, texts: string[]): Promise<number[]> {
    const url = `${this.opts.baseUrl.replace(/\/+$/, '')}/v1/rerank`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({
        model: this.opts.model,
        query,
        documents: texts,
        top_n: texts.length,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `litellm rerank failed: HTTP ${res.status} ${body.slice(0, 200)}`
      );
    }

    const payload = (await res.json()) as {
      results?: Array<{ index?: number; relevance_score?: number }>;
    };
    const results = payload.results;
    if (!Array.isArray(results) || results.length === 0) {
      throw new Error(
        `litellm rerank returned empty results: ${JSON.stringify(payload).slice(0, 200)}`
      );
    }

    const scores = new Array<number>(texts.length).fill(0);
    for (const row of results) {
      const idx = row.index;
      const s = row.relevance_score;
      if (
        typeof idx === 'number' &&
        idx >= 0 &&
        idx < texts.length &&
        typeof s === 'number'
      ) {
        scores[idx] = s;
      }
    }
    return scores;
  }
}
