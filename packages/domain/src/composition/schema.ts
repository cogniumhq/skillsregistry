// ══════════════════════════════════════════════════════════════════════════════
// Composition — Zod input schemas
// ══════════════════════════════════════════════════════════════════════════════
//
// Ported verbatim from mothership `src/composition/schema.ts`. Consumers
// (REST routes, MCP tools) validate incoming request bodies against these
// schemas before calling into the domain functions.
//
// ══════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';

export const forkInputSchema = z.object({
  authorId: z.string().uuid(),
  authorType: z.enum(['human', 'bot']),
});

export const copyInputSchema = z.object({
  authorId: z.string().uuid(),
  authorType: z.enum(['human', 'bot']),
});

export const compositionInputSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  description: z.string().min(10).max(2000),
  tags: z.array(z.string()).optional(),
  authorId: z.string().uuid(),
  authorType: z.enum(['human', 'bot']),
  steps: z
    .array(
      z.object({
        skillId: z.string().uuid(),
        stepName: z.string().optional(),
        inputMapping: z.record(z.string()).optional(),
        onError: z.enum(['fail', 'skip', 'retry']).optional(),
      }),
    )
    .min(2)
    .max(50),
});

export const extendInputSchema = z.object({
  authorId: z.string().uuid(),
  authorType: z.enum(['human', 'bot']),
  steps: z
    .array(
      z.object({
        skillId: z.string().uuid(),
        stepName: z.string().optional(),
        inputMapping: z.record(z.string()).optional(),
        onError: z.enum(['fail', 'skip', 'retry']).optional(),
      }),
    )
    .min(1)
    .max(50),
});

export type ForkInput = z.infer<typeof forkInputSchema>;
export type CopyInput = z.infer<typeof copyInputSchema>;
export type CompositionInputBody = z.infer<typeof compositionInputSchema>;
export type ExtendInput = z.infer<typeof extendInputSchema>;
