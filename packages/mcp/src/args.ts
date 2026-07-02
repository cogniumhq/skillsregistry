// ══════════════════════════════════════════════════════════════════════════════
// Tool argument helpers — throw McpError with JSONRPC_INVALID_PARAMS on
// shape mismatch. Verbatim port of mothership `src/mcp/server.ts` helpers.
// ══════════════════════════════════════════════════════════════════════════════

import { JSONRPC_INVALID_PARAMS, McpError } from './errors.js';

export function asRecord(args: unknown): Record<string, unknown> {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  throw new McpError(JSONRPC_INVALID_PARAMS, 'Tool arguments must be a JSON object');
}

export function reqString(rec: Record<string, unknown>, key: string): string {
  const v = rec[key];
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new McpError(JSONRPC_INVALID_PARAMS, `Missing required string '${key}'`);
  }
  return v.trim();
}

export function optString(rec: Record<string, unknown>, key: string): string | undefined {
  const v = rec[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') {
    throw new McpError(JSONRPC_INVALID_PARAMS, `'${key}' must be a string`);
  }
  return v;
}

export function optBool(rec: Record<string, unknown>, key: string): boolean | undefined {
  const v = rec[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') {
    throw new McpError(JSONRPC_INVALID_PARAMS, `'${key}' must be a boolean`);
  }
  return v;
}

export function optStringArray(
  rec: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const v = rec[key];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) {
    throw new McpError(JSONRPC_INVALID_PARAMS, `'${key}' must be an array of strings`);
  }
  return v as string[];
}

export function clampLimit(
  rec: Record<string, unknown>,
  defaultLimit: number,
  max: number,
): number {
  const v = rec.limit;
  if (v === undefined || v === null) return defaultLimit;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) {
    throw new McpError(JSONRPC_INVALID_PARAMS, `'limit' must be a number`);
  }
  return Math.min(Math.max(1, Math.floor(n)), max);
}
