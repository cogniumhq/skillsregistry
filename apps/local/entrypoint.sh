#!/bin/sh
# ══════════════════════════════════════════════════════════════════════════════
# SkillsRegistry Local — container entrypoint.
# ══════════════════════════════════════════════════════════════════════════════
#
# Documents the design §11 startup sequence and provides a single tunable
# ingress point for ops (extra env-var validation, pre-flight hooks, etc.).
# The heavy lifting is inside the Node process:
#
#   1. Postgres reachability  → gated upstream by `depends_on: service_healthy`
#                                in docker-compose.yml.
#   2. Migrations              → applied by `bootSchema(pool)` in src/index.ts
#                                BEFORE the HTTP server binds. Fail-fast: a
#                                schema-boot error exits non-zero and the
#                                container restarts (per compose policy).
#   3. Ollama model            → warmed by the `ollama-init` one-shot service
#                                in docker-compose.yml (blocks `app` startup
#                                via `service_completed_successfully`).
#   4. Mothership connectivity → probed by budget-meter's warm-refresh inside
#                                `buildAppServices`; failure logs a warning
#                                but does NOT block boot (air-gap is a valid
#                                deploy posture).
#   5. HTTP server             → `serve()` binds on ${HOST}:${PORT} last.
#
# Signal handling: Node handles SIGINT/SIGTERM via the shutdown handler in
# src/index.ts (drains services + pool, then process.exit(0)). `exec` below
# replaces the shell so signals reach Node as PID 1 directly.
#
# --enable-source-maps: prod stack traces reference .ts line numbers, not
# transpiled .js locations. Free win for on-call debugging.
#
# ══════════════════════════════════════════════════════════════════════════════

set -eu

echo "[entrypoint] SkillsRegistry Local booting (node=$(node --version))"
echo "[entrypoint]   step 1/5 Postgres reachability   — gated by compose service_healthy"
echo "[entrypoint]   step 2/5 Migrations              — applied by bootSchema (inline, fail-fast)"
echo "[entrypoint]   step 3/5 Ollama model            — warmed by ollama-init sidecar"
echo "[entrypoint]   step 4/5 Mothership connectivity — probed by budget-meter (non-blocking)"
echo "[entrypoint]   step 5/5 HTTP server             — serve() below"

exec node --enable-source-maps ./dist/index.js
