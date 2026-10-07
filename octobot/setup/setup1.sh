#!/usr/bin/env bash
set -euo pipefail

SETUP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SETUP_DIR/lib.sh"

step="setup1"
echo "$step: checking the operating system and tools."

if [[ ! -r /etc/os-release ]]; then
  die "$step: cannot read /etc/os-release."
fi
# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != "debian" && "${ID:-}" != "ubuntu" ]]; then
  die "$step: Debian or Ubuntu is required. Detected: ${ID:-unknown} ${VERSION_ID:-}."
fi
echo "$step: ${PRETTY_NAME:-$ID}."

missing=()
for tool in bash git curl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    missing+=("$tool")
  fi
done
if ((${#missing[@]} > 0)); then
  echo "$step: missing ${missing[*]}." >&2
  echo "Install the missing command, then run setup1.sh again. Example:" >&2
  echo "  sudo apt-get update && sudo apt-get install -y ${missing[*]}" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "$step: missing docker." >&2
  echo "Docker is not installed. This script does not install it. Example:" >&2
  echo "  sudo apt-get update" >&2
  echo "  sudo apt-get install -y ca-certificates curl git docker.io docker-compose-v2" >&2
  echo "  sudo usermod -aG docker \"$USER\"" >&2
  echo "Log out and back in after joining the docker group, then run setup1.sh again." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "$step: docker is installed, but this user cannot use the daemon." >&2
  echo "Do not reinstall Docker. Grant access, then log out and back in:" >&2
  echo "  sudo usermod -aG docker \"$USER\"" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "$step: missing Docker Compose v2." >&2
  echo "Install the plugin, then run setup1.sh again:" >&2
  echo "  sudo apt-get install -y docker-compose-v2" >&2
  exit 1
fi

echo "$step: bash, git, curl, docker, and Docker Compose v2 are available."
