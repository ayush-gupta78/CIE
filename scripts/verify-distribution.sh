#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm dist:pack
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
version=$(node -p 'require("./package.json").version')
tar -xzf "release/cie-${version}-rc.local.tar.gz" -C "$scratch"
(cd "$scratch" && pnpm install --prod --frozen-lockfile && pnpm smoke:production)
rm "$scratch/apps/web/dist/index.html"
if (cd "$scratch" && node apps/server/dist/main.js --production >/dev/null 2>&1); then
  printf 'Missing web build unexpectedly started\n' >&2
  exit 1
fi
