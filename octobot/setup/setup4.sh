#!/usr/bin/env bash
set -euo pipefail

SETUP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SETUP_DIR/lib.sh"

step="setup4"
if [[ ! -f "$ENV_FILE" ]]; then
  die "$step: backend/.env is missing. Run setup2.sh and restore the file if a database volume already exists."
fi

echo "$step: applying Prisma migrations inside the Compose network."
compose run --rm backend pnpm exec prisma migrate deploy
echo "$step: migrations applied. Existing data was not reset."
