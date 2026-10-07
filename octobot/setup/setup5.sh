#!/usr/bin/env bash
set -euo pipefail

SETUP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SETUP_DIR/lib.sh"

step="setup5"
if [[ ! -f "$ENV_FILE" ]]; then
  die "$step: backend/.env is missing. Run setup2.sh first."
fi

echo "$step: starting backend and frontend. Broadcast and support-list workers run inside the backend process."
compose up -d backend frontend
echo "$step: backend and frontend were started."
