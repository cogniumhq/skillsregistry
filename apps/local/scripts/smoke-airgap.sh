#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# SkillsRegistry Local — air-gap smoke test (T-2.18).
# ══════════════════════════════════════════════════════════════════════════════
#
# Verifies the "MOTHERSHIP_URL unset" posture end-to-end against a running
# node:
#   1. GET  /v1/health              → 200, upstreamConfigured=false, dbReachable=true
#   2. GET  /v1/search?q=<term>     → 200, `results` array present
#   3. POST /mcp {tools/list}       → 200, 5 tools advertised
#   4. POST /v1/skills               → 201, `id` present
#   5. POST /v1/trust/score          → 503, `error.code = upstream_not_configured`
#
# Design:
#   - Bash + curl + jq (no Node deps). Meant to run against a live container:
#       `cd apps/local && docker compose up -d && ./scripts/smoke-airgap.sh`
#     or against a locally-running `pnpm --filter @skillsregistry/local start`.
#   - Idempotent: uses a unique slug per run so re-running against the same
#     Postgres doesn't collide on unique constraints.
#   - Verbose on failure (dumps the offending response body), quiet on success.
#   - Fail-fast: first hard assertion failure aborts with a non-zero exit.
#
# Env:
#   BASE_URL          Base URL of the node under test (default http://localhost:3000)
#   HEALTH_TIMEOUT    Seconds to wait for /v1/health = 200 (default 60)
#   SMOKE_SLUG        Override the generated slug (default: airgap-smoke-<epoch>)
#
# ══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"
SMOKE_SLUG="${SMOKE_SLUG:-airgap-smoke-$(date +%s)}"

# ── output helpers ───────────────────────────────────────────────────────────
green() { printf '\033[0;32m%s\033[0m' "$1"; }
red()   { printf '\033[0;31m%s\033[0m' "$1"; }
yellow(){ printf '\033[0;33m%s\033[0m' "$1"; }
step()  { printf '  %s %s\n' "$(yellow "▸")" "$1"; }
pass()  { printf '  %s %s\n' "$(green "✔")" "$1"; }
fail()  { printf '  %s %s\n' "$(red   "✖")" "$1"; }

die() {
  fail "$1"
  if [ -n "${2:-}" ]; then
    printf '    response body:\n%s\n' "$2" | sed 's/^/    /'
  fi
  exit 1
}

# ── preflight ────────────────────────────────────────────────────────────────
command -v curl >/dev/null 2>&1 || { fail "curl not installed"; exit 127; }
command -v jq   >/dev/null 2>&1 || { fail "jq not installed";   exit 127; }

printf '\n%s\n' "$(yellow "═══ SkillsRegistry Local — air-gap smoke ═══")"
printf '  BASE_URL=%s  slug=%s\n\n' "$BASE_URL" "$SMOKE_SLUG"

# ── 0. wait for /v1/health ────────────────────────────────────────────────────
step "waiting for $BASE_URL/v1/health (up to ${HEALTH_TIMEOUT}s)..."
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
while :; do
  if body=$(curl -sf "$BASE_URL/v1/health" 2>/dev/null); then
    break
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    die "health endpoint did not return 200 within ${HEALTH_TIMEOUT}s"
  fi
  sleep 1
done
pass "health endpoint reachable"

# ── 1. /v1/health — assert air-gap posture ───────────────────────────────────
step "GET /v1/health → upstreamConfigured=false, dbReachable=true"
upstream=$(echo "$body" | jq -r '.upstreamConfigured')
dbreach=$( echo "$body" | jq -r '.dbReachable')
status=$(  echo "$body" | jq -r '.status')
[ "$upstream" = "false" ] || die "expected upstreamConfigured=false, got $upstream" "$body"
[ "$dbreach"  = "true"  ] || die "expected dbReachable=true, got $dbreach"          "$body"
[ "$status"   = "ok"    ] || die "expected status=ok, got $status"                   "$body"
pass "/v1/health OK (air-gap posture confirmed)"

# ── 2. /v1/search — 200 with skills array ────────────────────────────────────
step "GET /v1/search?q=example → 200 with .skills[]"
body=$(curl -sf "$BASE_URL/v1/search?q=example&limit=5") \
  || die "search endpoint did not return 200"
echo "$body" | jq -e '.skills | type == "array"' >/dev/null \
  || die "expected .skills to be an array" "$body"
pass "/v1/search returned .skills[]"

# ── 3. POST /mcp — tools/list advertises 5 tools ─────────────────────────────
step "POST /mcp {tools/list} → 200 with 5 tools"
body=$(curl -sf -X POST "$BASE_URL/mcp" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}') \
  || die "MCP dispatch did not return 200"
tool_count=$(echo "$body" | jq '.result.tools | length')
[ "$tool_count" = "5" ] || die "expected 5 tools, got $tool_count" "$body"
echo "$body" | jq -e '.result.tools | map(.name) | contains(["search_skills","get_skill","list_leaderboard","get_trust_breakdown","resolve_composition"])' >/dev/null \
  || die "expected the 5 canonical MCP tool names" "$body"
pass "/mcp advertised all 5 tools"

# ── 4. POST /v1/skills — publish a local skill ───────────────────────────────
step "POST /v1/skills → 201 with .id"
publish_body=$(cat <<JSON
{
  "manifest": {
    "name": "Airgap Smoke",
    "slug": "$SMOKE_SLUG",
    "version": "1.0.0",
    "source": "local",
    "execution_layer": "node",
    "description": "Smoke-test skill; safe to delete.",
    "agent_summary": "Air-gap smoke fixture."
  }
}
JSON
)
body=$(curl -sf -X POST "$BASE_URL/v1/skills" \
  -H 'Content-Type: application/json' \
  -d "$publish_body") \
  || die "publish endpoint did not return 2xx"
id=$(echo "$body" | jq -r '.id // empty')
[ -n "$id" ] || die "expected .id in publish response" "$body"
pass "/v1/skills published id=$id"

# ── 5. POST /v1/trust/score — expect 503 upstream_not_configured ─────────────
step "POST /v1/trust/score → 503 with .error.code=upstream_not_configured"
score_body=$(cat <<JSON
{ "skill_id": "$id" }
JSON
)
# -f would swallow the 503 body; we need it, so use -w to capture status
resp=$(curl -sS -o /tmp/airgap-smoke-trust.json -w '%{http_code}' \
  -X POST "$BASE_URL/v1/trust/score" \
  -H 'Content-Type: application/json' \
  -d "$score_body")
body=$(cat /tmp/airgap-smoke-trust.json)
[ "$resp" = "503" ] || die "expected HTTP 503, got $resp" "$body"
code=$(echo "$body" | jq -r '.error.code // empty')
[ "$code" = "upstream_not_configured" ] \
  || die "expected .error.code=upstream_not_configured, got '$code'" "$body"
pass "/v1/trust/score correctly refused with upstream_not_configured"
rm -f /tmp/airgap-smoke-trust.json

printf '\n  %s %s\n\n' "$(green "✓")" "air-gap smoke passed — all 5 checks green"
