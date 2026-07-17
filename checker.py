"""Consistency lint: what the replacement script CANNOT catch.

- nearmiss: a token close to (but not exactly) a known fan/official term —
  a misspelled fan term the script will silently skip in a raw draft, or a
  misspelled official term in finished prose. High precision via an
  official-EN word whitelist built from the index.
- regression: a replacement-rule `find` still matching finished prose. Exact:
  a match is only a regression if the rule would actually rewrite it there
  (sentence_aware / preserve_case / no-op cases are simulated, not guessed).

Dismissals are global per (category, key) — stable across edits and renames.
"""

import re
import sys
import time
from collections import defaultdict

from config import CORPUS, RULES_YAML, SCRIPTS_DIR
from db import connect
from indexer import ensure_fresh

sys.path.insert(0, str(SCRIPTS_DIR))
import regex_replace  # noqa: E402  (the fan repo's own engine — imported, not forked)

WORD = re.compile(r"[A-Za-z][A-Za-z']{3,}")
MIN_LEN = 4

_cache = {}


def _rules():
    if "rules" not in _cache:
        _cache["rules"] = regex_replace.load_rules(RULES_YAML)
    return _cache["rules"]


def _deregex(s: str) -> str:
    """Recover plain words from simple rule regexes; expands two-way char
    classes and alternations into BOTH variants ([Ff]airy -> Fairy fairy,
    Ayrantro(b|p)os -> Ayrantrobos Ayrantropos), strips \\b and (?!...)."""
    variants = [s]
    for pat in (r"\[([A-Za-z])([A-Za-z])\]", r"\((\w)\|(\w)\)"):
        expanded = []
        for v in variants:
            expanded.append(re.sub(pat, r"\1", v))
            if re.search(pat, v):
                expanded.append(re.sub(pat, r"\2", v))
        variants = expanded
    out = " ".join(variants)
    out = re.sub(r"\(\?<?[!=][^)]*\)", " ", out)
    out = re.sub(r"\\[a-zA-Z]", " ", out)
    return out


def _vocab():
    """Distinct words (len>=MIN_LEN) drawn from every rule's find and replace.

    Words on the `replace` side are the canonical official terms — tracked
    separately: they always deserve fuzzy (misspelling) detection, no matter
    how ordinary they look."""
    if "vocab" not in _cache:
        words, replace_words = set(), set()
        for r in _rules():
            for s, is_replace in ((r.find, False), (r.replace, True)):
                for w in WORD.findall(_deregex(s) if r.regex else s):
                    if len(w) >= MIN_LEN:
                        words.add(w)
                        if is_replace:
                            replace_words.add(w.casefold())
        _cache["vocab"] = words
        _cache["vocab_cf"] = {w.casefold() for w in words}
        _cache["replace_cf"] = replace_words
    return _cache["vocab"], _cache["vocab_cf"]


def _whitelist():
    """Casefolded real-word set: the official EN translation, plus the system
    dictionary when installed (apt install wamerican) — picked up automatically."""
    if "whitelist" not in _cache:
        conn = connect()
        words = set()
        for row in conn.execute(
                "SELECT c.text FROM chunks c JOIN files f ON f.id=c.file_id"
                " WHERE f.source='official'"):
            for w in WORD.findall(row["text"]):
                words.add(w.casefold())
        try:
            with open("/usr/share/dict/words", encoding="utf-8") as fh:
                _, vocab_cf = _vocab()
                for line in fh:
                    w = line.strip().casefold()
                    if len(w) >= MIN_LEN and w not in vocab_cf:
                        words.add(w)
        except OSError:
            pass
        _cache["whitelist"] = words
    return _cache["whitelist"]


def _dismissed(conn):
    return {(r["category"], r["key"]) for r in
            conn.execute("SELECT category, key FROM flag_dismissals")}


def osa_distance_leq(a, b, k):
    """Optimal-string-alignment distance (transposition costs 1); True if <= k."""
    la, lb = len(a), len(b)
    if abs(la - lb) > k:
        return False
    prev2, prev = None, list(range(lb + 1))
    for i in range(1, la + 1):
        cur = [i] + [k + 1] * lb
        for j in range(max(1, i - k), min(lb, i + k) + 1):
            cost = a[i - 1] != b[j - 1]
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                cur[j] = min(cur[j], prev2[j - 2] + 1)
        if min(cur) > k:
            return False
        prev2, prev = prev, cur
    return prev[lb] <= k


SUFFIXES = ("'s", "s'", "es", "s", "ly", "en")


def _fold_suffix(base, vocab_cf):
    cf = base.casefold()
    if cf in vocab_cf:
        return cf
    for suf in SUFFIXES:
        if cf.endswith(suf) and len(cf) - len(suf) >= MIN_LEN and \
                cf[:-len(suf)] in vocab_cf:
            return cf[:-len(suf)]
    return None


def _vocab_buckets():
    """first-letter -> [(word, word_cf, is_capitalized)] for prefiltering.

    A vocab word is excluded from fuzzy matching only when it is ordinary
    vocabulary (whitelist) appearing solely inside `find` patterns (Flowing,
    Trading, …) — near-missing those drowns signal in real-word collisions.
    Words on any rule's `replace` side are canonical official terms and always
    keep fuzzy matching, however ordinary they look. Fully derived from
    replacements.yaml — nothing hardcoded."""
    if "buckets" not in _cache:
        vocab, _ = _vocab()
        replace_cf = _cache["replace_cf"]
        whitelist = _whitelist()
        buckets = defaultdict(list)
        for w in vocab:
            cf = w.casefold()
            if cf in whitelist and cf not in replace_cf:
                continue
            buckets[w[0].casefold()].append((w, cf, w[0].isupper()))
        _cache["buckets"] = buckets
    return _cache["buckets"]


_token_verdicts = {}


def _match_token(base):
    """-> closest vocab word or None. Cached globally; tokens repeat everywhere.

    Policy (tuned on the real corpus for precision):
    - exact vocab membership, incl. plural/adverb suffix folds, is NOT a near-miss
    - candidate must share the first letter (typos virtually never change it)
    - a lowercase token cannot be a typo of a Capitalized proper-noun term
    - lowercase-vs-lowercase pairs only match at OSA distance 1 (common English
      words sit distance-2 from each other constantly; transpositions still count)
    - Capitalized tokens: distance 1 (len<=6) or 2 (len>=7)
    """
    if base in _token_verdicts:
        return _token_verdicts[base]
    vocab, vocab_cf = _vocab()
    whitelist = _whitelist()
    cf = base.casefold()
    verdict = None
    if _fold_suffix(base, vocab_cf) is None and cf not in whitelist:
        tok_cap = base[0].isupper()
        k_cap = 1 if len(cf) <= 6 else 2
        for w, wcf, w_cap in _vocab_buckets().get(cf[0], ()):
            if w_cap and not tok_cap:
                continue
            k = k_cap if (tok_cap and w_cap) else 1
            if osa_distance_leq(cf, wcf, k):
                verdict = w
                break
    _token_verdicts[base] = verdict
    return verdict


def check_nearmiss(text, rel):
    occurrences = defaultdict(list)
    for ln, line in enumerate(text.splitlines(), 1):
        for m in WORD.finditer(line):
            base = m.group(0)
            base = base[:-2] if base.endswith("'s") else base
            base = base.rstrip("'")
            if len(base) >= MIN_LEN:
                occurrences[base].append((ln, line))
    out = []
    for base, occ in sorted(occurrences.items()):
        closest = _match_token(base)
        if closest is None:
            continue
        locations = [dict(path=rel, line=ln, snippet=line.strip()[:90])
                     for ln, line in occ[:5]]
        out.append(dict(category="nearmiss", key=base, closest=closest,
                        count=len(occ), locations=locations))
    return out


def check_regression(text, rel):
    flags = []
    for idx, rule in enumerate(_rules(), 1):
        try:
            pattern = rule.pattern()
        except re.error:
            continue
        repl = regex_replace.make_replacement_function(rule, text)
        by_match = defaultdict(lambda: dict(count=0, locations=[]))
        for m in pattern.finditer(text):
            try:
                if repl(m) == m.group(0):
                    continue  # rule is a no-op here (e.g. correct sentence case)
            except re.error:
                continue
            key = m.group(0)[:40]
            ln = text.count("\n", 0, m.start()) + 1
            h = by_match[key]
            h["count"] += 1
            if len(h["locations"]) < 5:
                ls = text.rfind("\n", 0, m.start()) + 1
                le = text.find("\n", m.start())
                snippet = text[ls:le if le != -1 else ls + 90].strip()[:90]
                h["locations"].append(dict(path=rel, line=ln, snippet=snippet))
        for key, h in by_match.items():
            flags.append(dict(category="regression", key=f"{idx}:{key}",
                              rule=idx, find=rule.find, replace=rule.replace,
                              manual=rule.manual, matched=key, count=h["count"],
                              locations=h["locations"]))
    return flags


def lint_targets(path=None):
    """Files to lint: raw drafts (nearmiss) and finished fan prose (both)."""
    if path:
        p = CORPUS / path
        if p.is_dir():
            return [q.relative_to(CORPUS).as_posix()
                    for q in sorted(p.rglob("*")) if q.suffix in (".md", ".txt")]
        return [path]
    targets = [p.relative_to(CORPUS).as_posix()
               for p in sorted(CORPUS.glob("raw/*")) if p.suffix in (".md", ".txt")]
    targets += [p.relative_to(CORPUS).as_posix()
                for p in sorted(CORPUS.glob("worldend2/repo/Volumes/Volume_*/Text/*.md"))]
    return targets


def lint(path=None, include_dismissed=False):
    ensure_fresh()
    conn = connect()
    dismissed = _dismissed(conn)
    out = []
    for rel in lint_targets(path):
        try:
            text = (CORPUS / rel).read_text(encoding="utf-8")
        except OSError:
            continue
        is_finished = rel.startswith("worldend2/repo/")
        flags = check_nearmiss(text, rel)
        if is_finished:
            flags += check_regression(text, rel)
        if include_dismissed:
            for f in flags:
                if (f["category"], f["key"]) in dismissed:
                    f["dismissed"] = True
        else:
            flags = [f for f in flags if (f["category"], f["key"]) not in dismissed]
        if flags:
            out.append(dict(path=rel, flags=flags))
    return dict(generated_at=time.time(), files=out,
                total=sum(len(f["flags"]) for f in out))


def dismiss(category, key):
    conn = connect()
    conn.execute(
        "INSERT OR REPLACE INTO flag_dismissals(content_sha256, category, key,"
        " dismissed_at) VALUES ('*', ?, ?, ?)", (category, key, time.time()))
    conn.commit()


def undismiss(category, key):
    conn = connect()
    conn.execute("DELETE FROM flag_dismissals WHERE category=? AND key=?",
                 (category, key))
    conn.commit()


def cli_lint(path=None, verbose=False):
    report = lint(path)
    if not report["files"]:
        print("clean — no flags")
        return
    for f in report["files"]:
        print(f"== {f['path']}")
        for fl in f["flags"]:
            if fl["category"] == "nearmiss":
                print(f"  nearmiss  {fl['key']!r} ~ {fl['closest']!r}  ×{fl['count']}")
            else:
                man = " [manual-rule]" if fl.get("manual") else ""
                print(f"  regression rule{fl['rule']} {fl['find']!r}->{fl['replace']!r}"
                      f" matched {fl['matched']!r} ×{fl['count']}{man}")
            if verbose:
                for loc in fl["locations"]:
                    print(f"      {loc['path']}:{loc['line']}: {loc['snippet']}")
    print(f"\n{report['total']} flag(s) across {len(report['files'])} file(s)")
