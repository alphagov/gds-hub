#!/bin/sh
# Starts Claude in the GDS sandbox with .sbx/hub-dev. See README.md.
# Usage: .sbx/claude-sandbox.sh [--recreate] [NAME]
set -eu

KIT="git+ssh://git@github.com/alphagov/gds-claude-sbx-kit.git#ref=latest"

recreate=false
if [ "${1:-}" = "--recreate" ]; then
  recreate=true
  shift
fi
name="${1:-hub-dev}"

root=$(cd "$(dirname "$0")/.." && pwd)

if [ "$(docker compose -f "$root/docker-compose.yml" ps db --format '{{.Health}}' 2>/dev/null)" != "healthy" ]; then
  echo "Warning: the database isn't running. Start it with: docker compose up -d db" >&2
fi

if $recreate; then
  sbx rm -f "$name" 2>/dev/null || true
fi

# DATABASE_URL from the environment or .env overrides the mixin's default. The
# file is read, not sourced, so nothing in it is executed.
database_url="${DATABASE_URL:-}"
if [ -z "$database_url" ] && [ -f "$root/.env" ]; then
  database_url=$(sed -n 's/^DATABASE_URL=//p' "$root/.env" | tail -n 1 | sed "s/^[\"']//; s/[\"']\$//")
fi

db_args=""
if [ -n "$database_url" ]; then
  # The sandbox relays this port, so it must be the host's Postgres port.
  db_port=$(printf '%s' "$database_url" | sed -n 's|^[a-z]*://[^/@]*@[^/:]*:\([0-9][0-9]*\).*|\1|p')
  db_args="--kit-arg database_url=$database_url"
  [ -n "$db_port" ] && db_args="$db_args --kit-arg db_port=$db_port"
fi

if ! sbx inspect "$name" >/dev/null 2>&1; then
  # shellcheck disable=SC2086 # db_args is deliberately split into arguments.
  sbx create --name "$name" "$KIT" "$root" \
    --kit "$root/.sbx/hub-dev" --kit-arg workspace="$root" $db_args
fi

# The base kit allows npm at runtime. Block it here, not in the mixin, where
# sbx 0.54.0 would also block npm ci.
sbx policy deny network --sandbox "$name" registry.npmjs.org

exec sbx run --name "$name"
