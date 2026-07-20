# Word Warehouse — dev guide

Self-hosted workspace for the WorldEnd2 (SukaMoka) fan translation. This file
is for sessions working on the CODEBASE; the embedded translation assistant
has its own instructions at `corpus/CLAUDE.md` (auto-loaded there — its cwd is
the corpus).

## Iron rule: no host paths

Everything derives from `config.py:ROOT` (the project root = this directory).
Never hardcode absolute paths — not in Python, Docker, scripts, or docs. The
container mounts the project at `/word-warehouse` (its own fixed internal
path); the host location is irrelevant and may change.

## Layout

| Path | What |
|---|---|
| `backend/` | FastAPI + uvicorn backend package: core `config.py`/`db.py` plus entry points `server.py`/`cli.py` at the package root, with `index/`, `lint/`, `adapters/` subpackages; see README.md for the module table |
| `corpus/` | ALL translation data (raws, official EN, the translation git submodule at `corpus/worldend2/repo`, assistant notes)—corpus data is part of this repo; the submodule is tracked as a gitlink |
| `frontend/` | React + Vite + TS + CodeMirror IDE workspace (rail sections Files/Search/Git/Flags/Chat, buffer tabs, chat dock); styles split under `frontend/src/styles/`—color literals live ONLY in `tokens.css`; build lands in `frontend/dist`, served by `backend/server.py` |
| `data/` | runtime state (sqlite index, converted artifacts) — gitignored, disposable except chat threads |
| `scripts/` | maintenance scripts; import `config` via sys.path bootstrap, never hardcode paths |

## Run / dev

- `docker compose up -d --build` — the whole thing (binds :8686; container name `word-warehouse`).
- Dev mode: `WORLDEND_DEV=1` (in `.env` or inline: `WORLDEND_DEV=1 docker compose up`) makes the container live-reload — backend hot-reload on :8686 and Vite HMR on :5173 (browse :5173). Empty/unset = prod, serving the built bundle. The entrypoint that branches on it is `scripts/container-start.sh`.
- Frontend rebuild (prod bundle): `scripts/rebuild-frontend.sh` (wraps `docker compose exec word-warehouse sh -c 'cd frontend && npm run build'`).
- `corpus` CLI = `backend/cli.py` (wrapper at /usr/local/bin/corpus runs `python3 -m backend.cli`).
- Tests are live-data verifications — see the verification sections in README.md; the index rebuilds itself, never hand-edit `data/corpus.db`.

## Git

One repo for code + corpus data. The translation repo `corpus/worldend2/repo` is
a git submodule—it has its own GitHub remotes; the superproject tracks it as a
gitlink (pinned commit; URL in `.gitmodules`). Never `git commit` or `push` on the
user's behalf unless asked; the embedded assistant's edits stay uncommitted for
review in the workspace's magit-style git UI.

## Cost rules

The embedded chat defaults to sonnet (per-thread picker); flag triage uses
haiku. Never let an embedded AI feature inherit the user's CLI default model.
