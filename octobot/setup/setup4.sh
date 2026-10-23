#!/usr/bin/env bash
set -euo pipefail

SETUP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SETUP_DIR/lib.sh"

step="setup4"
if [[ ! -f "$ENV_FILE" ]]; then
  die "$step: backend/.env is missing. Run setup2.sh and restore the file if a database volume already exists."
fi

echo "$step: applying application Prisma migrations inside the Compose network."
echo "$step: lab migrations in backend/prisma-lab are not applied by this command."
compose run --rm backend pnpm exec prisma migrate deploy
echo "$step: application migrations applied. Existing data was not reset."
