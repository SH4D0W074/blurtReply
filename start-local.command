#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"

# Prefer an installed Node runtime, with the desktop app's bundled runtime as a fallback.
if ! command -v node >/dev/null 2>&1; then
  vivacoach_runtime="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies"
  if [ -x "$vivacoach_runtime/node/bin/node" ]; then
    export PATH="$vivacoach_runtime/node/bin:$vivacoach_runtime/bin/fallback:$PATH"
  fi
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 24 or newer, then open this launcher again."
  exit 1
fi
if [ ! -x node_modules/.bin/tsx ]; then
  echo "Install the project dependencies with pnpm install first."
  exit 1
fi
if [ ! -f .env.local ]; then
  cp .env.example .env.local
fi
echo "Starting VivaCoach. Open http://localhost:3000 when the server is ready."
exec ./node_modules/.bin/tsx server/index.ts
