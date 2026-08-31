// ══════════════════════════════════════════════════════════════════════════════
// Write tools — B0.5 (techspec/buzz.md §8.5 / §9.1a)
// ══════════════════════════════════════════════════════════════════════════════
//
// publish_skill / revise_skill / list_my_skills — the publish + hone loop for a
// private/self-hosted instance. These are registry capabilities (every MCP
// client gets them), not Buzz-specific.
//
// Each handler requires the optional `writes` adapter. The dispatcher gates
// visibility + dispatch on `config.writeEnabled` (§9.1a — mirrors
// SIGNATURE_REQUIRED), so on a read-only deployment these are never reached;
// the defensive guard here reports the same "not found" posture if a tool is
// somehow invoked without a writes port wired.
// ══════════════════════════════════════════════════════════════════════════════

import type { ToolContext, ToolDefinition, ToolResult } from '../types.js';
import { asRecord, optString, reqString, clampLimit } from '../args.js';

function requireWrites(ctx: ToolContext): ToolResult | null {
  if (!ctx.adapters.writes) {
    return { value: { error: 'Write tools are not enabled on this instance.' }, isError: true };
  }
  return null;
}

// ── publish_skill ──────────────────────────────────────────────────────────

async function publishHandler(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const notReady = requireWrites(ctx);
  if (notReady) return notReady;
  const result = await ctx.adapters.writes!.publishSkill(asRecord(args), ctx.tenantId);
  if (!result.ok) return { value: { error: result.error ?? 'publish failed' }, isError: true };
  return { value: result.data };
}

export const publishSkillTool: ToolDefinition = {
  name: 'publish_skill',
  description:
    'Publish a new skill to this registry instance. Available only on instances with writes enabled.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Human-readable skill name.' },
      slug: { type: 'string', description: 'URL-safe id: lowercase letters, digits, hyphens.' },
      description: { type: 'string', description: 'What the skill does.' },
      executionLayer: {
        type: 'string',
        description: "e.g. 'instructions' for prompt/instruction-shaped skills, 'mcp-remote', 'worker'.",
      },
      skillMd: { type: 'string', description: 'The skill body / SKILL.md (instruction skills).' },
      version: { type: 'string', description: 'SemVer; defaults per instance policy if omitted.' },
      mcpUrl: { type: 'string', description: 'MCP server URL (mcp-remote skills).' },
      authorId: { type: 'string', description: 'Author id — the key list_my_skills / revise filter on.' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['name', 'slug', 'description'],
  },
  handler: publishHandler,
};

// ── revise_skill ───────────────────────────────────────────────────────────

async function reviseHandler(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const notReady = requireWrites(ctx);
  if (notReady) return notReady;
  const rec = asRecord(args);
  const slug = reqString(rec, 'slug');
  const bumpRaw = optString(rec, 'bump');
  const bump = bumpRaw === 'major' ? 'major' : 'minor';
  const result = await ctx.adapters.writes!.reviseSkill(
    slug,
    { bump, skillMd: optString(rec, 'skillMd'), description: optString(rec, 'description'), authorId: optString(rec, 'authorId') },
    ctx.tenantId,
  );
  if (!result.ok) return { value: { error: result.error ?? 'revise failed' }, isError: true };
  return { value: result.data };
}

export const reviseSkillTool: ToolDefinition = {
  name: 'revise_skill',
  description:
    'Publish a new SemVer of a skill you authored, off its current version (the honing loop). Older versions stay live; pinned workflows are never force-upgraded.',
  inputSchema: {
    type: 'object',
    properties: {
      slug: { type: 'string', description: 'Slug of the skill to revise.' },
      bump: { type: 'string', description: "SemVer bump: 'minor' (default) or 'major'." },
      skillMd: { type: 'string', description: 'New body (optional; inherits current if omitted).' },
      description: { type: 'string', description: 'New description (optional; inherits current).' },
      authorId: { type: 'string', description: "Author id; must match the skill's author." },
    },
    required: ['slug'],
  },
  handler: reviseHandler,
};

// ── list_my_skills ─────────────────────────────────────────────────────────

async function listHandler(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const notReady = requireWrites(ctx);
  if (notReady) return notReady;
  const rec = asRecord(args);
  const authorId = reqString(rec, 'authorId');
  const limit = clampLimit(rec, 50, 200);
  const result = await ctx.adapters.writes!.listByAuthor(authorId, limit, ctx.tenantId);
  if (!result.ok) return { value: { error: result.error ?? 'list failed' }, isError: true };
  return { value: result.data };
}

export const listMySkillsTool: ToolDefinition = {
  name: 'list_my_skills',
  description: 'List skills authored by a given author id — the private scope on this instance.',
  inputSchema: {
    type: 'object',
    properties: {
      authorId: { type: 'string', description: 'Author id to filter by.' },
      limit: { type: 'number', description: 'Max rows (default 50, max 200).' },
    },
    required: ['authorId'],
  },
  handler: listHandler,
};

export const WRITE_TOOLS: readonly ToolDefinition[] = [
  publishSkillTool,
  reviseSkillTool,
  listMySkillsTool,
];
