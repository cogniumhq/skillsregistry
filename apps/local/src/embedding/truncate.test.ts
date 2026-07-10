import { describe, expect, it } from 'vitest';
import { STORED_EMBEDDING_DIMS, truncateEmbedding } from './truncate.js';

describe('truncateEmbedding', () => {
  it('returns the vector unchanged when already 512-d', () => {
    const vec = Array.from({ length: STORED_EMBEDDING_DIMS }, (_, i) => i);
    expect(truncateEmbedding(vec)).toBe(vec);
  });

  it('truncates longer vectors to 512-d', () => {
    const vec = Array.from({ length: 768 }, (_, i) => i / 768);
    const out = truncateEmbedding(vec);
    expect(out).toHaveLength(STORED_EMBEDDING_DIMS);
    expect(out[0]).toBe(vec[0]);
    expect(out.at(-1)).toBe(vec[STORED_EMBEDDING_DIMS - 1]);
  });

  it('throws when the vector is too short', () => {
    expect(() => truncateEmbedding([0.1, 0.2])).toThrow(/shorter than required/);
  });
});
