#!/usr/bin/env bash
# Workers Builds → Deploy command should be: npm run deploy
# This script rebuilds the Worker bundle then runs wrangler deploy (never pages deploy).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Cloudflare deploy starting"
echo "    pwd=$(pwd)"
echo "    WORKERS_CI=${WORKERS_CI:-}"
echo "    CI=${CI:-}"
echo "    node=$(node -v)"

npm run build:cloudflare

if [[ ! -f dist/worker.js ]]; then
  echo "ERROR: dist/worker.js was not produced by build:cloudflare" >&2
  ls -la dist || true
  exit 1
fi

echo "==> dist/worker.js ready ($(wc -c < dist/worker.js) bytes)"
echo "==> wrangler.toml:"
sed -n '1,40p' wrangler.toml

# Prefer local wrangler from package.json (Workers Builds uses package.json version).
if [[ -x node_modules/.bin/wrangler ]]; then
  echo "==> using local wrangler $(node_modules/.bin/wrangler --version 2>/dev/null || true)"
  exec node_modules/.bin/wrangler deploy --config wrangler.toml
fi

echo "==> local wrangler missing; using npx wrangler@4"
exec npx --yes wrangler@4 deploy --config wrangler.toml
