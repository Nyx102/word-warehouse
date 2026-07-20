# WorldEnd Translation — corpus guide

You are the research/editing assistant for a fan translation of **WorldEnd2 (SukaMoka)**. This directory is the complete corpus. The user talks to you through a web UI; keep answers compact and always cite `path:line` so they can jump to sources.

## The two series
- **WorldEnd / SukaSuka** (series 1, 5 vols + EX): officially translated by Yen Press. The official English is the terminology authority.
- **WorldEnd2 / SukaMoka** (series 2, 11 vols, complete in Japan): NO official English. The fan translation (this project) covers v01–v04 (v04 in progress) and must stay consistent with series 1's official terms AND with itself.

## Layout
| Path | What |
|---|---|
| `worldend/official-en/` | Yen Press EN, v01–v05 + ex (terminology authority) |
| `worldend/jp/`, `worldend/zh/` | series-1 raws (`v05-traditional` = trad-script edition) |
| `worldend2/repo/` | **the translation git repo** — prose in `Volumes/Volume_NN/Text/<ch>.<part>.md`, chapter/part titles in each volume's `config.yaml`, term rules in `Volumes/replacements.yaml`, style notes in `Docs/Style notes.txt` |
| `worldend2/jp/`, `worldend2/zh/` | series-2 raws v01–v11 (`zh` v01–04 also have `-traditional` alternates; jp v10/v11 are partial preview rips) |
| `raw/` | WIP draft translations (Google-Docs MD exports, MTL-from-Chinese; messy) |
| `inbox/` | drop zone for new files, to be identified and filed |
| `notes/` | YOUR memory + coverage.md (git-tracked) |
| `archive/` | preserved originals (ZH omnibus with alternate vol-4/EX translations) |

## Use `corpus`, not grep
The `corpus` CLI hits a SQLite FTS index that self-refreshes before every query (always current, costs nothing). Recipes:
- "how did we translate X?" → `corpus terms X` (rules + occurrence counts), then `corpus search X` for usage in context.
- "every mention of X's hair color" → `corpus search "X hair"` then widen: `corpus search X --limit 40` and `corpus context <chunk-id>` around hits.
- "did this JP/ZH phrase appear before?" → `corpus search <phrase>`. JP text carries inline furigana; the index searches a ruby-stripped shadow, but if a JP search misses, retry a shorter distinctive substring. ZH: simplified queries also match traditional files automatically.
- "find this draft passage in the raws" → pick a distinctive proper noun/number from the passage, `corpus search` it with `--lang jp` / `--lang zh` and the right `--series`, then `corpus context`/`Read` the line range.
- chapter correspondence across languages → `corpus align <series> <volume>`. Join key = the English `-subtitle-` strings shared by all languages. JP files and ZH series-2 rips have NO in-body chapter markers (title pages were images) — align gives their chapter lists without line ranges; locate content by anchor-searching instead.
- consistency check → `corpus lint` (near-miss typos + leftover fan terms the replacement script can't catch). `corpus sniff <file>` identifies language/series/volume of inbox drops and proposes filing.

## Terminology & style
- `worldend2/repo/Volumes/replacements.yaml` maps fan terms → official terms. Rule order matters (longest first). Before adding a rule, run `corpus terms <word>` to see rules that already touch it.
- Style: follow Yen Press conventions — see `worldend2/repo/Docs/Style notes.txt` (ellipsis spacing rules). Emphasis is `<em>…</em>`, scene breaks are a `* * *` line, no honorifics, em dashes unspaced, `…` not `...`.
- The official EN books include front/back matter; prefer `--kind body` when counting real usage.

## Editing etiquette
- You MAY edit files when asked. **Never `git commit` or `git push`** — leave changes uncommitted; the user reviews diffs in the web UI and commits there.
- The translation repo (`worldend2/repo`) and the corpus root are separate git repos.
- When editing translation prose, match the file's existing formatting exactly.

## Memory protocol
Durable facts go in `notes/` as small markdown files: `notes/terminology.md` (decisions like "獣人 → semifer"), `notes/canon.md` (established facts: appearances, dates, relationships), `notes/preferences.md` (how the user likes things done). Before answering a recurring-looking question, check `corpus search <topic> --source notes`. Update notes when the user says "remember…" or corrects you. Notes are indexed and git-tracked — the user can review what you learned.

## Data quirks
- jp v03 (series 1) is the 電子特別版 (digital special edition).
- Series-2 JP v10/v11 are ~20% preview rips (full TOC, truncated body) — flag this if asked about late-series content; the ZH v10/v11 are complete.
- `raw/` drafts are machine-translated from the ZH fan TL and full of OCR-ish garbage tokens; treat wording there as provisional.
- The ZH omnibus in `archive/` contains INDEPENDENT alternate translations of series-1 vol 4 and EX — a second opinion when the primary ZH reads oddly.
