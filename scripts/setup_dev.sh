#!/bin/bash
# Smart Sprinkler Control — development environment setup.
#
# Brings up the dockerized Home Assistant dev instance and builds the panel
# frontend bundle. Idempotent: safe to re-run. Run from anywhere — it locates
# the repo root relative to this script.
#
# What it does:
#   1. Verifies Docker is reachable (starts Colima if installed and stopped).
#   2. `docker compose -f docker-compose.dev.yml up -d`  (container ha-sprinkler-dev)
#   3. Builds the panel: npm install + npm run build in the frontend dir.
#   4. Prints the panel URL.

set -euo pipefail

# Resolve repo root (parent of this script's scripts/ dir).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/custom_components/smart_sprinkler_control/frontend"
COMPOSE_FILE="$REPO_ROOT/docker-compose.dev.yml"

cd "$REPO_ROOT"

echo "🔧 Smart Sprinkler Control — dev environment setup"
echo "   Repo: $REPO_ROOT"
echo ""

# --- 1. Docker availability -------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
    echo "❌ docker not found on PATH. Install Docker (or Colima on Mac) first."
    exit 1
fi

if ! docker info >/dev/null 2>&1; then
    echo "🐳 Docker daemon not reachable."
    if command -v colima >/dev/null 2>&1; then
        echo "   Starting Colima..."
        colima start
    else
        echo "❌ Docker daemon is down and Colima is not installed. Start Docker and re-run."
        exit 1
    fi
fi
echo "✅ Docker is running."

# --- 2. Bring up the dev container ------------------------------------------
if [ ! -f "$COMPOSE_FILE" ]; then
    echo "❌ Missing $COMPOSE_FILE"
    exit 1
fi
echo ""
echo "🚀 Starting Home Assistant dev instance (docker compose up -d)..."
docker compose -f "$COMPOSE_FILE" up -d
echo "✅ Container ha-sprinkler-dev is up. First boot can take 1–3 min."

# --- 3. Build the panel frontend --------------------------------------------
echo ""
if [ -d "$FRONTEND_DIR" ]; then
    if command -v npm >/dev/null 2>&1; then
        echo "🎨 Building panel frontend in custom_components/smart_sprinkler_control/frontend ..."
        ( cd "$FRONTEND_DIR" && npm install && npm run build )
        echo "✅ Panel bundle built (dist/smart-sprinkler-control-panel.js)."
    else
        echo "⚠️ npm not found. Skipping frontend build."
        echo "   Install Node.js 18+ then run: (cd $FRONTEND_DIR && npm install && npm run build)"
    fi
else
    echo "⚠️ Frontend dir not found at $FRONTEND_DIR — skipping build."
fi

# --- 4. Done ----------------------------------------------------------------
echo ""
echo "✅ Setup complete."
echo ""
echo "🎯 Next steps:"
echo "   • Home Assistant:  http://localhost:8123"
echo "   • Sprinkler panel: http://localhost:8123/smart-sprinkler-control"
echo "   • Logs:            docker compose -f docker-compose.dev.yml logs -f"
echo "   • Restart (after Python edits): docker compose -f docker-compose.dev.yml restart"
echo "   • Teardown:        docker compose -f docker-compose.dev.yml down"
echo ""
