#!/usr/bin/env python3
"""One-shot corpus reorganization: text/ + japanese/ -> worldend/ + worldend2/ layout.

Run with --dry-run first. Aborts on any pre-flight failure. Executes the exact
mapping approved in the plan; preserves originals it splits under archive/.
"""

import argparse
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path

# historical one-shot (executed 2026-07-17, pre-unification); kept for reference
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import CORPUS  # noqa: E402

JP = "japanese"

# (source relative path, destination relative path, expected language)
MOVES = [
    ("text/worldend/WorldEnd Vol. 1.txt", "worldend/official-en/v01.txt", "en"),
    ("text/worldend/WorldEnd Vol. 2.txt", "worldend/official-en/v02.txt", "en"),
    ("text/worldend/WorldEnd Vol. 3.txt", "worldend/official-en/v03.txt", "en"),
    ("text/worldend/WorldEnd Vol. 4.txt", "worldend/official-en/v04.txt", "en"),
    ("text/worldend/WorldEnd Vol. 5.txt", "worldend/official-en/v05.txt", "en"),
    ("text/worldend/WorldEnd #EX.txt", "worldend/official-en/ex.txt", "en"),
    (f"{JP}/終末なにしてますか？ 忙しいですか？ 救ってもらっていいですか？#01 - 枯野 瑛.txt",
     "worldend/jp/v01.txt", "jp"),
    (f"{JP}/シュウマツナニシテマスカイソガシイデスカスクッテモラッテイイデスカ02 - 枯野 瑛.txt",
     "worldend/jp/v02.txt", "jp"),
    (f"{JP}/シュウマツナニシテマスカイソガシイデスカスクッテモラッテイイデスカ03デンシトクベツバン - 枯野 瑛.txt",
     "worldend/jp/v03.txt", "jp"),
    (f"{JP}/シュウマツナニシテマスカイソガシイデスカスクッテモラッテイイデスカ04 - 枯野瑛 & ue.txt",
     "worldend/jp/v04.txt", "jp"),
    (f"{JP}/シュウマツナニシテマスカイソガシイデスカスクッテモラッテイイデスカ05 - 枯野 瑛 & ｕｅ.txt",
     "worldend/jp/v05.txt", "jp"),
    (f"{JP}/シュウマツナニシテマスカモウイチドダケアエマスカ001 - 枯野 瑛 & ｕｅ.txt",
     "worldend2/jp/v01.txt", "jp"),
    (f"{JP}/シュウマツナニシテマスカモウイチドダケアエマスカ002 - 枯野 瑛 & ｕｅ.txt",
     "worldend2/jp/v02.txt", "jp"),
    (f"{JP}/シュウマツナニシテマスカモウイチドダケアエマスカ003 - 枯野 瑛 & ｕｅ.txt",
     "worldend2/jp/v03.txt", "jp"),
    (f"{JP}/シュウマツナニシテマスカモウイチドダケアエマスカ004 - 枯野 瑛 & ｕｅ.txt",
     "worldend2/jp/v04.txt", "jp"),
    (f"{JP}/末日时在做什么？有没有空？可以来拯救吗？ 2 - 枯野锳.txt", "worldend/zh/v02.txt", "zh-s"),
    (f"{JP}/末日时在做什么？有没有空？可以来拯救吗？ 03 - 枯野瑛.txt", "worldend/zh/v03.txt", "zh-s"),
    (f"{JP}/末日时在做什么？有没有空？可以来拯救吗？04 - 枯野英.txt", "worldend/zh/v04.txt", "zh-s"),
    (f"{JP}/末日时在做什么？有没有空？可以来拯救吗？ 05 - 枯野瑛.txt", "worldend/zh/v05.txt", "zh-s"),
    (f"{JP}/末日時在做什麼？有沒有空？可以來拯救嗎？5 - 枯野瑛.txt", "worldend/zh/v05-traditional.txt", "zh-t"),
    (f"{JP}/末日时在做什么？有没有空？可以来拯救吗？【EX】 - 枯野英 [枯野英] & chenjin5.com.txt",
     "worldend/zh/ex.txt", "zh-s"),
    (f"{JP}/末日时在做什么？能不能再见一面？ 01 - 枯野瑛.txt", "worldend2/zh/v01.txt", "zh-s"),
    (f"{JP}/末日时在做什么？能不能再见一面？ 02 - 枯野瑛.txt", "worldend2/zh/v02.txt", "zh-s"),
    (f"{JP}/末日时在做什么？能不能再见一面？ 03 - 枯野瑛.txt", "worldend2/zh/v03.txt", "zh-s"),
    (f"{JP}/末日时在做什么？能不能再见一面？ 04 - 枯野瑛.txt", "worldend2/zh/v04.txt", "zh-s"),
]

OMNIBUS = f"{JP}/末日时在做什么？有没有空？可以来拯救吗？ - 枯野瑛.txt"
OMNIBUS_ARCHIVE = "archive/worldend-zh-omnibus-wenku8.txt"
BILINGUAL_DELETE = f"{JP}/シュウマツナニシテマスカモウイチドダケアエマスカ004 - 枯野 瑛 & ｕｅ (1).txt"

VOL_MARKER = re.compile(r"^第([一二三四五])卷")
EX_MARKER = re.compile(r"^番外EX")
CN_NUM = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5}
NOISE = re.compile(r"轻小说文库|WenKu8|轻之国度|更多精彩热门|^◆◇|^图源：|^录入：|^台版 转自")

TRAD_ONLY = set("來沒嗎麼爲這裡兩點時說話讀寫萬與體")
SIMP_ONLY = set("么时见说这两点为没读写万与体")


def sniff_lang(text: str) -> str:
    sample = text[:50000]
    kana = sum(1 for c in sample if "぀" <= c <= "ヿ")
    han = sum(1 for c in sample if "一" <= c <= "鿿")
    if han + kana < 50:
        return "en"
    if kana / (han + kana) > 0.10:  # quoted JP blurbs in CN files stay far below this
        return "jp"
    trad = sum(1 for c in sample if c in TRAD_ONLY)
    simp = sum(1 for c in sample if c in SIMP_ONLY)
    return "zh-t" if trad > simp else "zh-s"


def looks_bilingual(text: str) -> bool:
    lines = [l for l in text.splitlines()[:400] if l.strip()]
    ascii_lines = sum(1 for l in lines if sum(c.isascii() for c in l) / len(l) > 0.8)
    return ascii_lines / max(len(lines), 1) > 0.2


def split_omnibus(text: str):
    """Return ({1: [lines], ..., 5: [lines], 'ex': [lines]}, toc_start_line)."""
    lines = text.splitlines()
    toc_start = None
    for i, l in enumerate(lines):
        if l.strip() == "Table of Contents":
            toc_start = i
            break
    if toc_start is None:
        sys.exit("ABORT: omnibus trailing TOC not found")

    sections = {}
    current = None
    seen_ex = False
    for i, l in enumerate(lines[:toc_start]):
        if EX_MARKER.match(l):
            current = "ex"
            seen_ex = True
        else:
            m = VOL_MARKER.match(l)
            if m and not seen_ex:  # 第五卷 插图 noise inside the EX region must not flip back
                current = CN_NUM[m.group(1)]
        if current is not None:
            sections.setdefault(current, []).append(l)
    return sections, toc_start


def norm_paras(lines):
    out = set()
    for l in lines:
        l = unicodedata.normalize("NFKC", l).strip()
        if len(l) > 20 and not NOISE.search(l):
            out.add(l)
    return out


def similarity(part_lines, standalone_text):
    a = norm_paras(part_lines)
    b = norm_paras(standalone_text.splitlines())
    if not a:
        return 0.0
    return len(a & b) / len(a)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    dry = args.dry_run
    report = []

    def act(msg):
        print(("DRY-RUN: " if dry else "") + msg)
        report.append(msg)

    # ---------- pre-flight ----------
    for rel, _, _ in MOVES:
        if not (CORPUS / rel).is_file():
            sys.exit(f"ABORT: missing source file: {rel}")
    for rel in (OMNIBUS, BILINGUAL_DELETE, "text/formatting", "text/worldend2", "raw"):
        if not (CORPUS / rel).exists():
            sys.exit(f"ABORT: missing: {rel}")
    for rel in ("worldend", "worldend2", "inbox", "notes", "archive"):
        if (CORPUS / rel).exists():
            sys.exit(f"ABORT: target already exists: {rel} (reorg already ran?)")

    r = subprocess.run(["diff", "-rq", str(CORPUS / "text/worldend2"),
                        str(CORPUS / "text/formatting/Volumes")], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"ABORT: text/worldend2 differs from text/formatting/Volumes:\n{r.stdout}{r.stderr}")
    print("pre-flight: duplicate copy verified identical")

    for rel, dest, expected in MOVES:
        text = (CORPUS / rel).read_text(encoding="utf-8")
        got = sniff_lang(text)
        if got != expected:
            sys.exit(f"ABORT: language sniff mismatch for {rel}: expected {expected}, got {got}")
    print(f"pre-flight: language verified for {len(MOVES)} files")

    bilingual_text = (CORPUS / BILINGUAL_DELETE).read_text(encoding="utf-8")
    if not looks_bilingual(bilingual_text):
        sys.exit("ABORT: the '(1)' JP v04 file does not look bilingual; refusing to delete")
    print("pre-flight: bilingual v04 variant confirmed (safe to delete per user decision)")

    omni_text = (CORPUS / OMNIBUS).read_text(encoding="utf-8")
    sections, toc_start = split_omnibus(omni_text)
    missing = [k for k in (1, 2, 3, 4, 5, "ex") if k not in sections]
    if missing:
        sys.exit(f"ABORT: omnibus split missing sections: {missing}")
    print(f"pre-flight: omnibus split ok (TOC at line {toc_start + 1}; "
          + ", ".join(f"{k}:{len(v)}L" for k, v in sections.items()) + ")")

    # ---------- execute ----------
    for rel in ("worldend/official-en", "worldend/jp", "worldend/zh",
                "worldend2/jp", "worldend2/zh", "inbox", "notes", "archive"):
        act(f"mkdir -p {rel}")
        if not dry:
            (CORPUS / rel).mkdir(parents=True, exist_ok=True)

    for rel, dest, _ in MOVES:
        act(f"mv {rel!r} -> {dest}")
        if not dry:
            shutil.move(str(CORPUS / rel), str(CORPUS / dest))

    # omnibus: promote v01, archive original, similarity-report the rest
    v01_lines = [l for l in sections[1] if not NOISE.search(l)]
    act(f"write worldend/zh/v01.txt from omnibus vol-1 section ({len(v01_lines)} lines)")
    if not dry:
        header = "末日时在做什么？有没有空？可以来拯救吗？ 第一卷\n（自 wenku8 合集拆分；原始合集见 archive/）\n\n"
        (CORPUS / "worldend/zh/v01.txt").write_text(header + "\n".join(v01_lines) + "\n", encoding="utf-8")
    act(f"mv omnibus -> {OMNIBUS_ARCHIVE}")
    if not dry:
        shutil.move(str(CORPUS / OMNIBUS), str(CORPUS / OMNIBUS_ARCHIVE))

    sim_report = ["# Omnibus similarity check (paragraph-set overlap of omnibus section vs standalone)"]
    standalone = {2: "worldend/zh/v02.txt", 3: "worldend/zh/v03.txt", 4: "worldend/zh/v04.txt",
                  5: "worldend/zh/v05.txt", "ex": "worldend/zh/ex.txt"}
    for key, rel in standalone.items():
        path = (CORPUS / rel) if not dry else (CORPUS / dict((d, s) for s, d, _ in MOVES)[rel])
        ratio = similarity(sections[key], path.read_text(encoding="utf-8"))
        sim_report.append(f"- vol {key}: {ratio:.1%} of omnibus paragraphs found in standalone {rel}")
    print("\n".join(sim_report))
    report.extend(sim_report)

    act(f"DELETE bilingual variant {BILINGUAL_DELETE!r}")
    if not dry:
        (CORPUS / BILINGUAL_DELETE).unlink()
    act("DELETE text/worldend2 (verified duplicate of text/formatting/Volumes)")
    if not dry:
        shutil.rmtree(CORPUS / "text/worldend2")
    act("mv text/formatting -> worldend2/repo")
    if not dry:
        shutil.move(str(CORPUS / "text/formatting"), str(CORPUS / "worldend2/repo"))

    for rel in ("text/worldend", "text", JP):
        act(f"rmdir {rel}")
        if not dry:
            leftovers = list((CORPUS / rel).rglob("*"))
            leftovers = [p for p in leftovers if p.is_file()]
            if leftovers:
                sys.exit(f"ABORT: {rel} not empty before rmdir: {leftovers}")
            shutil.rmtree(CORPUS / rel)

    if not dry:
        (CORPUS / "notes/reorg-report.md").write_text(
            "# Corpus reorganization report\n\n" + "\n".join(report) + "\n", encoding="utf-8")

    # ---------- git ----------
    act("git init corpus, ignore worldend2/repo, initial commit")
    if not dry:
        (CORPUS / ".gitignore").write_text("/worldend2/repo/\n", encoding="utf-8")
        subprocess.run(["git", "init", "-b", "main"], cwd=CORPUS, check=True, capture_output=True)
        subprocess.run(["git", "add", "-A"], cwd=CORPUS, check=True)
        subprocess.run(["git", "commit", "-m", "Reorganize corpus into worldend/worldend2 layout"],
                       cwd=CORPUS, check=True, capture_output=True)

    print("\nDone." if not dry else "\nDry run complete — no changes made.")


if __name__ == "__main__":
    main()
