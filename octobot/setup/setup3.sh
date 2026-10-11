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

require_postgres_16 "$step"

echo "$step: starting Postgres and Redis."
compose up -d postgres redis

if wait_healthy 120 postgres redis; then
  echo "$step: Postgres and Redis are healthy."
  exit 0
fi

die "$step: Postgres or Redis did not become healthy. Check: docker compose --env-file backend/.env logs postgres redis"
