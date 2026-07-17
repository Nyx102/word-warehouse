"""FTS query routing (EN vs CJK, trigram vs LIKE fallback) and result shaping."""

import re

from db import connect
from indexer import ensure_fresh

CJK = re.compile(r"[぀-ヿ一-鿿㐀-䶿]")

BASE_SELECT = """
SELECT c.id AS chunk_id, c.kind, c.lang AS chunk_lang, c.start_line, c.end_line,
       f.path, f.source, f.lang, f.series, f.volume,
       ch.chapter_label, ch.title AS chapter_title, ch.subtitle, ch.part_title,
       {snippet} AS snippet
FROM {fts} JOIN chunks c ON c.id = {fts}.rowid
JOIN files f ON f.id = c.file_id
LEFT JOIN chapters ch ON ch.id = c.chapter_id
WHERE {fts} MATCH ?
"""


def _filters(lang, series, source, kind):
    conds, params = [], []
    if lang:
        if lang == "zh":
            conds.append("f.lang IN ('zh-s','zh-t')")
        else:
            conds.append("f.lang = ?" if lang != "en" else "f.lang = 'en'")
            if lang != "en":
                params.append(lang)
    if series:
        conds.append("f.series = ?")
        params.append(int(series))
    if source:
        conds.append("f.source = ?")
        params.append(source)
    if kind and kind != "all":
        conds.append("c.kind = ?")
        params.append(kind)
    return ("".join(" AND " + c for c in conds), params)


def _quote_fts(q: str, phrase: bool) -> str:
    if phrase:
        return '"' + q.replace('"', '""') + '"'
    toks = [t for t in re.split(r"\s+", q.strip()) if t]
    return " ".join('"' + t.replace('"', '""') + '"' for t in toks)


def search(q, lang=None, series=None, source=None, kind=None, limit=20, fresh=True):
    conn = connect()
    if fresh:
        ensure_fresh(conn)
    cjk_chars = CJK.findall(q)
    route = "cjk" if cjk_chars else "en"
    extra, params = _filters(lang, series, source, kind)

    if route == "cjk" and len("".join(cjk_chars)) < 3:
        like = f"%{q.strip()}%"
        sql = """
SELECT c.id AS chunk_id, c.kind, c.lang AS chunk_lang, c.start_line, c.end_line,
       f.path, f.source, f.lang, f.series, f.volume,
       ch.chapter_label, ch.title AS chapter_title, ch.subtitle, ch.part_title,
       substr(c.text, max(1, instr(c.text, ?) - 40), 120) AS snippet
FROM chunks c JOIN files f ON f.id = c.file_id
LEFT JOIN chapters ch ON ch.id = c.chapter_id
WHERE (c.text LIKE ? OR c.text_norm LIKE ?)""" + extra + " LIMIT ?"
        rows = conn.execute(sql, [q.strip(), like, like, *params, limit]).fetchall()
        return [dict(r) for r in rows]

    if route == "cjk":
        fts, match = "fts_cjk", _quote_fts(q.strip(), phrase=True)
        # column 0 (raw text) only: column -1 could render the normalized
        # shadow column, showing ruby-stripped fabrications as if corpus text
        snippet = "snippet(fts_cjk, 0, '>>', '<<', '…', 30)"
        order = "rank"
    else:
        fts, match = "fts_en", _quote_fts(q, phrase=False)
        snippet = "snippet(fts_en, 0, '>>', '<<', '…', 14)"
        order = "rank"
    sql = BASE_SELECT.format(fts=fts, snippet=snippet) + extra + \
        f" ORDER BY {order} LIMIT ?"
    rows = conn.execute(sql, [match, *params, limit]).fetchall()
    return [dict(r) for r in rows]


def count_by_source(q):
    """Occurrence counts (chunks) per source for a term; en+cjk routed like search()."""
    conn = connect()
    cjk = bool(CJK.search(q))
    fts = "fts_cjk" if cjk else "fts_en"
    match = _quote_fts(q.strip(), phrase=cjk)
    sql = f"""
SELECT f.source, f.lang, count(*) AS n FROM {fts}
JOIN chunks c ON c.id = {fts}.rowid JOIN files f ON f.id = c.file_id
WHERE {fts} MATCH ? GROUP BY f.source, f.lang ORDER BY n DESC"""
    try:
        return [dict(r) for r in conn.execute(sql, [match]).fetchall()]
    except Exception:
        return []


def context(chunk_id, before=2, after=2):
    conn = connect()
    row = conn.execute(
        "SELECT c.*, f.path FROM chunks c JOIN files f ON f.id=c.file_id WHERE c.id=?",
        (chunk_id,)).fetchone()
    if not row:
        return None
    neighbors = conn.execute(
        "SELECT * FROM chunks WHERE file_id=? AND ord BETWEEN ? AND ? ORDER BY ord",
        (row["file_id"], row["ord"] - before, row["ord"] + after)).fetchall()
    return dict(row=dict(row), neighbors=[dict(n) for n in neighbors])


def align(series, volume=None):
    """Chapter rows for all files of a series[/volume], for the alignment matrix."""
    conn = connect()
    ensure_fresh(conn)
    sql = """
SELECT f.path, f.source, f.lang, f.volume, ch.ord, ch.chapter_label,
       ch.title, ch.subtitle, ch.subtitle_key, ch.part_title, ch.start_line, ch.end_line
FROM chapters ch JOIN files f ON f.id = ch.file_id
WHERE f.series = ?"""
    params = [int(series)]
    if volume:
        sql += " AND f.volume = ?"
        params.append(str(volume).zfill(2) if str(volume).isdigit() else volume)
    sql += " ORDER BY f.volume, f.source, f.path, ch.ord"
    return [dict(r) for r in conn.execute(sql, params).fetchall()]
