# Word Warehouse

Self-hosted workbench for the WorldEnd2 (SukaMoka) fan translation: indexed
search over every source (official EN, fan EN, JP raws, ZH raws in both
scripts), a consistency checker with AI triage, cross-language chapter
alignment, git-visible editing with an in-browser merge editor, and a chat
assistant (Claude, via your Claude Code subscription) with agentic access to
all of it. One unified, host-independent project: the corpus lives in
`corpus/`, and everything resolves relative to the project root (see
CLAUDE.md's iron rule — no hardcoded paths).

## Run

```sh
docker compose up -d --build        # serves :8686 on all interfaces
```

or directly on the host (same behavior, no container):

```sh
python3 server.py                   # binds 127.0.0.1:8686
python3 server.py --host 0.0.0.0    # expose beyond loopback
```

## How you actually use it

Open `http://<host>:8686` (works on the phone — bottom tab bar). The four tabs
map to the translation workflow:

1. **Chat** — the research assistant. Ask the questions you'd otherwise grep
   for: *"how did we translate Aiseia?"*, *"every mention of Ithea's hair"*,
   *"did this ZH phrase appear in earlier volumes?"*, *"find this draft passage
   in the JP raw"*. It answers with `path:line` citations, and when asked it
   edits files directly (changes land uncommitted for your review in Diffs).
   Say "remember …" and it writes durable notes to `corpus/notes/` that every
   future thread knows. Model picker per thread (default Sonnet; Haiku for
   quick lookups).
2. **Search** — direct indexed search when you don't need the AI: EN/JP/ZH
   auto-routed, JP matches through inline furigana, simplified queries match
   traditional files. Click a hit for surrounding context. The Alignment panel
   shows the chapter matrix across all languages of a volume (joined on the
   shared `-subtitle-` strings) — your jump table between editions.
3. **Flags** — consistency guard while translating. It catches what
   `regex_replace.py` can't: near-miss typos of glossary terms (`Naigrart`,
   `Chthorly`, British `Defence`) and leftover fan terms in finished prose.
   Haiku pre-screens each flag with surrounding context; clearly-intentional
   ones (pronunciation explanations, stylized speech) collapse into the
   reviewable "AI dismissed" section, everything uncertain stays for you.
   Scope toggle: raw drafts vs finished volumes. Dismissals are permanent.
4. **Diffs** — review and ship. Every change (yours, the editor's, the
   assistant's) appears as an uncommitted diff in the right repo; edit
   directly in the merge view (side-by-side on desktop, unified on mobile),
   revert per hunk or per file, then commit selected files with a message.

Adding sources: dump files into `corpus/inbox/` (any filename mess) and ask
the assistant to file them — `corpus sniff` identifies language/series/volume
from content and proposes the destination; `corpus/notes/coverage.md` tracks
what exists per volume per language.

The index refreshes itself within ~5 s of any file change (pure-local, zero
AI cost); credits are spent only on chat turns and flag triage.

### Verified working (tested end-to-end)

Search routing incl. furigana-stripped JP and trad→simp ZH · chapter
alignment (series-1 EN/ZH with line ranges; JP and series-2 ZH at volume
granularity — their chapter pages were images in the rips, use anchor search)
· lint precision on real corpus cases · triage verdicts (Riel-style
pronunciation notes clear; name variants like `Nophttt` always kept) · chat
with session resume, interrupt, file edits, and notes memory · diff editor
save/hunk-revert/file-revert round-trips (untracked files refuse revert) ·
per-thread model selection · container restart persistence. Not machine-
verifiable: the mobile layout itself — check on your phone.

## Pieces

| Path | What |
|---|---|
| `server.py` | pure-stdlib HTTP + SSE server; background poller keeps index fresh every 5 s (no AI credits — local stat scan) |
| `indexer.py` | segmentation per source format; JP ruby-strip + trad→simp shadow columns; SQLite FTS5 (unicode61 for EN, trigram for CJK) |
| `search.py` | query routing EN/JP/ZH, LIKE fallback for short CJK, chapter alignment via `-subtitle-` join keys |
| `checker.py` | lint: near-miss typos (edit-distance vs replacements.yaml vocab, official-EN whitelist) + leftover-term regression with exact rule simulation |
| `chat.py` | claude CLI headless (stream-json, `--resume` per thread); permissions via flags (allow: read/search/edit + corpus CLI + read-only git; deny: commit/push/rm/sudo); **default model sonnet**, per-thread picker in the UI; credits are spent only here and in triage |
| `triage.py` | AI flag adjudication: haiku judges lint flags from context (±2→±10→±30 line escalation, max 2), conservative, per-file verdict cache — unchanged text is never re-judged |
| `frontend/` | React + Vite + TS + CodeMirror UI (mobile bottom-nav; editable merge-view diffs). Rebuild after changes: `docker compose exec workbench sh -c 'cd frontend && npm run build'`; HMR dev server: `npm run dev` in-container on :5173 |
| `corpus_cli.py` | the `corpus` command (symlinked into `~/.local/bin` and the container): search / context / align / terms / lint / sniff / status / reindex |
| `scripts/reorg.py` | one-shot corpus reorganization (already executed 2026-07-17) |
| `scripts/coverage.py` | regenerates `corpus/notes/coverage.md` |
| `scripts/gen_trad2simp.py` | regenerates `trad2simp.py` from the parallel v05 editions |

## Data & state

- Index DB: `data/corpus.db` (disposable — rebuilt automatically).
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
