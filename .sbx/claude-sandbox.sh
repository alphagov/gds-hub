#!/bin/sh
# Starts Claude in the GDS sandbox with .sbx/hub-dev. See README.md.
# Usage: .sbx/claude-sandbox.sh [--recreate] [NAME]
set -eu

KIT="git+ssh://git@github.com/alphagov/gds-claude-sbx-kit.git#ref=1.0.0"

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

if ! sbx inspect "$name" >/dev/null 2>&1; then
  sbx create --name "$name" "$KIT" "$root" \
    --kit "$root/.sbx/hub-dev" --kit-arg workspace="$root"
fi

# The base kit allows npm at runtime. Block it here, not in the mixin, where
# sbx 0.54.0 would also block npm ci.
sbx policy deny network --sandbox "$name" registry.npmjs.org

exec sbx run --name "$name"
