import { describe, it, expect } from 'vitest';
import {
  compositionInputSchema,
  extendInputSchema,
  forkInputSchema,
} from './schema.js';

// zod 4 migration guards (domain 2.0.0).
describe('composition input schemas (zod 4)', () => {
  it('accepts ids that are UUID-shaped but not RFC 9562 (zod 3 parity)', () => {
    const r = forkInputSchema.safeParse({
      authorId: '00000000-0000-0000-0000-000000000001',
      authorType: 'human',
    });
    expect(r.success).toBe(true);
  });

  it('rejects a non-UUID authorId', () => {
    expect(
      forkInputSchema.safeParse({ authorId: 'nope', authorType: 'bot' }).success,
    ).toBe(false);
  });

  it('inputMapping is a string → string record', () => {
    const base = {
      authorId: '00000000-0000-0000-0000-000000000001',
      authorType: 'bot' as const,
    };
    const ok = extendInputSchema.safeParse({
      ...base,
      steps: [{ skillId: '00000000-0000-0000-0000-000000000002', inputMapping: { a: '{{s1.output.x}}' } }],
    });
    expect(ok.success).toBe(true);
    const bad = extendInputSchema.safeParse({
      ...base,
      steps: [{ skillId: '00000000-0000-0000-0000-000000000002', inputMapping: { a: 1 } }],
    });
    expect(bad.success).toBe(false);
  });

  it('composition requires at least two steps', () => {
    const r = compositionInputSchema.safeParse({
      name: 'n',
      description: 'long enough description',
      authorId: '00000000-0000-0000-0000-000000000001',
      authorType: 'human',
      steps: [{ skillId: '00000000-0000-0000-0000-000000000002' }],
    });
    expect(r.success).toBe(false);
  });
});
