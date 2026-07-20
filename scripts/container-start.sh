#!/usr/bin/env bash
# Container entrypoint (Dockerfile CMD).
#
# Prod (default): serve the prebuilt frontend/dist bundle on :8686.
# Dev (WORLDEND_DEV set): the backend hot-reloads on Python edits AND a Vite HMR
# server comes up on :5173 that live-reloads the UI on frontend edits (it
# proxies /api to the backend). Browse :5173 while developing; :8686 keeps
# serving whatever bundle was last built.
set -euo pipefail
cd /word-warehouse

# Same truthiness as backend/config.py:env_flag — 1/true/yes/on (any case) is on;
# unset/empty/0/false/no/off is off, so a leftover WORLDEND_DEV=0 stays prod.
case "$(printf '%s' "${WORLDEND_DEV:-}" | tr '[:upper:]' '[:lower:]')" in
  1 | true | yes | on) dev=1 ;;
  *) dev='' ;;
esac

if [ -n "$dev" ]; then
  if [ -d frontend/node_modules ]; then
    echo "[dev] Vite HMR on :5173 · backend hot-reload on :8686"
    ( cd frontend && npm run dev ) &
  else
    echo "[dev] frontend/node_modules missing — skipping Vite HMR." >&2
    echo "[dev] install once: docker compose exec word-warehouse sh -c 'cd frontend && npm ci'" >&2
  fi
fi

# Pre-trust the workspace for the embedded assistant. Claude Code ignores a
# project's .claude/settings.json in an untrusted folder and warns on stderr
# ("this workspace has not been trusted"); the assistant spawns `claude`
# headless (backend/adapters/chat.py) so there is no TTY to accept the trust
# dialog. Trust lives per repo-root in ~/.claude.json, which is NOT a mounted
# volume (unlike ~/.claude), so it is absent on a fresh container. Seed it for
# the repo root (the git root claude walks up to from corpus). Idempotent;
# merges into any existing file.
python3 - <<'PY'
import json, os
path = os.path.expanduser("~/.claude.json")
try:
    with open(path) as f:
        conf = json.load(f)
except (FileNotFoundError, ValueError):
    conf = {}
conf.setdefault("projects", {}).setdefault("/word-warehouse", {})["hasTrustDialogAccepted"] = True
with open(path, "w") as f:
    json.dump(conf, f)
PY

# Backend is the container's main process; WORLDEND_DEV makes backend.server
# start uvicorn with --reload. Any backgrounded Vite is torn down with the
# container (its exposed :5173 dies when this process exits).
exec python3 -m backend.server --host 0.0.0.0 --port 8686
