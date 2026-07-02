// ══════════════════════════════════════════════════════════════════════════════
// SqlPool-backed invocation recorder (J8 observability)
// ══════════════════════════════════════════════════════════════════════════════
//
// Verbatim port of mothership `src/mcp/invocation-writer.ts`, refactored to
// take a `SqlPool` port + numeric truncation limit instead of `Env`.
//
// Writes one row to `mcp_invocations` for every `tools/call`. Skill-resolving
// tools (`get_skill`, `get_trust_breakdown`, `resolve_composition`) also bump
// the existing `agent_invocation_count` aggregator on `skills` so MCP traffic
// shows up on the agent leaderboard alongside Cortex / direct-REST traffic.
//
// Wrap `recorder.record(...)` in your `AfterResponse` so it never sits on
// the request critical path. Errors are logged + swallowed.
// ══════════════════════════════════════════════════════════════════════════════

import type {
  InvocationRecorderPort,
  RecordMcpInvocationInput,
  SqlPool,
} from './types.js';
import { SKILL_RESOLVING_TOOLS } from './tools/index.js';

export interface SqlPoolInvocationRecorderOptions {
  pool: SqlPool;
  /**
   * Maximum serialized-args length (chars) written to the JSONB column.
   * Env: `MCP_INVOCATION_ARGS_MAX`. Default: 4096.
   */
  argsMaxChars?: number;
  /**
   * Optional injected logger. Defaults to `console.error`. The recorder
   * NEVER throws — it always logs + returns.
   */
  logger?: (msg: string, err: unknown) => void;
}

export function createSqlPoolInvocationRecorder(
  options: SqlPoolInvocationRecorderOptions,
): InvocationRecorderPort {
  const pool = options.pool;
  const argsMaxChars = options.argsMaxChars ?? 4096;
  const logger =
    options.logger ??
    ((msg: string, err: unknown) => {
      console.error(msg, err);
    });

  return {
    async record(input: RecordMcpInvocationInput): Promise<void> {
      const argsJson = serializeArgs(input.args, argsMaxChars);
      try {
        await pool.query(
          `INSERT INTO mcp_invocations
             (tool_name, tenant_id, skill_id, succeeded, duration_ms, error_code, args)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [
            input.toolName,
            input.tenantId,
            input.skillId,
            input.succeeded,
            Math.max(0, Math.round(input.durationMs)),
            input.errorCode,
            argsJson,
          ],
        );

        // Skill-resolving tools roll into the agent_invocation_count
        // aggregator. Only bump on success — failed lookups shouldn't
        // inflate rankings.
        if (
          input.succeeded &&
          input.skillId &&
          SKILL_RESOLVING_TOOLS.has(input.toolName)
        ) {
          await pool.query(
            `UPDATE skills SET
               agent_invocation_count = agent_invocation_count + 1,
               weekly_agent_invocation_count = weekly_agent_invocation_count + 1,
               last_used_at = NOW()
             WHERE id = $1`,
            [input.skillId],
          );
        }
      } catch (e) {
        // Observability never breaks the request path.
        logger('[mcp_invocations] write failed:', e);
      }
    },
  };
}

function serializeArgs(args: unknown, maxChars: number): string {
  try {
    const raw = JSON.stringify(args ?? null);
    if (raw.length <= maxChars) return raw;
    // Truncate as a JSON-quoted string carrying a `_truncated` marker so the
    // column stays valid JSONB and downstream queries see a clear signal.
    return JSON.stringify({
      _truncated: true,
      raw: raw.slice(0, maxChars),
    });
  } catch {
    return JSON.stringify({ _truncated: true, raw: '[unserializable]' });
  }
}
