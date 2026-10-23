#!/usr/bin/env bash
# CPM measurement lab operations. Separate from setup1-6.sh and update.sh.
# Values are read from backend/.env.lab and are never printed.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

LAB_ENV_FILE="$ROOT/backend/.env.lab"
RUN_CONTAINER="octobot-cpm-lab-run"

usage() {
  cat >&2 <<'EOF'
usage: setup/lab.sh <command>

  build                 build the cpm-lab image from backend/Dockerfile.lab
  db-up                 start lab-postgres and wait until it is healthy
  migrate               apply lab migrations to LAB_DATABASE_URL only
  test-db               create the test database if missing and run the schema self check
  login-bot [--replace] store an encrypted bot session
  login-user [--replace] interactive user login (phone, code, 2FA in your terminal)
  preflight             one channel resolution and one read per reader
  run --confirm-live    start the trial in the background
  logs                  follow the trial logs
  stop                  send SIGTERM to the trial and wait up to 60 seconds
  status                lock holder, reader states, sessions, recent runs
  report [--run ID]     JSON report from the lab database rows
  mark-view [--at ISO] [--note TEXT]  record that you opened the post from another account
  clear-stop --reader bot|user        clear a stored reader stop after review
EOF
  exit 1
}

env_value() {
  local file="$1" key="$2" line value
  line="$(grep -E "^[[:space:]]*${key}=" "$file" | tail -n 1 || true)"
  value="${line#*=}"
  value="${value%$'\r'}"
  if [[ "$value" =~ ^\"(.*)\"$ ]] || [[ "$value" =~ ^\'(.*)\'$ ]]; then
    value="${BASH_REMATCH[1]}"
  fi
  printf '%s' "$value"
}

require_lab_env() {
  [[ -f "$LAB_ENV_FILE" ]] || die "lab: backend/.env.lab is missing. Copy backend/.env.lab.example and fill it in locally."
  local mode
  mode="$(stat -c '%a' "$LAB_ENV_FILE")"
  [[ "$mode" == "600" ]] || die "lab: backend/.env.lab must have mode 600 (it is ${mode}). Run: chmod 600 backend/.env.lab"
  [[ -f "$ENV_FILE" ]] || die "lab: backend/.env is missing."
  if grep -qE '^[[:space:]]*LAB_' "$ENV_FILE"; then
    die "lab: backend/.env contains LAB_* keys. Move them to backend/.env.lab so the backend service does not receive them."
  fi
}

require_distinct_keys() {
  local lab app
  lab="$(env_value "$LAB_ENV_FILE" LAB_SESSION_ENCRYPTION_KEY)"
  app="$(env_value "$ENV_FILE" ENCRYPTION_KEY)"
  [[ -n "$lab" ]] || die "lab: LAB_SESSION_ENCRYPTION_KEY is empty in backend/.env.lab."
  if [[ -n "$app" && "${lab,,}" == "${app,,}" ]]; then
    die "lab: LAB_SESSION_ENCRYPTION_KEY equals ENCRYPTION_KEY. Generate a separate key. Neither key was printed."
  fi
}

# Only scheme, host, port, and database name of the application database.
app_database_target() {
  local url
  url="$(env_value "$ENV_FILE" DATABASE_URL)"
  [[ -n "$url" ]] || die "lab: DATABASE_URL is missing in backend/.env, so the application database cannot be identified."
  url="$(printf '%s' "$url" | sed -E 's#^(postgres(ql)?://)[^@/]*@#\1#; s#\?.*$##')"
  printf '%s' "$url"
}

lab_compose() {
  LAB_APP_DATABASE_TARGET="$(app_database_target)" \
    docker compose --env-file "$ENV_FILE" --env-file "$LAB_ENV_FILE" \
    -f "$ROOT/docker-compose.yml" --profile cpm-lab "$@"
}

lab_node() {
  lab_compose run --rm -T "$@"
}

require_db_up() {
  local id health
  id="$(lab_compose ps -q lab-postgres)"
  [[ -n "$id" ]] || die "lab: lab-postgres is not running. Run setup/lab.sh db-up first."
  health="$(docker inspect -f '{{.State.Health.Status}}' "$id")"
  [[ "$health" == "healthy" ]] || die "lab: lab-postgres is ${health}. Wait for it or check: setup/lab.sh db-up"
}

require_no_trial_container() {
  if docker ps -q --filter "name=^${RUN_CONTAINER}$" | grep -q .; then
    die "lab: the trial container is running. Stop it first with setup/lab.sh stop."
  fi
}

command="${1:-}"
[[ -n "$command" ]] || usage
shift

case "$command" in
  build)
    require_lab_env
    lab_compose build cpm-lab
    ;;
  db-up)
    require_lab_env
    for key in LAB_POSTGRES_USER LAB_POSTGRES_PASSWORD LAB_POSTGRES_DB; do
      [[ -n "$(env_value "$LAB_ENV_FILE" "$key")" ]] || die "lab: ${key} is empty in backend/.env.lab."
    done
    lab_compose up -d lab-postgres
    for _ in $(seq 1 60); do
      id="$(lab_compose ps -q lab-postgres)"
      if [[ -n "$id" && "$(docker inspect -f '{{.State.Health.Status}}' "$id")" == "healthy" ]]; then
        echo "lab: lab-postgres is healthy."
        exit 0
      fi
      sleep 2
    done
    die "lab: lab-postgres did not become healthy."
    ;;
  migrate)
    require_lab_env
    require_db_up
    lab_node cpm-lab node dist/cpm-lab/prisma-cli.js migrate
    ;;
  test-db)
    require_lab_env
    require_db_up
    test_url="$(env_value "$LAB_ENV_FILE" LAB_TEST_DATABASE_URL)"
    [[ -n "$test_url" ]] || die "lab: LAB_TEST_DATABASE_URL is empty in backend/.env.lab."
    test_db="$(printf '%s' "$test_url" | sed -E 's#\?.*$##; s#^.*/##')"
    [[ "$test_db" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || die "lab: the test database name must be lowercase letters, digits, and underscores."
    [[ "$test_db" != "$(env_value "$LAB_ENV_FILE" LAB_POSTGRES_DB)" ]] || die "lab: LAB_TEST_DATABASE_URL must name a different database than LAB_POSTGRES_DB."
    # The container shell expands POSTGRES_USER and POSTGRES_DB.
    # shellcheck disable=SC2016
    exists="$(lab_compose exec -T lab-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "$1"' sh "SELECT 1 FROM pg_database WHERE datname = '${test_db}'")"
    if [[ "$exists" != "1" ]]; then
      # shellcheck disable=SC2016
      lab_compose exec -T lab-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "$1"' sh "CREATE DATABASE \"${test_db}\""
      echo "lab: created test database ${test_db} on lab-postgres."
    fi
    lab_node cpm-lab node dist/cpm-lab/main.js test-db
    ;;
  login-bot)
    require_lab_env
    require_distinct_keys
    require_db_up
    lab_node cpm-lab node dist/cpm-lab/main.js login-bot "$@"
    ;;
  login-user)
    require_lab_env
    require_distinct_keys
    require_db_up
    [[ -t 0 ]] || die "lab: login-user needs an interactive terminal."
    lab_compose run --rm cpm-lab node dist/cpm-lab/main.js login-user "$@"
    ;;
  preflight)
    require_lab_env
    require_distinct_keys
    require_db_up
    require_no_trial_container
    lab_node cpm-lab node dist/cpm-lab/main.js preflight
    ;;
  run)
    [[ "${1:-}" == "--confirm-live" ]] || die "lab: run sends live Telegram requests. Use: setup/lab.sh run --confirm-live"
    require_lab_env
    require_distinct_keys
    require_db_up
    require_no_trial_container
    docker rm "$RUN_CONTAINER" >/dev/null 2>&1 || true
    lab_compose run -d -T --name "$RUN_CONTAINER" cpm-lab node dist/cpm-lab/main.js run --confirm-live
    echo "lab: trial started in container ${RUN_CONTAINER}. Follow with setup/lab.sh logs."
    ;;
  logs)
    docker logs -f "$RUN_CONTAINER"
    ;;
  stop)
    if docker ps -q --filter "name=^${RUN_CONTAINER}$" | grep -q .; then
      docker stop -t 60 "$RUN_CONTAINER" >/dev/null
      echo "lab: trial stopped. Exit code: $(docker inspect -f '{{.State.ExitCode}}' "$RUN_CONTAINER")"
    else
      echo "lab: no trial container is running."
    fi
    ;;
  status)
    require_lab_env
    require_db_up
    docker ps -a --filter "name=^${RUN_CONTAINER}$" --format 'trial container: {{.Status}}' || true
    lab_node cpm-lab node dist/cpm-lab/main.js status
    ;;
  report)
    require_lab_env
    require_db_up
    lab_node cpm-lab node dist/cpm-lab/main.js report "$@"
    ;;
  mark-view)
    require_lab_env
    require_db_up
    lab_node cpm-lab node dist/cpm-lab/main.js mark-view "$@"
    ;;
  clear-stop)
    require_lab_env
    require_db_up
    lab_node cpm-lab node dist/cpm-lab/main.js clear-stop "$@"
    ;;
  *)
    usage
    ;;
esac
