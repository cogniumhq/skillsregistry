// ══════════════════════════════════════════════════════════════════════════════
// JSON-RPC 2.0 dispatch — transport-agnostic core
// ══════════════════════════════════════════════════════════════════════════════
//
// Consumers call `handleMcpRequest(body, ctx)` with the parsed JSON body and a
// `DispatchContext` bundling tenant id + adapters + resolved config. Returns
// either a single JSON-RPC response, a batch, or `null` for notifications /
// empty batches that produced no output (HTTP 202 on the wire).
//
// Verbatim port of mothership `src/mcp/server.ts` dispatch loop, refactored
// to take the adapter bundle instead of `Env`.
// ══════════════════════════════════════════════════════════════════════════════

import type {
  JsonRpcError,
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccess,
  McpAdapters,
  ResolvedMcpConfig,
  ToolContext,
  ToolResult,
} from './types.js';
import {
  JSONRPC_INTERNAL_ERROR,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_METHOD_NOT_FOUND,
  JSONRPC_PARSE_ERROR,
  McpError,
} from './errors.js';
import {
  MCP_PROTOCOL_VERSION,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
} from './protocol.js';
import { SKILL_RESOLVING_TOOLS, TOOLS, TOOL_BY_NAME, WRITE_TOOLS, WRITE_TOOL_BY_NAME } from './tools/index.js';

export interface DispatchContext {
  tenantId: string;
  adapters: McpAdapters;
  config: ResolvedMcpConfig;
}

/**
 * Result of dispatching a single request / batch:
 *   - `{ kind: 'json', body }` → serialize `body` as JSON with 200.
 *   - `{ kind: 'accepted' }`   → HTTP 202, no body (notification / empty batch).
 *   - `{ kind: 'error', status, body }` → error before dispatch could run
 *     (bad JSON, empty batch, oversize batch).
 */
export type DispatchOutcome =
  | { kind: 'json'; body: JsonRpcResponse | JsonRpcResponse[] }
  | { kind: 'accepted' }
  | { kind: 'error'; status: number; body: JsonRpcError };

export async function handleMcpRequest(
  body: unknown,
  ctx: DispatchContext,
): Promise<DispatchOutcome> {
  // JSON-RPC 2.0 batch support. Cap the batch size so a single client can't
  // fan out 10K sub-requests through one HTTP frame — each entry spawns its
  // own downstream work inside the per-tool handlers.
  if (Array.isArray(body)) {
    if (body.length === 0) {
      return {
        kind: 'error',
        status: 400,
        body: err(null, JSONRPC_INVALID_REQUEST, 'Empty batch'),
      };
    }
    if (body.length > ctx.config.batchMax) {
      return {
        kind: 'error',
        status: 400,
        body: err(
          null,
          JSONRPC_INVALID_REQUEST,
          `Batch size ${body.length} exceeds maximum ${ctx.config.batchMax}`,
        ),
      };
    }
    const responses = await Promise.all(
      body.map((entry) => dispatch(entry as JsonRpcRequest, ctx)),
    );
    const filtered = responses.filter((r): r is JsonRpcResponse => r !== null);
    if (filtered.length === 0) return { kind: 'accepted' };
    return { kind: 'json', body: filtered };
  }

  const response = await dispatch(body as JsonRpcRequest, ctx);
  if (response === null) return { kind: 'accepted' };
  return { kind: 'json', body: response };
}

/** Build a JSON-RPC parse-error response for callers that fail to parse the body. */
export function parseErrorResponse(): JsonRpcError {
  return err(null, JSONRPC_PARSE_ERROR, 'Invalid JSON');
}

// ──────────────────────────────────────────────────────────────────────────────

function ok(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result };
}

function err(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcError {
  const payload: JsonRpcError = { jsonrpc: '2.0', id, error: { code, message } };
  if (data !== undefined) payload.error.data = data;
  return payload;
}

async function dispatch(
  req: JsonRpcRequest,
  ctx: DispatchContext,
): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  // Notifications (no id) get no response, per JSON-RPC 2.0.
  const isNotification = req.id === undefined;

  if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return isNotification
      ? null
      : err(id, JSONRPC_INVALID_REQUEST, 'Malformed JSON-RPC request');
  }

  try {
    switch (req.method) {
      case 'initialize': {
        // Protocol-version negotiation per MCP 2025-03-26 §Initialization.
        const requested =
          req.params && typeof req.params === 'object' && req.params !== null
            ? (req.params as { protocolVersion?: unknown }).protocolVersion
            : undefined;
        const protocolVersion =
          typeof requested === 'string' &&
          MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
            ? requested
            : MCP_PROTOCOL_VERSION;
        return isNotification
          ? null
          : ok(id, {
              protocolVersion,
              capabilities: { tools: { listChanged: false } },
              serverInfo: {
                name: ctx.config.serverName,
                version: ctx.config.serverVersion,
              },
            });
      }

      case 'initialized':
      case 'notifications/initialized':
        return null;

      case 'ping':
        return isNotification ? null : ok(id, {});

      case 'tools/list': {
        if (isNotification) return null;
        // B0.5 — advertise write tools only when the instance enables writes
        // AND provides the port. Default off → the read-only base surface.
        const base =
          ctx.config.writeEnabled && ctx.adapters.writes
            ? [...TOOLS, ...WRITE_TOOLS]
            : TOOLS;
        // cortex.md §16.4 enforcement point #1 — filter the advertised
        // tool set through the optional per-tenant policy. Absent policy
        // adapter = allow-all (v1 posture).
        const visibleTools = ctx.adapters.policy
          ? await filterAllowed(base, ctx.tenantId, ctx.adapters.policy)
          : base;
        return ok(id, {
          tools: visibleTools.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
        });
      }

      case 'tools/call': {
        const params = (req.params ?? {}) as { name?: string; arguments?: unknown };
        if (!params.name || typeof params.name !== 'string') {
          throw new McpError(JSONRPC_INVALID_PARAMS, 'tools/call requires `name`');
        }
        // Read tools always; write tools only when enabled + port present.
        // A write-tool name on a read-only instance falls through to the same
        // METHOD_NOT_FOUND an unknown tool gets — its existence never leaks.
        const tool =
          TOOL_BY_NAME.get(params.name) ??
          (ctx.config.writeEnabled && ctx.adapters.writes
            ? WRITE_TOOL_BY_NAME.get(params.name)
            : undefined);
        if (!tool) {
          throw new McpError(
            JSONRPC_METHOD_NOT_FOUND,
            `Unknown tool: ${params.name}`,
          );
        }
        // cortex.md §16.4 enforcement point #2 — re-check policy at invoke
        // time so a hallucinated / stale tool name from the LLM cannot
        // bypass the tenant scope. Same shape as the list-time filter:
        // absent policy = allow. Returned as JSONRPC_METHOD_NOT_FOUND so
        // the caller cannot distinguish "tool doesn't exist" from "tool
        // exists but not for you" — matches the mothership's posture.
        if (ctx.adapters.policy) {
          const allowed = await ctx.adapters.policy.isToolAllowed(
            params.name,
            ctx.tenantId,
          );
          if (!allowed) {
            throw new McpError(
              JSONRPC_METHOD_NOT_FOUND,
              `Unknown tool: ${params.name}`,
            );
          }
        }
        const toolCtx: ToolContext = {
          adapters: ctx.adapters,
          config: ctx.config,
          tenantId: ctx.tenantId,
        };
        // Time the call, record outcome + resolved skill id via
        // afterResponse() so the write never sits on the response path.
        const startedAt = Date.now();
        let toolResult: ToolResult;
        try {
          toolResult = await tool.handler(params.arguments ?? {}, toolCtx);
        } catch (e) {
          const durationMs = Date.now() - startedAt;
          const errorCode = e instanceof McpError ? e.code : JSONRPC_INTERNAL_ERROR;
          scheduleRecord(ctx, {
            toolName: params.name,
            tenantId: ctx.tenantId,
            skillId: null,
            succeeded: false,
            durationMs,
            errorCode,
            args: params.arguments ?? null,
          });
          throw e;
        }
        const durationMs = Date.now() - startedAt;
        // Tool-domain failures (e.g. slug not found) are reported inside the
        // success envelope per MCP 2025-03-26 §tools/call. The observability
        // row reflects the underlying outcome — don't stamp a skill id or
        // count the call as a success when isError is set.
        const succeeded = !toolResult.isError;
        scheduleRecord(ctx, {
          toolName: params.name,
          tenantId: ctx.tenantId,
          skillId: succeeded ? toolResult.resolvedSkillId ?? null : null,
          succeeded,
          durationMs,
          errorCode: null,
          args: params.arguments ?? null,
        });
        return isNotification
          ? null
          : ok(id, {
              content: [{ type: 'text', text: JSON.stringify(toolResult.value) }],
              isError: toolResult.isError === true,
            });
      }

      default:
        if (isNotification) return null;
        throw new McpError(JSONRPC_METHOD_NOT_FOUND, `Method not found: ${req.method}`);
    }
  } catch (e) {
    if (isNotification) return null;
    if (e instanceof McpError) {
      return err(id, e.code, e.message, e.data);
    }
    const message = e instanceof Error ? e.message : String(e);
    return err(id, JSONRPC_INTERNAL_ERROR, message);
  }
}

/**
 * Filter `tools` through the per-tenant policy in parallel. Ordering is
 * preserved so the returned list matches source order — matters for
 * callers that pin the first advertised tool as canonical.
 */
async function filterAllowed<T extends { name: string }>(
  tools: readonly T[],
  tenantId: string,
  policy: import('./types.js').McpPolicyPort,
): Promise<T[]> {
  const decisions = await Promise.all(
    tools.map((t) => policy.isToolAllowed(t.name, tenantId)),
  );
  return tools.filter((_, i) => decisions[i]);
}

function scheduleRecord(
  ctx: DispatchContext,
  input: {
    toolName: string;
    tenantId: string;
    skillId: string | null;
    succeeded: boolean;
    durationMs: number;
    errorCode: number | null;
    args: unknown;
  },
): void {
  const recorder = ctx.adapters.recorder;
  if (!recorder) return;
  const task = async () => {
    try {
      await recorder.record(input);
    } catch (e) {
      // Observability never breaks the request path.
      console.error('[mcp] invocation recorder failed:', e);
    }
  };
  const afterResponse = ctx.adapters.afterResponse;
  if (afterResponse) {
    afterResponse.run(task);
  } else {
    // No deferred dispatcher wired — best-effort in-line fire-and-forget.
    // The consumer accepted this trade-off by omitting `afterResponse`.
    void task();
  }
}

// Re-export for consumers that need the constant.
export { SKILL_RESOLVING_TOOLS };
