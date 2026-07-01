// ══════════════════════════════════════════════════════════════════════════════
// Common OpenAPI Schemas — Shared parameters and query schemas
// ══════════════════════════════════════════════════════════════════════════════

import { z } from '@hono/zod-openapi';

export const SkillIdParam = z.string().uuid().openapi({
  param: { name: 'id', in: 'path' },
  example: '550e8400-e29b-41d4-a716-446655440000',
});

export const SkillSlugParam = z.string().openapi({
  param: { name: 'slug', in: 'path' },
  example: 'format-code-prettier',
});

export const VersionParam = z.string().openapi({
  param: { name: 'version', in: 'path' },
  example: '1.0.0',
});

export const HoursQuery = z
  .string()
  .optional()
  .default('24')
  .openapi({ param: { name: 'hours', in: 'query' }, example: '24' });

export const LimitQuery = z
  .string()
  .optional()
  .default('100')
  .openapi({ param: { name: 'limit', in: 'query' }, example: '100' });

export const OffsetQuery = z
  .string()
  .optional()
  .default('0')
  .openapi({ param: { name: 'offset', in: 'query' }, example: '0' });
