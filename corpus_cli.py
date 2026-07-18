#!/usr/bin/env python3
"""`corpus` — indexed search and utilities over the WorldEnd corpus.

Designed for both humans and the embedded assistant. Every query subcommand
refreshes the index first (pure-local stat scan; no AI involved, costs nothing).
"""

import argparse
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent
sys.path.insert(0, str(APP))

from config import CORPUS, RULES_YAML, SCRIPTS_DIR  # noqa: E402


def _print_hit(r):
    where = f"{r['path']}:{r['start_line']}-{r['end_line']}"
    label = f"ch{r['chapter_label']}" if r.get("chapter_label") else ""
    title = r.get("chapter_title") or ""
    sub = f" -{r['subtitle']}-" if r.get("subtitle") else ""
    part = f" / {r['part_title']}" if r.get("part_title") else ""
    vol = f"v{r['volume']}" if r.get("volume") else ""
    head = " ".join(x for x in (
        f"[c{r['chunk_id']}]", r["source"], r["lang"], vol, label, title + sub + part) if x)
    kind = f" ({r['kind']})" if r.get("kind") not in (None, "body") else ""
    print(f"{head}{kind}\n    {where}")
    snippet = (r.get("snippet") or "").replace("\n", " ")
    print(f"    {snippet}\n")


def cmd_search(args):
    import search
    rows = search.search(args.query, lang=args.lang, series=args.series,
                         source=args.source, kind=args.kind, limit=args.limit)
    if not rows:
        print("no results")
        return
    for r in rows:
        _print_hit(r)
    print(f"{len(rows)} result(s)")


def cmd_context(args):
    import search
    ctx = search.context(args.chunk_id, before=args.before, after=args.after)
    if not ctx:
        print(f"no chunk c{args.chunk_id}")
        return
    row = ctx["row"]
    print(f"{row['path']}:{row['start_line']}-{row['end_line']}\n")
    for n in ctx["neighbors"]:
        marker = ">>" if n["id"] == args.chunk_id else "  "
        print(f"{marker} [c{n['id']}] lines {n['start_line']}-{n['end_line']}")
        print("   " + n["text"].replace("\n", "\n   ")[:2000])
        print()


def cmd_align(args):
    import search
    rows = search.align(args.series, args.volume)
    if not rows:
        print("no chapters found")
        return
    by_vol = {}
    for r in rows:
        by_vol.setdefault(r["volume"], {}).setdefault(
            (r["source"], r["path"]), []).append(r)
    for vol, sources in sorted(by_vol.items()):
        print(f"=== series {args.series} volume {vol} ===")
        keys = []
        for (source, path), chs in sorted(sources.items()):
            print(f"  {source:<9} {path}")
            for c in chs:
                loc = (f"L{c['start_line']}-{c['end_line']}"
                       if c["start_line"] else "location unknown (no body markers)")
                label = f"[{c['chapter_label']}] " if c["chapter_label"] else ""
                sub = f" -{c['subtitle']}-" if c["subtitle"] else ""
                part = f" / {c['part_title']}" if c["part_title"] else ""
                print(f"      {label}{(c['title'] or '?')}{sub}{part}  {loc}")
                if c["subtitle_key"]:
                    keys.append((c["subtitle_key"], source))
        print("  join-key coverage:")
        seen = {}
        for k, s in keys:
            seen.setdefault(k, set()).add(s)
        for k, srcs in sorted(seen.items()):
            print(f"      -{k}-  in: {', '.join(sorted(srcs))}")
        print()


def cmd_terms(args):
    sys.path.insert(0, str(SCRIPTS_DIR))
    import regex_replace
    import search
    from indexer import ensure_fresh
    ensure_fresh()
    rules = regex_replace.load_rules(RULES_YAML)
    word = args.word.lower()
    hits = [(i, r) for i, r in enumerate(rules, 1)
            if word in r.find.lower() or word in r.replace.lower()]
    if hits:
        print(f"replacement rules matching {args.word!r}:")
        for i, r in hits:
            extra = []
            if r.regex:
                extra.append("regex")
            if r.case_mode != "literal":
                extra.append(r.case_mode)
            if r.manual:
                extra.append("MANUAL")
            note = f"  # {r.notes}" if r.notes else ""
            print(f"  rule {i}: {r.find!r} -> {r.replace!r}"
                  f"{' [' + ', '.join(extra) + ']' if extra else ''}{note}")
    else:
        print(f"no replacement rules mention {args.word!r}")
    print("\noccurrences (chunks) per source:")
    for row in search.count_by_source(args.word):
        print(f"  {row['source']:<9} {row['lang']:<5} {row['n']}")


def cmd_sniff(args):
    from indexer import sniff_lang
    p = Path(args.file)
    if not p.is_absolute():
        p = CORPUS / p
    text = p.read_text(encoding="utf-8", errors="replace")
    lang = sniff_lang(text)
    head = next((l.strip() for l in text.splitlines() if l.strip()), "")[:80]
    series = None
    if any(s in text[:3000] for s in ("もう一度だけ", "能不能再见一面", "能不能再見一面")):
        series = 2
    elif any(s in text[:3000] for s in ("救ってもらっていい", "可以来拯救", "可以來拯救", "WorldEnd")):
        series = 1
    import re as _re
    m = _re.search(r"(?:#|＃|vol\.?\s*|volume\s*)0*(\d+)", head, _re.I) or \
        _re.search(r"0*(\d+)", p.name)
    vol = m.group(1).zfill(2) if m else None
    ex = "EX" in head.upper() or "ＥＸ" in head
    print(f"file:   {p}")
    print(f"lang:   {lang}")
    print(f"series: {series or 'unknown'}")
    print(f"volume: {'ex' if ex else (vol or 'unknown')}")
    print(f"head:   {head}")
    base = "worldend" if series == 1 else "worldend2" if series == 2 else "???"
    sub = {"jp": "jp", "zh-s": "zh", "zh-t": "zh", "en": "official-en"}.get(lang, "???")
    name = "ex.txt" if ex else f"v{vol}.txt" if vol else "???.txt"
    print(f"proposed destination: {base}/{sub}/{name}")


def cmd_status(args):
    from db import connect
    from indexer import ensure_fresh
    import time
    conn = connect()
    n = ensure_fresh(conn)
    print(f"reindexed just now: {n} file(s)")
    for r in conn.execute(
            "SELECT source, lang, count(*) AS files FROM files GROUP BY source, lang"
            " ORDER BY source, lang"):
        print(f"  {r['source']:<9} {r['lang']:<5} {r['files']} files")
    row = conn.execute("SELECT count(*) c FROM chunks").fetchone()
    ts = conn.execute("SELECT v FROM meta WHERE k='last_scan_at'").fetchone()
    age = time.time() - float(ts["v"]) if ts else None
    print(f"chunks: {row['c']}; last scan {age:.1f}s ago" if age is not None
          else f"chunks: {row['c']}")


def cmd_reindex(args):
    from indexer import ensure_fresh
    n = ensure_fresh(force=True)
    print(f"reindexed {n} file(s)")


def cmd_lint(args):
    import checker
    try:
        checker.cli_lint(args.path, verbose=args.verbose, scope=args.scope,
                         triage=args.triage)
    except FileNotFoundError as e:
        sys.exit(str(e))


def main():
    ap = argparse.ArgumentParser(prog="corpus", description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("search", help="full-text search (auto EN/JP/ZH routing)")
    s.add_argument("query")
    s.add_argument("--lang", choices=["en", "jp", "zh", "zh-s", "zh-t"])
    s.add_argument("--series", type=int, choices=[1, 2])
    s.add_argument("--source",
                   choices=["official", "fan", "jp", "zh", "raw", "inbox", "notes", "docs"])
    s.add_argument("--kind", default="all",
                   choices=["body", "frontmatter", "afterword", "all"])
    s.add_argument("--limit", type=int, default=20)
    s.set_defaults(fn=cmd_search)

    s = sub.add_parser("context", help="show a chunk with surrounding chunks")
    s.add_argument("chunk_id", type=lambda v: int(v.lstrip("c")))
    s.add_argument("--before", type=int, default=2)
    s.add_argument("--after", type=int, default=2)
    s.set_defaults(fn=cmd_context)

    s = sub.add_parser("align", help="chapter matrix across languages for a volume")
    s.add_argument("series", type=int, choices=[1, 2])
    s.add_argument("volume", nargs="?")
    s.set_defaults(fn=cmd_align)

    s = sub.add_parser("terms", help="replacement-rule + occurrence lookup for a term")
    s.add_argument("word")
    s.set_defaults(fn=cmd_terms)

    s = sub.add_parser("sniff", help="identify language/series/volume of a file")
    s.add_argument("file")
    s.set_defaults(fn=cmd_sniff)

    s = sub.add_parser("lint", help="consistency check (near-misses, leftovers)")
    s.add_argument("path", nargs="?")
    s.add_argument("--verbose", action="store_true")
    s.add_argument("--scope", choices=["raw", "finished", "all"], default="all")
    s.add_argument("--triage", action="store_true",
                   help="run AI triage on pending flags and show verdicts")
    s.set_defaults(fn=cmd_lint)

    s = sub.add_parser("status", help="index freshness and stats")
    s.set_defaults(fn=cmd_status)

    s = sub.add_parser("reindex", help="force full reindex")
    s.set_defaults(fn=cmd_reindex)

    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
