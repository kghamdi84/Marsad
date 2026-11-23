#!/usr/bin/env bash
# Session start: install dependencies, then prove the tree is healthy
# before any change. Usage: ./init.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "== install"
pnpm install --frozen-lockfile

echo "== typecheck"
pnpm typecheck

echo "== lint"
pnpm lint

echo "== tests"
pnpm test

echo "== init.sh: all checks passed"
