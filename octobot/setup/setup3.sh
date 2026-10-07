#!/usr/bin/env bash
set -euo pipefail

SETUP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SETUP_DIR/lib.sh"

step="setup3"
bash "$SETUP_DIR/setup2.sh"

echo "$step: building images and pulling Postgres 16 and Redis 7."
compose build
compose pull postgres redis

volume="$(postgres_volume_name || true)"
if [[ -z "$volume" ]]; then
  die "$step: could not read the postgres_data volume name from Compose."
fi

if docker volume inspect "$volume" >/dev/null 2>&1; then
  echo "$step: checking PostgreSQL major version in volume ${volume}."
  set +e
  version="$(
    docker run --rm --entrypoint sh \
      -v "${volume}:/pg:ro" \
      postgres:16 \
      -c 'if [ -f /pg/PG_VERSION ]; then cat /pg/PG_VERSION; else echo MISSING; fi'
  )"
  version_status=$?
  set -e
  if ((version_status != 0)); then
    die "$step: could not read PG_VERSION from ${volume}. Postgres was not started."
  fi
  version="${version//$'\r'/}"
  version="${version//$'\n'/}"
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

echo "$step: starting Postgres and Redis."
compose up -d postgres redis

deadline=$((SECONDS + 120))
while ((SECONDS < deadline)); do
  postgres_id="$(compose ps -q postgres)"
  redis_id="$(compose ps -q redis)"
  postgres_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$postgres_id" 2>/dev/null || true)"
  redis_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$redis_id" 2>/dev/null || true)"
  if [[ "$postgres_health" == "healthy" && "$redis_health" == "healthy" ]]; then
    echo "$step: Postgres and Redis are healthy."
    exit 0
  fi
  sleep 2
done

die "$step: Postgres or Redis did not become healthy. Check: docker compose --env-file backend/.env logs postgres redis"
