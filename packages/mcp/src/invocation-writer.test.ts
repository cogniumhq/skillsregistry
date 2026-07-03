// ══════════════════════════════════════════════════════════════════════════════
// createSqlPoolInvocationRecorder — MCP observability writer
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import { createSqlPoolInvocationRecorder } from './invocation-writer.js';
import { SKILL_RESOLVING_TOOLS } from './tools/index.js';
import type { SqlPool } from './types.js';

interface Call {
  sql: string;
  params?: unknown[];
}

function scriptedPool(opts: { throwOn?: number; error?: unknown } = {}) {
  const calls: Call[] = [];
  let idx = 0;
  const pool = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      const current = idx++;
      if (opts.throwOn !== undefined && current === opts.throwOn) {
        throw opts.error ?? new Error('boom');
      }
      return { rows: [], rowCount: 0 };
    }),
    connect: vi.fn(),
  } as unknown as SqlPool;
  return { pool, calls };
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    toolName: 'get_skill',
    tenantId: 'tenant_a',
    skillId: 'sk_1',
    succeeded: true,
    durationMs: 42,
    errorCode: null,
    args: { slug: 'a' },
    ...overrides,
  } as never;
}

// ──────────────────────────────────────────────────────────────────────────────
// mcp_invocations INSERT shape
// ──────────────────────────────────────────────────────────────────────────────

describe('createSqlPoolInvocationRecorder — mcp_invocations INSERT', () => {
  it('inserts row with 7 params: tool, tenant, skill, succeeded, duration, errorCode, args', async () => {
    const { pool, calls } = scriptedPool();
    const recorder = createSqlPoolInvocationRecorder({ pool });
    await recorder.record(baseInput());
    expect(calls[0]!.sql).toContain('INSERT INTO mcp_invocations');
    expect(calls[0]!.sql).toContain(
      '(tool_name, tenant_id, skill_id, succeeded, duration_ms, error_code, args)',
    );
    expect(calls[0]!.sql).toContain('$7::jsonb');
    const params = calls[0]!.params!;
    expect(params[0]).toBe('get_skill');
    expect(params[1]).toBe('tenant_a');
    expect(params[2]).toBe('sk_1');
    expect(params[3]).toBe(true);
    expect(params[4]).toBe(42);
    expect(params[5]).toBe(null);
    expect(params[6]).toBe(JSON.stringify({ slug: 'a' }));
  });

  it('floors durationMs at 0 for negative input', async () => {
    const { pool, calls } = scriptedPool();
    const recorder = createSqlPoolInvocationRecorder({ pool });
    await recorder.record(baseInput({ durationMs: -100 }));
    expect(calls[0]!.params![4]).toBe(0);
  });

  it('rounds durationMs to nearest integer', async () => {
    const { pool, calls } = scriptedPool();
    const recorder = createSqlPoolInvocationRecorder({ pool });
    await recorder.record(baseInput({ durationMs: 12.7 }));
    expect(calls[0]!.params![4]).toBe(13);
  });

  it('serializes null args as JSON "null"', async () => {
    const { pool, calls } = scriptedPool();
    const recorder = createSqlPoolInvocationRecorder({ pool });
    await recorder.record(baseInput({ args: null }));
    expect(calls[0]!.params![6]).toBe('null');
  });

  it('serializes undefined args as JSON "null" (?? null fallback)', async () => {
    const { pool, calls } = scriptedPool();
    const recorder = createSqlPoolInvocationRecorder({ pool });
    await recorder.record(baseInput({ args: undefined }));
    expect(calls[0]!.params![6]).toBe('null');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// argsMaxChars truncation
// ──────────────────────────────────────────────────────────────────────────────

describe('createSqlPoolInvocationRecorder — args truncation', () => {
  it('leaves args untouched when under argsMaxChars', async () => {
    const { pool, calls } = scriptedPool();
    const recorder = createSqlPoolInvocationRecorder({ pool, argsMaxChars: 100 });
    await recorder.record(baseInput({ args: { s: 'small' } }));
    expect(calls[0]!.params![6]).toBe(JSON.stringify({ s: 'small' }));
  });

  it('emits {_truncated:true, raw:slice} marker when args exceed argsMaxChars', async () => {
    const bigString = 'x'.repeat(2000);
    const { pool, calls } = scriptedPool();
    const recorder = createSqlPoolInvocationRecorder({ pool, argsMaxChars: 200 });
    await recorder.record(baseInput({ args: { blob: bigString } }));
    const written = JSON.parse(calls[0]!.params![6] as string) as {
      _truncated: boolean;
      raw: string;
    };
    expect(written._truncated).toBe(true);
    // Slice length must be exactly argsMaxChars characters of the raw JSON
    expect(written.raw.length).toBe(200);
    expect(written.raw.startsWith('{"blob":"xxx')).toBe(true);
  });

  it('defaults argsMaxChars to 4096 when omitted', async () => {
    const bigString = 'x'.repeat(5000);
    const { pool, calls } = scriptedPool();
    const recorder = createSqlPoolInvocationRecorder({ pool });
    await recorder.record(baseInput({ args: { blob: bigString } }));
    const written = JSON.parse(calls[0]!.params![6] as string) as {
      _truncated: boolean;
      raw: string;
    };
    expect(written._truncated).toBe(true);
    expect(written.raw.length).toBe(4096);
  });

  it('falls back to unserializable marker on JSON.stringify failure', async () => {
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc; // circular
    const { pool, calls } = scriptedPool();
    const recorder = createSqlPoolInvocationRecorder({ pool });
    await recorder.record(baseInput({ args: cyc }));
    const written = JSON.parse(calls[0]!.params![6] as string) as {
      _truncated: boolean;
      raw: string;
    };
    expect(written._truncated).toBe(true);
    expect(written.raw).toBe('[unserializable]');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// skills counter bump — only for SKILL_RESOLVING_TOOLS on success
// ──────────────────────────────────────────────────────────────────────────────

describe('createSqlPoolInvocationRecorder — skills counter bump', () => {
  const RESOLVING = Array.from(SKILL_RESOLVING_TOOLS);
  const NON_RESOLVING = ['search_skills', 'list_leaderboard'];

  it.each(RESOLVING)('bumps agent_invocation_count for %s on success', async (tool) => {
    const { pool, calls } = scriptedPool();
    const recorder = createSqlPoolInvocationRecorder({ pool });
    await recorder.record(baseInput({ toolName: tool }));
    expect(calls).toHaveLength(2);
    expect(calls[1]!.sql).toContain('UPDATE skills SET');
    expect(calls[1]!.sql).toContain('agent_invocation_count = agent_invocation_count + 1');
    expect(calls[1]!.sql).toContain(
      'weekly_agent_invocation_count = weekly_agent_invocation_count + 1',
    );
    expect(calls[1]!.sql).toContain('last_used_at = NOW()');
    expect(calls[1]!.sql).toContain('WHERE id = $1');
    expect(calls[1]!.params).toEqual(['sk_1']);
  });

  it.each(NON_RESOLVING)('does NOT bump for non-resolving tool %s', async (tool) => {
    const { pool, calls } = scriptedPool();
    const recorder = createSqlPoolInvocationRecorder({ pool });
    await recorder.record(baseInput({ toolName: tool }));
    expect(calls).toHaveLength(1); // only mcp_invocations INSERT
  });

  it('does NOT bump on failure (succeeded=false)', async () => {
    const { pool, calls } = scriptedPool();
    const recorder = createSqlPoolInvocationRecorder({ pool });
    await recorder.record(baseInput({ succeeded: false, errorCode: -32602 }));
    expect(calls).toHaveLength(1);
  });

  it('does NOT bump when skillId is null', async () => {
    const { pool, calls } = scriptedPool();
    const recorder = createSqlPoolInvocationRecorder({ pool });
    await recorder.record(baseInput({ skillId: null }));
    expect(calls).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Error swallow — recorder NEVER throws
// ──────────────────────────────────────────────────────────────────────────────

describe('createSqlPoolInvocationRecorder — error swallow', () => {
  it('logs + swallows when mcp_invocations INSERT fails', async () => {
    const { pool } = scriptedPool({ throwOn: 0, error: new Error('db-down') });
    const logged: Array<{ msg: string; err: unknown }> = [];
    const recorder = createSqlPoolInvocationRecorder({
      pool,
      logger: (msg, err) => logged.push({ msg, err }),
    });
    await expect(recorder.record(baseInput())).resolves.toBeUndefined();
    expect(logged).toHaveLength(1);
    expect(logged[0]!.msg).toContain('[mcp_invocations] write failed');
    expect((logged[0]!.err as Error).message).toBe('db-down');
  });

  it('logs + swallows when skills UPDATE fails', async () => {
    const { pool } = scriptedPool({ throwOn: 1, error: new Error('boom') });
    const logged: Array<{ msg: string; err: unknown }> = [];
    const recorder = createSqlPoolInvocationRecorder({
      pool,
      logger: (msg, err) => logged.push({ msg, err }),
    });
    await expect(recorder.record(baseInput())).resolves.toBeUndefined();
    expect(logged).toHaveLength(1);
  });

  it('defaults to console.error when no logger is injected', async () => {
    const { pool } = scriptedPool({ throwOn: 0, error: new Error('boom') });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const recorder = createSqlPoolInvocationRecorder({ pool });
    await recorder.record(baseInput());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toContain('[mcp_invocations] write failed');
    spy.mockRestore();
  });
});
