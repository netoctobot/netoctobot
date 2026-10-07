#!/usr/bin/env bash
set -euo pipefail

SETUP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SETUP_DIR/lib.sh"

step="setup2"

env_value() {
  local key="$1"
  local line value
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 1
  fi
  value="${line#*=}"
  if [[ "$value" == \"*\" ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

database_host() {
  local url="$1"
  local rest="${url##*@}"
  rest="${rest%%/*}"
  printf '%s' "${rest%%:*}"
}

volume_present() {
  local names
  if ! names="$(docker volume ls --format '{{.Name}}')"; then
    die "$step: docker volume ls failed. Run setup1.sh before setup2.sh."
  fi
  grep -Eq '(^|_)postgres_data$' <<<"$names"
}

write_env() {
  if ! command -v openssl >/dev/null 2>&1; then
    echo "$step: missing openssl, needed to generate the database password and encryption key." >&2
    echo "  sudo apt-get install -y openssl" >&2
    exit 1
  fi
  local password key secret
  password="$(openssl rand -hex 24)"
  key="$(openssl rand -hex 32)"
  secret="$(openssl rand -hex 32)"
  umask 077
  cat >"$ENV_FILE" <<EOF
# Hostnames postgres and redis resolve inside Docker Compose.
# A process on the host uses 127.0.0.1 and the published ports instead.
DATABASE_URL="postgresql://octobot:${password}@postgres:5432/octobot"
REDIS_URL="redis://redis:6379"
BOT_TOKEN="replace-with-platform-bot-token"
OWNER_TELEGRAM_ID="replace-me"
ENCRYPTION_KEY="${key}"
WEBHOOK_SECRET="${secret}"
PUBLIC_BASE_URL="http://localhost:3000"
WEBHOOK_REGISTRATION_ENABLED="false"
PORT=3000
# Leave NODE_ENV unset until the dashboard account exists.
# NODE_ENV=production ignores LOCAL_ADMIN_* and does not reset a saved password.
LOCAL_ADMIN_USERNAME=
LOCAL_ADMIN_PASSWORD=
POSTGRES_USER=octobot
POSTGRES_PASSWORD="${password}"
POSTGRES_DB=octobot
EOF
  chmod 600 "$ENV_FILE"
}

validate_env() {
  local key value host
  local -a pending=()
  local -a required=(
    DATABASE_URL
    REDIS_URL
    BOT_TOKEN
    OWNER_TELEGRAM_ID
    ENCRYPTION_KEY
    WEBHOOK_SECRET
    PUBLIC_BASE_URL
    POSTGRES_USER
    POSTGRES_PASSWORD
    POSTGRES_DB
  )
  for key in "${required[@]}"; do
    if ! value="$(env_value "$key")"; then
      pending+=("$key")
      continue
    fi
    if [[ -z "$value" || "$value" == *replace-me* || "$value" == *replace-with* ]]; then
      pending+=("$key")
      continue
    fi
    if [[ "$key" == "ENCRYPTION_KEY" && "$value" =~ ^0{64}$ ]]; then
      pending+=("$key")
    fi
  done
  if ((${#pending[@]} > 0)); then
    echo "$step: fill these keys in backend/.env, then run setup2.sh again: ${pending[*]}." >&2
    echo "Values were not printed." >&2
    exit 1
  fi
  host="$(database_host "$(env_value DATABASE_URL)")"
  echo "$step: backend/.env is present. DATABASE_URL host: ${host}."
}

if [[ -f "$ENV_FILE" ]]; then
  validate_env
  exit 0
fi

if volume_present; then
  die "$step: a postgres_data volume already exists and backend/.env is missing. Restore that file. A new password would not match the saved data."
fi

write_env
echo "$step: created backend/.env with mode 600. The generated password and keys were not printed."
validate_env
