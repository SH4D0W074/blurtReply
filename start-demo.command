#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"

if ! command -v node >/dev/null 2>&1; then
  blurt_runtime="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies"
  if [ -x "$blurt_runtime/node/bin/node" ]; then
    export PATH="$blurt_runtime/node/bin:$blurt_runtime/bin/fallback:$PATH"
  fi
fi
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
  echo "Install Node.js 24 or newer, then open this launcher again."
  exit 1
fi
if [ ! -x node_modules/.bin/tsx ]; then
  echo "Install dependencies with pnpm install --frozen-lockfile first."
  exit 1
fi
blurt_cloudflared="${BLURT_CLOUDFLARED:-}"
if [ -z "$blurt_cloudflared" ]; then
  blurt_cloudflared="$(command -v cloudflared || true)"
fi
if [ -z "$blurt_cloudflared" ] && [ -x .tools/cloudflared/cloudflared ]; then
  blurt_cloudflared="$PWD/.tools/cloudflared/cloudflared"
fi
if [ ! -x "$blurt_cloudflared" ]; then
  echo "Install cloudflared, or set BLURT_CLOUDFLARED to its executable path."
  exit 1
fi
blurt_port="${BLURT_DEMO_PORT:-4310}"
node --input-type=module - "$blurt_port" <<'JS'
import { createServer } from 'node:net';
const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Choose a valid BLURT_DEMO_PORT.');
const server = createServer();
server.on('error', () => { console.error(`Port ${port} is already in use. Stop the previous demo or choose BLURT_DEMO_PORT.`); process.exit(1); });
server.listen(port, '127.0.0.1', () => server.close());
JS

blurt_server_pid=''
blurt_tunnel_pid=''
blurt_awake_pid=''
cleanup() {
  trap - EXIT INT TERM
  [ -z "$blurt_tunnel_pid" ] || kill "$blurt_tunnel_pid" 2>/dev/null || true
  [ -z "$blurt_server_pid" ] || kill "$blurt_server_pid" 2>/dev/null || true
  [ -z "$blurt_awake_pid" ] || kill "$blurt_awake_pid" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

umask 077
mkdir -p .local
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vite build
blurt_env_file="${BLURT_DEMO_ENV_FILE:-$PWD/.env.local}"
if [ ! -f "$blurt_env_file" ]; then
  if [ -n "${BLURT_DEMO_ENV_FILE:-}" ]; then
    echo "The selected BLURT_DEMO_ENV_FILE does not exist."
    exit 1
  fi
  blurt_env_file=/dev/null
fi
NODE_ENV=production VIVACOACH_PUBLIC_DEMO=true VIVACOACH_HOST=127.0.0.1 \
  PORT="$blurt_port" VIVACOACH_DB_PATH="$PWD/.local/public-demo.sqlite" \
  node "--env-file=$blurt_env_file" --import tsx server/index.ts > .local/public-demo-server.log 2>&1 &
blurt_server_pid=$!
blurt_ready=false
for blurt_attempt in {1..50}; do
  if ! kill -0 "$blurt_server_pid" 2>/dev/null; then
    cat .local/public-demo-server.log
    exit 1
  fi
  if curl --fail --silent --noproxy '*' "http://127.0.0.1:$blurt_port/api/status" >/dev/null; then
    blurt_ready=true
    break
  fi
  sleep 0.2
done
if [ "$blurt_ready" != true ]; then
  echo "The demo server did not become ready. See .local/public-demo-server.log."
  exit 1
fi
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -i -w "$$" &
  blurt_awake_pid=$!
fi
echo "Share the HTTPS trycloudflare.com link below. Keep this window open and the laptop online."
echo "Press Control-C to stop the public demo. Saved demo sessions remain in .local/public-demo.sqlite."
"$blurt_cloudflared" tunnel --no-autoupdate --protocol http2 --url "http://127.0.0.1:$blurt_port" &
blurt_tunnel_pid=$!
wait "$blurt_tunnel_pid"
