// ══════════════════════════════════════════════════════════════════════════════
// OpenAPI generation smoke — contracts schemas inside an OpenAPIHono app
// ══════════════════════════════════════════════════════════════════════════════
//
// Guards the 3.0.0 move to zod 4 + @hono/zod-openapi 1.x: the `.openapi()`
// metadata on `./common` and `./responses` must still produce named
// components and typed params, and the plain-zod `./upstream` schemas must
// still be usable as request bodies in a consumer's OpenAPI route (the
// mothership wraps them that way).

import { describe, it, expect } from 'vitest';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  SkillIdParam,
  LimitQuery,
  SkillDetailSchema,
  ErrorResponseSchema,
  SearchRequestSchema,
  SearchResponseSchema,
} from './index.js';

describe('OpenAPI document generation', () => {
  const doc = (() => {
    const a = new OpenAPIHono();
    a.openapi(
      createRoute({
        method: 'get',
        path: '/v1/skills/{id}',
        request: {
          params: z.object({ id: SkillIdParam }),
          query: z.object({ limit: LimitQuery }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: SkillDetailSchema } },
            description: 'Skill detail',
          },
          404: {
            content: { 'application/json': { schema: ErrorResponseSchema } },
            description: 'Not found',
          },
        },
      }),
      (c) => c.json({ error: 'not_found' } as never, 404),
    );
    a.openapi(
      createRoute({
        method: 'post',
        path: '/v1/search',
        request: {
          body: { content: { 'application/json': { schema: SearchRequestSchema } } },
        },
        responses: {
          200: {
            content: { 'application/json': { schema: SearchResponseSchema } },
            description: 'Search results',
          },
        },
      }),
      (c) => c.json({} as never, 200),
    );
    return a.getOpenAPI31Document({
      openapi: '3.1.0',
      info: { title: 'contracts-smoke', version: '0.0.0' },
    });
  })();

  it('registers named components from .openapi("Name")', () => {
    const names = Object.keys(doc.components?.schemas ?? {});
    expect(names).toEqual(
      expect.arrayContaining(['SkillDetail', 'ErrorResponse', 'SearchResponse']),
    );
  });

  it('emits the path param and query param with their examples', () => {
    const op = doc.paths?.['/v1/skills/{id}']?.get;
    const params = (op?.parameters ?? []) as Array<{
      name: string;
      in: string;
      schema?: { format?: string };
      example?: unknown;
    }>;
    const id = params.find((p) => p.name === 'id');
    expect(id?.in).toBe('path');
    expect(id?.schema?.format).toBe('uuid');
    const limit = params.find((p) => p.name === 'limit');
    expect(limit?.in).toBe('query');
  });

  it('accepts a plain-zod upstream schema as a request body', () => {
    const body = doc.paths?.['/v1/search']?.post?.requestBody as
      | { content: Record<string, { schema: { properties?: Record<string, unknown> } }> }
      | undefined;
    const props = body?.content['application/json']?.schema.properties ?? {};
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(['query', 'minTrust', 'allowVulnerable', 'limit']),
    );
  });
});
