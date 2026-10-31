#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm build
version=$(node -p 'require("./package.json").version')
mkdir -p release
artifact="release/cie-${version}-rc.local.tar.gz"
# Fixed metadata and ordering make the built-content archive reproducible on GNU tar/gzip.
tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner -cf - \
  package.json pnpm-lock.yaml pnpm-workspace.yaml \
  apps/server/package.json apps/server/dist apps/web/package.json apps/web/dist \
  scripts/smoke-production.mjs | gzip -n > "$artifact"
printf 'Created %s\n' "$artifact"
