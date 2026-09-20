#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# Compose + air-gap smoke — CI entrypoint (also runnable locally).
# ══════════════════════════════════════════════════════════════════════════════
#
# Boots the local stack from apps/local and runs smoke-airgap.sh.
# On failure, dumps `docker compose ps` + logs so the GitHub Actions log
# shows why (app crash, ollama-init pull, Postgres, search/embedder, …).
#
# Expects (CI provides these; locals can omit most):
#   OLLAMA_CACHE_DIR     Absolute host dir for the Ollama model volume
#                        (default: <apps/local>/.ci-ollama-models)
#   COMPOSE_WAIT_TIMEOUT Seconds for `docker compose up --wait` (default 2400)
#   BASE_URL / HEALTH_TIMEOUT / CURL_MAX_TIME  forwarded to smoke-airgap.sh
#   KEEP_STACK=1         Skip `compose down` on exit (local debugging)
#
# Image: prefers a pre-loaded `skillsregistry-local:ci` (what CI builds with
# buildx + GHA cache). If that tag is missing, builds via compose.
# ══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ci.yml)
export OLLAMA_CACHE_DIR="${OLLAMA_CACHE_DIR:-$ROOT/.ci-ollama-models}"
mkdir -p "$OLLAMA_CACHE_DIR"

if [ ! -f .env ]; then
  ./scripts/ci-write-env.sh
fi

cleanup() {
  "${COMPOSE[@]}" down -v --remove-orphans || true
}
if [ "${KEEP_STACK:-}" != "1" ]; then
  trap cleanup EXIT
fi

dump_logs() {
  echo "::group::docker compose ps -a"
  "${COMPOSE[@]}" ps -a || true
  echo "::endgroup::"
  echo "::group::docker compose logs"
  "${COMPOSE[@]}" logs --no-color --timestamps || true
  echo "::endgroup::"
}

if ! docker image inspect skillsregistry-local:ci >/dev/null 2>&1; then
  echo "skillsregistry-local:ci not loaded; building via compose"
  "${COMPOSE[@]}" build app
fi

# postgres + ollama (and ollama-init, same image) are Docker Hub pulls.
# Retry a Docker Hub blip; do not `compose pull` the app service — that
# tag is local-only (`skillsregistry-local:ci`, never pushed).
echo "pulling postgres + ollama images..."
pull_ok=0
for attempt in 1 2 3; do
  if docker pull pgvector/pgvector:pg16 && docker pull ollama/ollama:latest; then
    pull_ok=1
    break
  fi
  echo "image pull failed (attempt ${attempt}/3); retrying..."
  sleep $((attempt * 8))
done
if [ "$pull_ok" -ne 1 ]; then
  echo "failed to pull postgres/ollama after 3 attempts"
  dump_logs
  exit 1
fi

wait_timeout="${COMPOSE_WAIT_TIMEOUT:-2400}"
# Do not `up --wait` the whole project: ollama-init is a one-shot and exits
# after the model pull, which makes a stack-wide --wait fail. Sequence:
#   1. postgres + ollama (detached)
#   2. ollama-init (foreground, abort when it exits — success or pull error)
#   3. app --wait (healthcheck on /v1/health)
echo "starting postgres + ollama"
if ! "${COMPOSE[@]}" up -d --no-build postgres ollama; then
  echo "failed to start postgres/ollama"
  dump_logs
  exit 1
fi

echo "warming embedding model via ollama-init (timeout ${wait_timeout}s)"
run_ollama_init() {
  "${COMPOSE[@]}" up --no-build --abort-on-container-exit ollama-init
}
if command -v timeout >/dev/null 2>&1; then
  if ! timeout "$wait_timeout" "${COMPOSE[@]}" up --no-build --abort-on-container-exit ollama-init; then
    echo "ollama-init failed or timed out (model pull / ollama unreachable)"
    dump_logs
    exit 1
  fi
elif ! run_ollama_init; then
  echo "ollama-init failed (model pull / ollama unreachable)"
  dump_logs
  exit 1
fi

app_wait_args=(-d --no-build --wait)
if docker compose up --help 2>/dev/null | grep -q -- '--wait-timeout'; then
  app_wait_args+=(--wait-timeout 180)
fi
echo "starting app and waiting for /v1/health"
if ! "${COMPOSE[@]}" up "${app_wait_args[@]}" app; then
  echo "app failed to become healthy"
  dump_logs
  exit 1
fi

export BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
export HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"

if ! ./scripts/smoke-airgap.sh; then
  echo "air-gap smoke failed"
  dump_logs
  exit 1
fi
