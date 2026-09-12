#!/usr/bin/env bash
# Deploy PowerBull Pro to the connected Cloudflare Workers Builds project.
# Dashboard → Settings → Builds → Deploy command:
#   bash scripts/cloudflare-deploy.sh
# (or: npx wrangler deploy)
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f dist/worker.js ]]; then
  echo "dist/worker.js missing — running build:cloudflare first"
  npm run build:cloudflare
fi
exec npx wrangler deploy
