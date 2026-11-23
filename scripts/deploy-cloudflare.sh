#!/usr/bin/env bash
# KangXi.exe One-Command Cloudflare Free Tier Deployment Script
# Designed for both humans and AI coding agents (Codex / Claude Code / etc.).
#
# Prerequisites:
#   - Logged in with Cloudflare CLI (`npx cf auth login` or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID)
#
# Usage:
#   ./scripts/deploy-cloudflare.sh
#
# After deploy, open your Windows/Android KangXi.exe client, enter the printed
# `https://<worker>.workers.dev` URL, and create your admin username & password on first login.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable && corepack prepare pnpm@12.21.0 --activate
fi

echo "[kangxi] Installing & building shared server packages..."
pnpm install --frozen-lockfile --filter @kangxi/protocol --filter @kangxi/server-core --filter @kangxi/cloudflare
pnpm --filter @kangxi/protocol build
pnpm --filter @kangxi/server-core build

echo "[kangxi] Building Cloudflare Worker bundle..."
pnpm --filter @kangxi/cloudflare build

echo "[kangxi] Deploying to Cloudflare Workers..."
pnpm --filter @kangxi/cloudflare deploy

echo ""
echo "=========================================================="
echo "  KangXi.exe Cloudflare Backend Deployed!"
echo "=========================================================="
echo "  Next step:"
echo "  1. Copy your deployed https://<worker>.workers.dev URL."
echo "  2. Open KangXi.exe on Windows or Android."
echo "  3. Enter the URL + desired Username & Password to sign in."
echo "     (Schema auto-initializes automatically on first request.)"
echo "=========================================================="
