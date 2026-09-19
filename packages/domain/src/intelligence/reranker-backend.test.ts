// ══════════════════════════════════════════════════════════════════════════════
// LiteLLMRerankBackend — Cohere-shape rerank HTTP client
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import { LiteLLMRerankBackend } from './reranker-backend.js';

// ──────────────────────────────────────────────────────────────────────────────
// Test helpers
// ──────────────────────────────────────────────────────────────────────────────

function fetchOk(body: unknown, capture?: { url?: string; init?: RequestInit }): typeof fetch {
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (capture) {
      capture.url = String(url);
      capture.init = init;
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return body;
      },
      async text() {
        return JSON.stringify(body);
      },
    } as Response;
  }) as unknown as typeof fetch;
}

function fetchFail(status: number, text: string): typeof fetch {
  return vi.fn(async () => {
    return {
      ok: false,
      status,
      async text() {
        return text;
      },
      async json() {
        return {};
      },
    } as Response;
  }) as unknown as typeof fetch;
}

// ──────────────────────────────────────────────────────────────────────────────
// Identity
// ──────────────────────────────────────────────────────────────────────────────

describe('LiteLLMRerankBackend — identity', () => {
  it('exposes a stable litellm:<model> identity', () => {
    const backend = new LiteLLMRerankBackend({
      baseUrl: 'https://llm.example.com',
      apiKey: 'k',
      model: 'qwen3-reranker-0.6b',
      fetchImpl: fetchOk({ results: [] }),
    });
    expect(backend.identity).toBe('litellm:qwen3-reranker-0.6b');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Request shape
// ──────────────────────────────────────────────────────────────────────────────

describe('LiteLLMRerankBackend — request shape', () => {
  it('POSTs to <baseUrl>/v1/rerank with model, query, documents, top_n', async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const backend = new LiteLLMRerankBackend({
      baseUrl: 'https://llm.example.com',
      apiKey: 'sk-x',
      model: 'qwen3-reranker-0.6b',
      fetchImpl: fetchOk(
        {
          results: [
            { index: 0, relevance_score: 0.9 },
            { index: 1, relevance_score: 0.1 },
          ],
        },
        capture
      ),
    });

    await backend.score('q', ['doc a', 'doc b']);

    expect(capture.url).toBe('https://llm.example.com/v1/rerank');
    expect(capture.init?.method).toBe('POST');
    const headers = capture.init?.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers['authorization']).toBe('Bearer sk-x');

    const body = JSON.parse(capture.init?.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      model: 'qwen3-reranker-0.6b',
      query: 'q',
      documents: ['doc a', 'doc b'],
      top_n: 2,
    });
  });

  it('strips trailing slashes from baseUrl', async () => {
    const capture: { url?: string } = {};
    const backend = new LiteLLMRerankBackend({
      baseUrl: 'https://llm.example.com///',
      apiKey: 'k',
      model: 'm',
      fetchImpl: fetchOk({ results: [{ index: 0, relevance_score: 0.5 }] }, capture),
    });

    await backend.score('q', ['t']);
    expect(capture.url).toBe('https://llm.example.com/v1/rerank');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Response parsing
// ──────────────────────────────────────────────────────────────────────────────

describe('LiteLLMRerankBackend — response parsing', () => {
  it('returns scores aligned with input order via `index` field', async () => {
    const backend = new LiteLLMRerankBackend({
      baseUrl: 'https://x.io',
      apiKey: 'k',
      model: 'm',
      // API returns results reordered by relevance descending; we must re-key.
      fetchImpl: fetchOk({
        results: [
          { index: 2, relevance_score: 0.95 },
          { index: 0, relevance_score: 0.5 },
          { index: 1, relevance_score: 0.1 },
        ],
      }),
    });

    const out = await backend.score('q', ['a', 'b', 'c']);
    expect(out).toEqual([0.5, 0.1, 0.95]);
  });

  it('fills missing indices with 0', async () => {
    const backend = new LiteLLMRerankBackend({
      baseUrl: 'https://x.io',
      apiKey: 'k',
      model: 'm',
      fetchImpl: fetchOk({
        results: [{ index: 0, relevance_score: 0.8 }],
      }),
    });

    const out = await backend.score('q', ['a', 'b', 'c']);
    expect(out).toEqual([0.8, 0, 0]);
  });

  it('ignores out-of-range indices', async () => {
    const backend = new LiteLLMRerankBackend({
      baseUrl: 'https://x.io',
      apiKey: 'k',
      model: 'm',
      fetchImpl: fetchOk({
        results: [
          { index: 5, relevance_score: 99 },
          { index: -1, relevance_score: 42 },
          { index: 0, relevance_score: 0.5 },
        ],
      }),
    });

    const out = await backend.score('q', ['a', 'b']);
    expect(out).toEqual([0.5, 0]);
  });

  it('ignores rows with non-numeric score', async () => {
    const backend = new LiteLLMRerankBackend({
      baseUrl: 'https://x.io',
      apiKey: 'k',
      model: 'm',
      fetchImpl: fetchOk({
        results: [
          { index: 0, relevance_score: 'oops' },
          { index: 1, relevance_score: 0.5 },
        ],
      }),
    });

    const out = await backend.score('q', ['a', 'b']);
    expect(out).toEqual([0, 0.5]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Error handling
// ──────────────────────────────────────────────────────────────────────────────

describe('LiteLLMRerankBackend — errors', () => {
  it('throws on non-2xx with status + truncated body', async () => {
    const backend = new LiteLLMRerankBackend({
      baseUrl: 'https://x.io',
      apiKey: 'k',
      model: 'm',
      fetchImpl: fetchFail(503, 'service unavailable, please retry later'),
    });

    await expect(backend.score('q', ['a'])).rejects.toThrow(
      /HTTP 503 service unavailable/
    );
  });

  it('throws when results array is missing', async () => {
    const backend = new LiteLLMRerankBackend({
      baseUrl: 'https://x.io',
      apiKey: 'k',
      model: 'm',
      fetchImpl: fetchOk({ error: 'nope' }),
    });

    await expect(backend.score('q', ['a'])).rejects.toThrow(
      /empty results/
    );
  });

  it('throws when results array is empty', async () => {
    const backend = new LiteLLMRerankBackend({
      baseUrl: 'https://x.io',
      apiKey: 'k',
      model: 'm',
      fetchImpl: fetchOk({ results: [] }),
    });

    await expect(backend.score('q', ['a'])).rejects.toThrow(
      /empty results/
    );
  });
});
