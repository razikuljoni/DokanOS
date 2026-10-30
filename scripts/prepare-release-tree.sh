#!/usr/bin/env bash
set -euo pipefail

# Removes AI Studio preview harness files when preparing a clean branch for Vercel / Render deployment (§4.4)
rm -f server.ts index.html vite.config.ts metadata.json
rm -rf src public/assets/aistudio
echo "Removed AI Studio preview harness files. Workspace now contains only apps/api, apps/web, and packages/shared."
