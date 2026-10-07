#!/usr/bin/env bash
# Shared paths for setup1.sh–setup6.sh. Source this file; do not execute it.
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

postgres_volume_name() {
  compose config | awk '
    $0 ~ /^  postgres_data:$/ { found = 1; next }
    found && $1 == "name:" { print $2; exit }
    found && $0 ~ /^  [^ ]/ { exit }
  '
}
