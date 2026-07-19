"""Corpus scanning, segmentation, and incremental FTS indexing.

Chapter-detection reality per source (verified against the actual files):
- fan md: chapter identity from filename + volume config.yaml
- official EN txt: TOC subtitles recur at body chapter starts (Title line + -subtitle- line)
- CN vols with 第N卷 markers (split omnibus): explicit per-chapter marker lines
- CN vols 2/3/5 (s1): 『title』 + -subtitle- recur in body
- JP rips and CN s2 rips: chapter title pages were images -> TOC metadata only,
  body indexed at volume granularity (chapters carry titles but no line ranges)
"""

import hashlib
import re
import time
import unicodedata

import yaml

import trad2simp
from config import CORPUS, INCLUDE_GLOBS, REPO, classify
from db import connect

MAX_CHUNK = 1000

TRAD_HINT = set("來沒嗎麼麽爲這裡兩點時說話讀寫萬與體見雲")
SIMP_HINT = set("么时见说这两点为没读写万与体云")

SUBTITLE_LINE = re.compile(r"^[\s　]*[-－―‐][A-Za-z].*[-－―‐][\s　]*$")
# JP rips put the whole TOC entry on one line: 『title』－subtitle－ (or ASCII dashes)
ONE_LINE_ENTRY = re.compile(
    r"^[\s　]*[『「]([^』」]{1,50})[』」]\s*[-－―‐]\s*([A-Za-z][^-－―‐]{0,60})[-－―‐]")
VOL_MARKER = re.compile(r"^第[一二三四五六七八九十]+卷\s*(.*)$")
BRACKET_TITLE = re.compile(r"[『「]([^』」]+)[』」]")
AFTERWORD = re.compile(r"あとがき|後書き|后记|後記|afterword", re.I)
ILLUST = re.compile(r"^插图$|^插圖$")
MD_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
SCENE_MD = re.compile(r"^\s*\*\s*\*\s*\*\s*$")
RUBY = re.compile(r"(?<=[一-鿿])[ぁ-ゖ]{1,3}(?=[一-鿿])")
# Hiragana runs between kanji that are (or end with) these are grammar, not ruby:
# stripping them fabricates compounds (人の形 -> 人形) and poisons search
PARTICLES = ("の", "が", "を", "に", "で", "と", "は", "も", "や", "へ")


JUNK_IMG_REF = re.compile(r"^\[image\d+\]:\s*<")


def strip_binary_junk(text: str) -> str:
    """Blank out embedded-binary lines (base64 image defs from Google-Docs
    exports). Lines become "" — never deleted — so every line number in chunks
    and lint locations still matches the on-disk file."""
    out = []
    for line in text.split("\n"):
        s = line.strip()
        if (JUNK_IMG_REF.match(line)
                or (";base64," in line and len(line) > 500)
                or (len(s) > 300 and " " not in s)):
            out.append("")
        else:
            out.append(line)
    return "\n".join(out)


def sniff_lang(text: str) -> str:
    sample = text[:50000]
    kana = sum(1 for c in sample if "぀" <= c <= "ヿ")
    han = sum(1 for c in sample if "一" <= c <= "鿿")
    if han + kana < 50:
        return "en"
    if kana / (han + kana) > 0.10:
        return "jp"
    trad = sum(1 for c in sample if c in TRAD_HINT)
    simp = sum(1 for c in sample if c in SIMP_HINT)
    return "zh-t" if trad > simp else "zh-s"


def subtitle_key(s: str):
    if not s:
        return None
    s = unicodedata.normalize("NFKC", s).casefold()
    s = s.replace("’", "'").replace("‘", "'")
    s = re.sub(r"[－―‐—–]", "-", s)
    s = s.strip().strip("-").strip()
    s = re.sub(r"\s+", " ", s)
    return s or None


def _ruby_repl(m):
    run = m.group(0)
    if run in PARTICLES or (len(run) == 2 and run in ("から", "まで", "より")):
        return run  # Pure particle, keep
    for p in PARTICLES:
        if len(run) > 1 and run.endswith(p):
            return p  # Ruby reading followed by a particle: 鍋なべの中 -> 鍋の中
    return ""


def strip_ruby(text: str) -> str:
    return RUBY.sub(_ruby_repl, text)


def make_norm(text: str, lang: str):
    if lang == "jp":
        return strip_ruby(text)
    if lang == "zh-t":
        return trad2simp.to_simplified(text)
    return None


# ---------------------------------------------------------------- segmentation

def _paragraph_units(lines):
    """[(line_no_1based, text)] for non-blank lines; blank-run>=3 marks a scene boundary."""
    units, boundaries = [], set()
    blanks = 0
    for i, l in enumerate(lines, 1):
        if not l.strip():
            blanks += 1
            continue
        if blanks >= 3 and units:
            boundaries.add(len(units))
        if l.lstrip().startswith("　──") and units:
            boundaries.add(len(units))
        blanks = 0
        units.append((i, l.rstrip()))
    return units, boundaries


def _chunk(units, boundaries, max_chars=MAX_CHUNK):
    """Group consecutive units into chunks; never cross a boundary index."""
    chunks = []
    cur, cur_len = [], 0
    for idx, (ln, text) in enumerate(units):
        if cur and (idx in boundaries or cur_len + len(text) > max_chars):
            chunks.append(cur)
            cur, cur_len = [], 0
        cur.append((ln, text))
        cur_len += len(text)
    if cur:
        chunks.append(cur)
    return [
        dict(start_line=c[0][0], end_line=c[-1][0], text="\n".join(t for _, t in c))
        for c in chunks
    ]


def _toc_entries(lines, limit=800):
    """(entries, dup_positions): TOC-cluster entries plus body positions discovered
    when a chapter's body heading fell inside the cluster (duplicate title)."""
    raw = []
    for i, l in enumerate(lines[:limit]):
        one = ONE_LINE_ENTRY.match(l)
        if one:
            raw.append((i, one.group(1).strip(), one.group(2).strip()))
        elif SUBTITLE_LINE.match(l) and len(l.strip()) < 70:
            subtitle = l.strip().strip("-－―‐ 　").strip()
            title = None
            for j in range(i - 1, max(i - 4, -1), -1):
                prev = lines[j].strip()
                if prev:
                    m = BRACKET_TITLE.search(prev)
                    title = m.group(1) if m else prev
                    break
            raw.append((i, title, subtitle))
    # The TOC block is contiguous; a big gap means we've hit body headings proper
    kept = []
    for e in raw:
        if kept and e[0] - kept[-1][0] > 60:
            break
        kept.append(e)
    entries, dup_positions, seen = [], {}, {}
    for idx, title, subtitle in kept:
        k = (subtitle_key(title or "") or "", subtitle_key(subtitle or "") or "")
        if k in seen:
            dup_positions.setdefault(seen[k], idx)
        else:
            seen[k] = len(entries)
            entries.append((idx, title, subtitle))
    if len(entries) < 2:
        # A one-entry "TOC" is a stray body heading, not a contents block
        # (real TOC-less files would otherwise get a phantom chapter and their
        # opening prose mislabeled as frontmatter)
        return [], {}
    return entries, dup_positions


def _find_recurrences(lines, entries, dup_positions):
    """Match each TOC entry to its body occurrence. Title match wins (titles are
    unique even when subtitles repeat, e.g. EN promise/result A/B); subtitle-only
    fallback claims occurrences so repeated subtitles don't collide. No ordering
    assumption — some rips list TOC chapters out of reading order."""
    if not entries:
        return None
    cluster_end = max([entries[-1][0]] + list(dup_positions.values()))

    def norm(s):
        return subtitle_key(s) or ""

    occurrences = {}
    for i in range(cluster_end + 1, len(lines)):
        raw = lines[i].strip()
        if not raw or len(raw) > 90:
            continue
        m = BRACKET_TITLE.search(raw)
        key = norm(m.group(1)) if m else norm(raw)
        if key:
            occurrences.setdefault(key, []).append(i)

    positions, claimed = [], set()

    def claim(key):
        for i in occurrences.get(key, []):
            if i not in claimed:
                claimed.add(i)
                return i
        return None

    for n, (_, title, subtitle) in enumerate(entries):
        if n in dup_positions:
            positions.append(dup_positions[n])
            continue
        found = claim(norm(title or "")) if title else None
        if found is None and subtitle:
            found = claim(norm(subtitle))
        positions.append(found)
    hit = [p for p in positions if p is not None]
    if len(hit) >= max(2, int(0.6 * len(entries))):
        return positions
    return None


def segment_txt(text, lang):
    """-> (chapters, chunks). Chapter dicts: ord, title, subtitle, start_line(1b)|None."""
    lines = text.splitlines()

    markers = [(i, VOL_MARKER.match(l).group(1))
               for i, l in enumerate(lines) if VOL_MARKER.match(l)]
    chapters = []
    if len(markers) >= 3:
        for ord_, (i, rest) in enumerate(markers):
            m = BRACKET_TITLE.search(rest)
            title = m.group(1) if m else rest.split("-")[0].strip()
            sm = re.search(r"-([A-Za-z][^-]*)-\s*$", rest)
            chapters.append(dict(ord=ord_, title=title,
                                 subtitle=sm.group(1).strip() if sm else None,
                                 start_line=i + 1))
    else:
        entries, dup_positions = _toc_entries(lines)
        positions = _find_recurrences(lines, entries, dup_positions) if entries else None
        if positions:
            for ord_, ((_, title, subtitle), pos) in enumerate(zip(entries, positions)):
                chapters.append(dict(ord=ord_, title=title, subtitle=subtitle,
                                     start_line=(pos + 1) if pos is not None else None))
        else:
            # Volume granularity: keep TOC titles as metadata without ranges
            for ord_, (_, title, subtitle) in enumerate(entries):
                chapters.append(dict(ord=ord_, title=title, subtitle=subtitle,
                                     start_line=None))

    units, boundaries = _paragraph_units(lines)
    starts = sorted([c["start_line"] for c in chapters if c["start_line"]])
    for idx, (ln, _) in enumerate(units):
        if ln in starts:
            boundaries.add(idx)
    chunks = _chunk(units, boundaries)

    # Reading order = located position, not TOC listing order (some rips scramble it)
    chapters.sort(key=lambda c: (c["start_line"] is None, c["start_line"] or 0))
    for ord_, c in enumerate(chapters):
        c["ord"] = ord_
    located = [c for c in chapters if c["start_line"]]
    located.sort(key=lambda c: c["start_line"])
    for c in chapters:
        c["end_line"] = None
    for a, b in zip(located, located[1:]):
        a["end_line"] = b["start_line"] - 1
    if located:
        located[-1]["end_line"] = len(lines)

    def chapter_at(line):
        cur = None
        for c in located:
            if c["start_line"] <= line:
                cur = c
            else:
                break
        return cur

    first_start = located[0]["start_line"] if located else None
    toc_end_line = (chapters and not located) and _toc_end_line(lines) or None
    for ch in chunks:
        c = chapter_at(ch["start_line"])
        ch["chapter_ord"] = c["ord"] if c else None
        if c and c.get("title") and AFTERWORD.search(c["title"]):
            ch["kind"] = "afterword"
        elif first_start and ch["start_line"] < first_start:
            ch["kind"] = "frontmatter"
        elif toc_end_line and ch["start_line"] <= toc_end_line:
            ch["kind"] = "frontmatter"
        else:
            ch["kind"] = "body"
    return chapters, chunks


def _toc_end_line(lines):
    entries, _ = _toc_entries(lines)
    return entries[-1][0] + 1 if entries else None


_volume_cfg_cache = {}


def _volume_config(volume: str):
    key = volume
    if key not in _volume_cfg_cache:
        p = REPO / f"Volumes/Volume_{volume}/config.yaml"
        try:
            _volume_cfg_cache[key] = yaml.safe_load(p.read_text(encoding="utf-8"))
        except OSError:
            _volume_cfg_cache[key] = None
    return _volume_cfg_cache[key]


def segment_fan_md(text, volume, chapter_label):
    cfg = _volume_config(volume)
    title = subtitle = part_title = None
    if cfg:
        try:
            nums = [int(x) for x in chapter_label.split(".")]
            ch = cfg["chapters"][nums[0] - 1]
            title, subtitle = ch.get("title"), ch.get("subtitle")
            if len(nums) > 1 and ch.get("parts"):
                part_title = ch["parts"][nums[1] - 1].get("title")
        except (KeyError, IndexError, ValueError):
            pass
    lines = text.splitlines()
    units, boundaries = _paragraph_units(lines)
    keep, drop_scene = [], set()
    for idx, (ln, t) in enumerate(units):
        if SCENE_MD.match(t):
            drop_scene.add(idx)
    filtered, fboundaries = [], set()
    for idx, u in enumerate(units):
        if idx in drop_scene:
            fboundaries.add(len(filtered))
            continue
        if idx in boundaries:
            fboundaries.add(len(filtered))
        filtered.append(u)
    chunks = _chunk(filtered, fboundaries)
    n_lines = len(lines)
    chapters = [dict(ord=0, title=title, subtitle=subtitle, part_title=part_title,
                     start_line=1, end_line=n_lines)]
    for ch in chunks:
        ch["chapter_ord"] = 0
        ch["kind"] = "body"
    return chapters, chunks


def segment_md(text):
    """raw drafts / notes / docs: markdown headings as chapter rows + boundaries."""
    lines = text.splitlines()
    units, boundaries = _paragraph_units(lines)
    chapters = []
    for idx, (ln, t) in enumerate(units):
        m = MD_HEADING.match(t)
        if m:
            title = re.sub(r"[*_`#]", "", m.group(2)).strip()
            chapters.append(dict(ord=len(chapters), title=title, subtitle=None,
                                 start_line=ln))
            boundaries.add(idx)
    for a, b in zip(chapters, chapters[1:]):
        a["end_line"] = b["start_line"] - 1
    if chapters:
        chapters[-1]["end_line"] = len(lines)
    chunks = _chunk(units, boundaries)

    def chapter_at(line):
        cur = None
        for c in chapters:
            if c["start_line"] <= line:
                cur = c
            else:
                break
        return cur

    for ch in chunks:
        c = chapter_at(ch["start_line"])
        ch["chapter_ord"] = c["ord"] if c else None
        ch["kind"] = "body"
    return chapters, chunks


# ------------------------------------------------------------------- indexing

def scan_disk():
    seen = {}
    for pattern in INCLUDE_GLOBS:
        for p in CORPUS.glob(pattern):
            if not p.is_file():
                continue
            rel = p.relative_to(CORPUS).as_posix()
            meta = classify(rel)
            if meta is None:
                continue
            st = p.stat()
            seen[rel] = dict(meta, path=rel, mtime=st.st_mtime, size=st.st_size)
    return seen


def index_file(conn, meta, text, sha):
    rel = meta["path"]
    lang = meta["lang"] or sniff_lang(text)
    old = conn.execute("SELECT id FROM files WHERE path=?", (rel,)).fetchone()
    if old:
        conn.execute("DELETE FROM chunks WHERE file_id=?", (old["id"],))
        conn.execute("DELETE FROM chapters WHERE file_id=?", (old["id"],))
        conn.execute("DELETE FROM files WHERE id=?", (old["id"],))

    cur = conn.execute(
        "INSERT INTO files(path, source, lang, series, volume, mtime, size, sha256, indexed_at)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        (rel, meta["source"], lang, meta["series"], meta["volume"],
         meta["mtime"], meta["size"], sha, time.time()))
    file_id = cur.lastrowid

    if meta["source"] in ("raw", "inbox"):
        text = strip_binary_junk(text)

    if meta["source"] == "fan":
        chapters, chunks = segment_fan_md(text, meta["volume"], meta["chapter_label"])
        for c in chapters:
            c["chapter_label"] = meta["chapter_label"]
    elif rel.endswith(".md") or meta["source"] in ("notes", "docs"):
        chapters, chunks = segment_md(text)
        for c in chapters:
            c["chapter_label"] = None
    else:
        chapters, chunks = segment_txt(text, lang)
        for c in chapters:
            c["chapter_label"] = None

    ord_to_id = {}
    for c in chapters:
        cur = conn.execute(
            "INSERT INTO chapters(file_id, ord, chapter_label, title, subtitle,"
            " subtitle_key, part_title, start_line, end_line) VALUES (?,?,?,?,?,?,?,?,?)",
            (file_id, c["ord"], c.get("chapter_label"), c.get("title"), c.get("subtitle"),
             subtitle_key(c.get("subtitle") or ""), c.get("part_title"),
             c.get("start_line"), c.get("end_line")))
        ord_to_id[c["ord"]] = cur.lastrowid

    for i, ch in enumerate(chunks):
        conn.execute(
            "INSERT INTO chunks(file_id, chapter_id, ord, kind, lang, start_line,"
            " end_line, text, text_norm) VALUES (?,?,?,?,?,?,?,?,?)",
            (file_id, ord_to_id.get(ch.get("chapter_ord")), i, ch.get("kind", "body"),
             lang, ch["start_line"], ch["end_line"], ch["text"],
             make_norm(ch["text"], lang)))


def ensure_fresh(conn=None, force=False):
    """Stat-scan; reindex changed files; drop deleted ones. Returns #files reindexed."""
    conn = conn or connect()
    _volume_cfg_cache.clear()
    disk = scan_disk()
    dbf = {r["path"]: r for r in conn.execute(
        "SELECT id, path, mtime, size, sha256 FROM files")}
    changed = 0
    for rel, meta in disk.items():
        row = dbf.pop(rel, None)
        if row and not force and row["mtime"] == meta["mtime"] and row["size"] == meta["size"]:
            continue
        data = (CORPUS / rel).read_bytes()
        sha = hashlib.sha256(data).hexdigest()
        if row and not force and row["sha256"] == sha:
            conn.execute("UPDATE files SET mtime=?, size=? WHERE id=?",
                         (meta["mtime"], meta["size"], row["id"]))
            continue
        index_file(conn, meta, data.decode("utf-8", errors="replace"), sha)
        changed += 1
    for rel, row in dbf.items():
        conn.execute("DELETE FROM chunks WHERE file_id=?", (row["id"],))
        conn.execute("DELETE FROM chapters WHERE file_id=?", (row["id"],))
        conn.execute("DELETE FROM files WHERE id=?", (row["id"],))
        changed += 1
    conn.execute("INSERT OR REPLACE INTO meta(k, v) VALUES ('last_scan_at', ?)",
                 (str(time.time()),))
    conn.commit()
    return changed
