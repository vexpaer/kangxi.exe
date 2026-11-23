#!/usr/bin/env bash
# KangXi.exe One-Command Server Deployment Script (Docker or Node 22.5+/24)
# Designed for both humans and AI coding agents (Codex / Claude Code / etc.).
#
# Usage:
#   KANGXI_USERNAME=admin KANGXI_PASSWORD='YourStrongPassword!' ./scripts/deploy-server.sh
#
# Optional env vars:
#   KANGXI_PORT=8787                 # Listening port (default: 8787)
#   KANGXI_DOMAIN=kangxi.example.com # Enable automatic HTTPS via Caddy (Docker mode)
#   KANGXI_MODE=auto|docker|node     # Force Docker or bare Node mode (default: auto)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

KANGXI_USERNAME="${KANGXI_USERNAME:-admin}"
KANGXI_PORT="${KANGXI_PORT:-8787}"
KANGXI_OWNER_NAME="${KANGXI_OWNER_NAME:-$KANGXI_USERNAME}"
KANGXI_MODE="${KANGXI_MODE:-auto}"

if [ -z "${KANGXI_PASSWORD:-}" ]; then
  if [ -f .env ] && grep -q '^KANGXI_PASSWORD=' .env; then
    KANGXI_PASSWORD="$(grep '^KANGXI_PASSWORD=' .env | head -n1 | cut -d'=' -f2-)"
  fi
fi

if [ -z "${KANGXI_PASSWORD:-}" ] || [ "${KANGXI_PASSWORD}" = "change-me-strong-password" ]; then
  if command -v openssl >/dev/null 2>&1; then
    KANGXI_PASSWORD="$(openssl rand -base64 16 | tr -d '/+=' | head -c 18)"
  else
    KANGXI_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -d '/+=\n' | head -c 18)"
  fi
  GENERATED_PASSWORD=1
else
  GENERATED_PASSWORD=0
fi

cat > .env <<EOF
KANGXI_PORT=${KANGXI_PORT}
KANGXI_USERNAME=${KANGXI_USERNAME}
KANGXI_PASSWORD=${KANGXI_PASSWORD}
KANGXI_OWNER_NAME=${KANGXI_OWNER_NAME}
EOF
chmod 600 .env 2>/dev/null || true

USE_DOCKER=0
if [ "$KANGXI_MODE" = "docker" ]; then
  USE_DOCKER=1
elif [ "$KANGXI_MODE" = "auto" ] && command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  USE_DOCKER=1
fi

if [ "$USE_DOCKER" = "1" ]; then
  echo "[kangxi] Deploying via Docker Compose..."
  if [ -n "${KANGXI_DOMAIN:-}" ]; then
    KANGXI_DOMAIN="$KANGXI_DOMAIN" docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d --build
    PUBLIC_URL="https://${KANGXI_DOMAIN}"
  else
    docker compose up -d --build
    PUBLIC_URL="http://<SERVER_IP>:${KANGXI_PORT}"
  fi
else
  echo "[kangxi] Deploying via bare Node.js..."
  if ! command -v node >/dev/null 2>&1; then
    echo "[kangxi] ERROR: Neither Docker nor Node.js (>=22.5) found." >&2
    exit 1
  fi
  if ! command -v pnpm >/dev/null 2>&1; then
    corepack enable && corepack prepare pnpm@12.21.0 --activate
  fi
  pnpm install --frozen-lockfile --filter @kangxi/protocol --filter @kangxi/server-core --filter @kangxi/server
  pnpm --filter @kangxi/protocol build
  pnpm --filter @kangxi/server-core build
  pnpm --filter @kangxi/server build
  mkdir -p data
  nohup env PORT="$KANGXI_PORT" HOST="0.0.0.0" KANGXI_DATA_DIR="$ROOT_DIR/data" \
    KANGXI_USERNAME="$KANGXI_USERNAME" KANGXI_PASSWORD="$KANGXI_PASSWORD" KANGXI_OWNER_NAME="$KANGXI_OWNER_NAME" \
    node services/server/dist/cli.js > data/kangxi-server.log 2>&1 &
  echo $! > data/kangxi-server.pid
  PUBLIC_URL="http://<SERVER_IP>:${KANGXI_PORT}"
fi

echo "[kangxi] Waiting for health check on http://127.0.0.1:${KANGXI_PORT}/health ..."
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${KANGXI_PORT}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

HEALTH="$(curl -fsS "http://127.0.0.1:${KANGXI_PORT}/health")"
echo "[kangxi] Health OK: ${HEALTH}"
echo ""
echo "=========================================================="
echo "  KangXi.exe Backend Deployed Successfully"
echo "=========================================================="
echo "  Server URL : ${PUBLIC_URL}"
echo "  Username   : ${KANGXI_USERNAME}"
if [ "$GENERATED_PASSWORD" = "1" ]; then
  echo "  Password   : ${KANGXI_PASSWORD}  (auto-generated; saved in .env)"
else
  echo "  Password   : (the KANGXI_PASSWORD you provided)"
fi
echo "=========================================================="
