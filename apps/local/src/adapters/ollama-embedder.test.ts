import { describe, expect, it, vi } from 'vitest';
import { createOllamaEmbedder } from './ollama-embedder.js';

type FetchImpl = typeof fetch;

/**
 * Minimal fetch fake — returns the queued responses in order. Each entry is
 * the JSON body to return with a 200; use `{ status, body }` for error paths.
 */
function fakeFetch(
  queue: Array<
    { status?: number; body: unknown } | { throws: unknown } | unknown
  >,
): { impl: FetchImpl; calls: Array<{ url: string; body: unknown }> } {
  const calls: Array<{ url: string; body: unknown }> = [];
  const impl: FetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, body });
    const next = queue.shift();
    if (
      next !== undefined &&
      typeof next === 'object' &&
      next !== null &&
      'throws' in next
    ) {
      throw (next as { throws: unknown }).throws;
    }
    const wrapped =
      next !== undefined &&
      typeof next === 'object' &&
      next !== null &&
      'body' in next
        ? (next as { status?: number; body: unknown })
        : { status: 200, body: next };
    return new Response(JSON.stringify(wrapped.body), {
      status: wrapped.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as FetchImpl;
  return { impl, calls };
}

describe('createOllamaEmbedder', () => {
  it('probes dim at construction and exposes identity', async () => {
    const { impl } = fakeFetch([{ embeddings: [[0.1, 0.2, 0.3, 0.4]] }]);
    const embedder = await createOllamaEmbedder({
      url: 'http://localhost:11434',
      model: 'nomic-embed-text',
      fetchImpl: impl,
    });
    expect(embedder.identity.id).toBe('nomic-embed-text@ollama-4');
    expect(embedder.identity.dim).toBe(4);
  });

  it('accepts an identityOverride', async () => {
    const { impl } = fakeFetch([{ embeddings: [[1, 2]] }]);
    const embedder = await createOllamaEmbedder({
      url: 'http://localhost:11434',
      model: 'x',
      identityOverride: 'custom-id',
      fetchImpl: impl,
    });
    expect(embedder.identity.id).toBe('custom-id');
    expect(embedder.identity.dim).toBe(2);
  });

  it('throws if the probe returns an empty vector', async () => {
    const { impl } = fakeFetch([{ embeddings: [[]] }]);
    await expect(
      createOllamaEmbedder({
        url: 'http://localhost:11434',
        model: 'broken',
        fetchImpl: impl,
      }),
    ).rejects.toThrow(/empty vector/);
  });

  it('embed() returns a Float32Array of correct dim', async () => {
    const { impl, calls } = fakeFetch([
      { embeddings: [[0.1, 0.2]] }, // probe
      { embeddings: [[0.5, 0.6]] }, // embed
    ]);
    const embedder = await createOllamaEmbedder({
      url: 'http://localhost:11434',
      model: 'x',
      fetchImpl: impl,
    });
    const vec = await embedder.embed('hello');
    expect(vec).toBeInstanceOf(Float32Array);
    expect(Array.from(vec)).toEqual([
      Math.fround(0.5),
      Math.fround(0.6),
    ]);
    expect(calls[1]!.body).toEqual({ model: 'x', input: ['hello'] });
  });

  it('embedBatch() returns one vector per input, in order', async () => {
    const { impl } = fakeFetch([
      { embeddings: [[1, 1]] }, // probe
      { embeddings: [[2, 2], [3, 3], [4, 4]] },
    ]);
    const embedder = await createOllamaEmbedder({
      url: 'http://localhost:11434',
      model: 'x',
      fetchImpl: impl,
    });
    const rows = await embedder.embedBatch(['a', 'b', 'c']);
    expect(rows.map((r) => Array.from(r))).toEqual([
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
  });

  it('embedBatch() short-circuits on empty input', async () => {
    const { impl, calls } = fakeFetch([{ embeddings: [[1]] }]);
    const embedder = await createOllamaEmbedder({
      url: 'http://localhost:11434',
      model: 'x',
      fetchImpl: impl,
    });
    const before = calls.length;
    const rows = await embedder.embedBatch([]);
    expect(rows).toEqual([]);
    expect(calls.length).toBe(before);
  });

  it('embed() throws on dim mismatch', async () => {
    const { impl } = fakeFetch([
      { embeddings: [[1, 1]] }, // probe → dim 2
      { embeddings: [[1, 1, 1]] }, // returns 3 — mismatch
    ]);
    const embedder = await createOllamaEmbedder({
      url: 'http://localhost:11434',
      model: 'x',
      fetchImpl: impl,
    });
    await expect(embedder.embed('bad')).rejects.toThrow(/dim mismatch/);
  });

  it('propagates HTTP error status with body', async () => {
    const { impl } = fakeFetch([
      { embeddings: [[1]] }, // probe ok
      { status: 500, body: { error: 'model missing' } },
    ]);
    const embedder = await createOllamaEmbedder({
      url: 'http://localhost:11434',
      model: 'x',
      fetchImpl: impl,
    });
    await expect(embedder.embed('x')).rejects.toThrow(/responded 500/);
  });

  it('accepts the legacy /api/embed single-vector shape', async () => {
    // Some Ollama builds return `{ embedding: [...] }` even on /api/embed.
    const { impl } = fakeFetch([{ embedding: [0.5, 0.5] }]);
    const embedder = await createOllamaEmbedder({
      url: 'http://localhost:11434',
      model: 'x',
      fetchImpl: impl,
    });
    expect(embedder.identity.dim).toBe(2);
  });

  it('strips trailing slash from url', async () => {
    const { impl, calls } = fakeFetch([{ embeddings: [[1]] }]);
    await createOllamaEmbedder({
      url: 'http://localhost:11434/',
      model: 'x',
      fetchImpl: impl,
    });
    expect(calls[0]!.url).toBe('http://localhost:11434/api/embed');
  });
});
