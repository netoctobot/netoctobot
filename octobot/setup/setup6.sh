#!/usr/bin/env bash
set -euo pipefail

SETUP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SETUP_DIR/lib.sh"

step="setup6"
if [[ ! -f "$ENV_FILE" ]]; then
  die "$step: backend/.env is missing. Run setup2.sh first."
fi

echo "$step: checking the backend health endpoint."
curl --fail --silent --show-error http://127.0.0.1:3000/health
echo

echo "$step: checking Postgres."
compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

echo "$step: checking Redis."
compose exec -T redis redis-cli ping

echo "$step: container status."
compose ps

cat <<'EOF'

Dashboard tunnel, from your own computer:
  ssh -L 3001:127.0.0.1:3001 <user>@<server>
Then open http://127.0.0.1:3001

Follow logs:
  docker compose --env-file backend/.env logs -f backend frontend

Stop the containers without deleting volumes:
  docker compose --env-file backend/.env stop

Do not use "docker compose down -v". That deletes the database and Redis volumes.
EOF
