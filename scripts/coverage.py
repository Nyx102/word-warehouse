#!/usr/bin/env python3
"""Generate notes/coverage.md: volume × language source matrix for both series."""

import datetime
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import CORPUS  # noqa: E402

S1_VOLS = ["v01", "v02", "v03", "v04", "v05", "ex"]
S2_TOTAL = 11  # series complete at #11 (Kadokawa Sneaker Bunko, 2021-07)


def mark(path: Path) -> str:
    if not path.is_file():
        return "—"
    sizes = sorted(p.stat().st_size for p in path.parent.glob("v*.txt"))
    if len(sizes) >= 4 and path.stat().st_size < 0.45 * sizes[len(sizes) // 2]:
        return "⚠ partial"
    return "✓"


def fan_status(vol: int) -> str:
    d = CORPUS / f"worldend2/repo/Volumes/Volume_{vol:02d}/Text"
    if not d.is_dir():
        return "—"
    files = sorted(p.stem for p in d.glob("*.md"))
    if not files:
        return "—"
    last = max(files, key=lambda s: [int(x) for x in s.split(".")])
    # a lone final chapter file like 5.md marks a complete volume
    return "✓" if "." not in last and int(last) >= 5 else f"partial (through {last})"


def main():
    lines = [
        "# Corpus coverage",
        "",
        f"_Generated {datetime.date.today()} by app/scripts/coverage.py — rerun after adding sources._",
        "",
        "## WorldEnd / SukaSuka (series 1 — complete: 5 volumes + EX)",
        "",
        "| Vol | Official EN | JP raw | ZH raw |",
        "|-----|-------------|--------|--------|",
    ]
    for v in S1_VOLS:
        en = mark(CORPUS / f"worldend/official-en/{v}.txt")
        jp = mark(CORPUS / f"worldend/jp/{v}.txt")
        zh = mark(CORPUS / f"worldend/zh/{v}.txt")
        extra = ""
        if v == "v03":
            extra = " (JP = 電子特別版)"
        if v == "v05" and (CORPUS / "worldend/zh/v05-traditional.txt").is_file():
            extra = " (+ traditional ZH)"
        if v == "ex" and jp == "—":
            extra = " ← **missing JP raw**"
        if v == "ex" and jp == "✓":
            extra = " (JP acquired 2026-07-17)"
        lines.append(f"| {v} | {en} | {jp} | {zh} |{extra}")

    lines += [
        "",
        "Notes:",
        "- ZH v01 was extracted from the wenku8 omnibus (original preserved in archive/).",
        "- archive/worldend-zh-omnibus-wenku8.txt also contains **independent alternative ZH translations**"
        " of vol 4 (0.2% paragraph overlap with the standalone) and EX (0% overlap — 台版/轻之国度 lineage"
        " vs chenjin5); vols 2/3/5 overlap the standalones at 65–83% (same lineage, edition drift).",
        "",
        f"## WorldEnd2 / SukaMoka (series 2 — complete: {S2_TOTAL} volumes)",
        "",
        "| Vol | Fan EN (repo) | JP raw | ZH raw |",
        "|-----|---------------|--------|--------|",
    ]
    for n in range(1, S2_TOTAL + 1):
        v = f"v{n:02d}"
        fan = fan_status(n)
        jp = mark(CORPUS / f"worldend2/jp/{v}.txt")
        zh = mark(CORPUS / f"worldend2/zh/{v}.txt")
        note = ""
        if jp == "⚠ partial":
            note = "  ← JP is a preview/sample rip (~20% of body) — re-source full ebook"
        elif "—" in (jp, zh):
            note = "  ← missing raw(s)"
        lines.append(f"| {v} | {fan} | {jp} | {zh} |{note}")

    lines += [
        "",
        "Notes:",
        "- No official EN exists for series 2 (Yen Press licensed series 1 only).",
        "- raw/ holds the WIP v04 draft (Google-Docs export, MTL from the ZH fan TL).",
        "- ZH v01–v04: simplified primaries plus traditional `-traditional` alternates"
        " (independent edition); ZH v05–v11 are traditional only.",
        "",
        "## Shopping list (true gaps)",
    ]
    partial = [f"v{n:02d}" for n in range(1, S2_TOTAL + 1)
               if mark(CORPUS / f"worldend2/jp/v{n:02d}.txt") == "⚠ partial"]
    if partial:
        lines.append(f"- Full JP ebook rips of SukaMoka {', '.join(partial)} — current"
                     " files are preview/sample editions.")
    else:
        lines.append("- None — every volume present in every expected language.")

    out = CORPUS / "notes/coverage.md"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {out}")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
