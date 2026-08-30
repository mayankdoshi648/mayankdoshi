#!/usr/bin/env bash
# Install daily DarvaX scan cron job (7:00 AM IST, Mon–Fri)
# Usage: ./scripts/setup-cron.sh [--remove]

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CRON_TAG="# darvax-powerbull-pro"
CRON_CMD="cd ${PROJECT_DIR} && /usr/bin/env npm run darvax:scan -- --export-obsidian --telegram >> ${PROJECT_DIR}/data/darvax-cron.log 2>&1"
CRON_LINE="0 7 * * 1-5 TZ=Asia/Kolkata ${CRON_CMD} ${CRON_TAG}"

mkdir -p "${PROJECT_DIR}/data"

if [[ "${1:-}" == "--remove" ]]; then
  crontab -l 2>/dev/null | grep -v "${CRON_TAG}" | crontab - || true
  echo "Removed DarvaX cron job."
  exit 0
fi

# Ensure .env exists
if [[ ! -f "${PROJECT_DIR}/.env" ]]; then
  echo "Warning: ${PROJECT_DIR}/.env not found. Copy .env.example and fill credentials first."
fi

EXISTING="$(crontab -l 2>/dev/null | grep -v "${CRON_TAG}" || true)"
{
  echo "${EXISTING}"
  echo "${CRON_LINE}"
} | crontab -

echo "Installed DarvaX daily cron (7:00 AM IST, Mon–Fri):"
echo "  ${CRON_LINE}"
echo ""
echo "Logs: ${PROJECT_DIR}/data/darvax-cron.log"
echo "Remove: ./scripts/setup-cron.sh --remove"
