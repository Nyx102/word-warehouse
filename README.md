# WorldEnd Translation Workbench

Self-hosted workbench for the WorldEnd2 (SukaMoka) fan translation: indexed
search over every source (official EN, fan EN, JP raws, ZH raws in both
scripts), a consistency checker, cross-language chapter alignment, git-visible
editing, and a chat assistant (Claude, via your Claude Code subscription) with
agentic access to all of it.

## Run

```sh
docker compose up -d --build        # serves http://100.111.187.66:8686 (mesh only)
```

or directly on the host (same behavior, no container):

```sh
python3 server.py                   # binds 100.111.187.66:8686
python3 server.py --host 127.0.0.1  # local testing
```

## Pieces

| Path | What |
|---|---|
| `server.py` | pure-stdlib HTTP + SSE server; background poller keeps index fresh every 5 s (no AI credits — local stat scan) |
| `indexer.py` | segmentation per source format; JP ruby-strip + trad→simp shadow columns; SQLite FTS5 (unicode61 for EN, trigram for CJK) |
| `search.py` | query routing EN/JP/ZH, LIKE fallback for short CJK, chapter alignment via `-subtitle-` join keys |
| `checker.py` | lint: near-miss typos (edit-distance vs replacements.yaml vocab, official-EN whitelist) + leftover-term regression with exact rule simulation |
| `chat.py` | claude CLI headless (stream-json, `--resume` per thread); permissions via flags; **credits are spent only here** |
| `corpus_cli.py` | the `corpus` command (symlinked into `~/.local/bin` and the container): search / context / align / terms / lint / sniff / status / reindex |
| `scripts/reorg.py` | one-shot corpus reorganization (already executed 2026-07-17) |
| `scripts/coverage.py` | regenerates `corpus/notes/coverage.md` |
| `scripts/gen_trad2simp.py` | regenerates `trad2simp.py` from the parallel v05 editions |

## Data & state

- Index DB: `app/data/corpus.db` (disposable — rebuilt automatically).
- Chat threads/messages: same DB. Deleting a thread deletes its history.
- Claude sessions: `~/.claude` (mounted into the container; cwd-keyed, so host
  and container share sessions).
- The corpus itself is a git repo (assistant edits stay uncommitted for review
  in the Diffs tab); `corpus/worldend2/repo` is the translation repo with its
  own remotes.

## Conventions

- Add new sources by dropping files in `corpus/inbox/` and asking the
  assistant to file them (`corpus sniff` proposes destinations), or file them
  by hand using the `worldend*/jp|zh/vNN.txt` naming.
- The assistant's standing instructions live in `corpus/CLAUDE.md`; its
  persistent memory in `corpus/notes/`.
- Optional: `sudo apt install wamerican` gives the checker a system dictionary
  and removes the last few near-miss false positives (picked up automatically).
