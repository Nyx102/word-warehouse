# Word Warehouse — dev guide

Self-hosted workbench for the WorldEnd2 (SukaMoka) fan translation. This file
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
| `server.py` etc. (root) | pure-stdlib Python backend; see README.md for the module table |
| `corpus/` | ALL translation data (raws, official EN, the nested translation git repo at `corpus/worldend2/repo`, assistant notes) — part of this repo except the nested repo |
| `frontend/` | React + Vite + TS + CodeMirror IDE workspace (rail sections Files/Search/Git/Flags/Chat, buffer tabs, chat dock); styles split under `frontend/src/styles/`—color literals live ONLY in `tokens.css`; build lands in `frontend/dist`, served by server.py |
| `data/` | runtime state (sqlite index, converted artifacts) — gitignored, disposable except chat threads |
| `scripts/` | maintenance scripts; import `config` via sys.path bootstrap, never hardcode paths |

## Run / dev

- `docker compose up -d --build` — the whole thing (binds :8686; container name `word-warehouse`).
- Frontend rebuild: `docker compose exec workbench sh -c 'cd frontend && npm run build'`; HMR: `npm run dev` in-container on :5173.
- `corpus` CLI = `corpus_cli.py` (symlinked in-container at /usr/local/bin/corpus).
- Tests are live-data verifications — see the verification sections in README.md; the index rebuilds itself, never hand-edit `data/corpus.db`.

## Git

One unified repo (code + corpus data). The translation repo `corpus/worldend2/repo`
stays nested and ignored — it has its own GitHub remotes. Never `git commit` or
`push` on the user's behalf unless asked; the embedded assistant's edits stay
uncommitted for review in the workspace's magit-style git UI.

## Cost rules

The embedded chat defaults to sonnet (per-thread picker); flag triage uses
haiku. Never let an embedded AI feature inherit the user's CLI default model.
