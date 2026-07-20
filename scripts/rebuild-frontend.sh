#!/usr/bin/env bash
# Rebuild the frontend bundle inside the running container.
#
# The backend serves frontend/dist, so run this after changing frontend sources
# (CSS/TSX) to see them. For live reload instead, use the in-container HMR dev
# server on :5173:  docker compose exec word-warehouse sh -c 'cd frontend && npm run dev'
set -euo pipefail

# Repo root = this script's parent dir; derive it, never hardcode a host path.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

exec docker compose exec word-warehouse sh -c 'cd frontend && npm run build'
