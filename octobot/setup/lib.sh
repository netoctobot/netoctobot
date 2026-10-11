#!/usr/bin/env bash
# Shared paths for setup1.sh–setup6.sh and update.sh. Source this file; do not execute it.
set -euo pipefail

SETUP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SETUP_DIR/.." && pwd)"
ENV_FILE="$ROOT/backend/.env"

die() {
  echo "$1" >&2
  exit 1
}

compose() {
  docker compose --env-file "$ENV_FILE" -f "$ROOT/docker-compose.yml" "$@"
}

compose_volume_name() {
  local logical="$1"
  compose config | awk -v logical="$logical" '
    $0 == "  " logical ":" { found = 1; next }
    found && $1 == "name:" { print $2; exit }
    found && $0 ~ /^  [^ ]/ { exit }
  '
}

postgres_volume_name() {
  compose_volume_name postgres_data
}

read_pg_version() {
  local volume="$1"
  local version status
  version="$(
    docker run --rm --entrypoint sh \
      -v "${volume}:/pg:ro" \
      postgres:16 \
      -c 'if [ -f /pg/PG_VERSION ]; then cat /pg/PG_VERSION; else echo MISSING; fi'
  )"
  status=$?
  if ((status != 0)); then
    return "$status"
  fi
  version="${version//$'\r'/}"
  version="${version//$'\n'/}"
  printf '%s' "$version"
}

require_postgres_16() {
  local step="$1"
  local volume version version_status major
  volume="$(postgres_volume_name || true)"
  if [[ -z "$volume" ]]; then
    die "$step: could not read the postgres_data volume name from Compose."
  fi

  if docker volume inspect "$volume" >/dev/null 2>&1; then
    echo "$step: checking PostgreSQL major version in volume ${volume}."
    set +e
    version="$(read_pg_version "$volume")"
    version_status=$?
    set -e
    if ((version_status != 0)); then
      die "$step: could not read PG_VERSION from ${volume}. Postgres was not started."
    fi
    if [[ "$version" == "MISSING" ]]; then
      echo "$step: volume ${volume} has no PG_VERSION yet. Postgres 16 may initialize it."
    else
      major="${version%%.*}"
      if [[ "$major" != "16" ]]; then
        die "$step: volume ${volume} is PostgreSQL ${version}. This Compose file stays on Postgres 16. A major upgrade is a separate plan and must preserve the data."
      fi
      echo "$step: volume ${volume} is PostgreSQL ${version}."
    fi
  else
    echo "$step: volume ${volume} is absent. Postgres 16 will create it."
  fi
}

service_health() {
  local service="$1"
  local id health
  id="$(compose ps -q "$service")"
  id="${id%%$'\n'*}"
  if [[ -z "$id" ]]; then
    printf '%s\n' "missing"
    return 0
  fi
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id" 2>/dev/null || true)"
  if [[ -z "$health" ]]; then
    printf '%s\n' "none"
    return 0
  fi
  printf '%s\n' "$health"
}

wait_healthy() {
  local timeout="$1"
  shift
  local deadline=$((SECONDS + timeout))
  local service health ready
  while ((SECONDS < deadline)); do
    ready=1
    for service in "$@"; do
      health="$(service_health "$service")"
      if [[ "$health" != "healthy" ]]; then
        ready=0
      fi
    done
    if ((ready == 1)); then
      return 0
    fi
    sleep 2
  done
  return 1
}
