"""One-click flag fixes.

regression: exact. The flag's own rule is re-run over the file and only the
matches the checker flagged are rewritten, through the fan repo's own
`make_replacement_function`. `manual: true` rules are fixable like any other:
the script rewrites those too and only additionally logs them for a human.

Caveat: `apply_rules` is an ordered pipeline (each rule sees the previous
rule's output) while the checker runs every rule against the pristine file.
Fixing one flag is therefore only equal to a script run while no two rules
overlap. On the current rule set none do, so this holds; `scripts/verify_fixer.py`
is the check.

nearmiss: a suggestion. The flagged token is swapped for the vocab word it
near-missed, whole-word and case-exact, everywhere in that file, and then
carried through the rules by `checker.canonicalize`: the near-missed word is
usually a FAN term, so stopping at it would just leave a leftover for the
script to convert later. Fuzzy matching picked that word, so the caller must
treat this as a proposal, not a fix.
"""

import re

from backend.config import CORPUS
from backend.lint import checker


class Unfixable(Exception):
    pass


def _read(rel):
    f = CORPUS / rel
    if not f.is_file():
        raise Unfixable(f"no such file: {rel}")
    return f, f.read_text(encoding="utf-8")


def _splice(text, edits):
    """edits = [(start, end, replacement)] in ascending, non-overlapping order."""
    out, pos = [], 0
    for start, end, repl in edits:
        out.append(text[pos:start])
        out.append(repl)
        pos = end
    out.append(text[pos:])
    return "".join(out)


def _regression_edits(text, key):
    idx_s, _, matched = key.partition(":")
    rules = checker._rules()
    try:
        rule = rules[int(idx_s) - 1]
    except (ValueError, IndexError):
        raise Unfixable(f"unknown rule in key {key!r}")
    try:
        pattern = rule.pattern()
    except re.error as e:
        raise Unfixable(f"rule {idx_s} does not compile: {e}")
    repl = checker.regex_replace.make_replacement_function(rule, text)
    edits = []
    for m in pattern.finditer(text):
        if m.group(0)[:40] != matched:
            continue
        try:
            new = repl(m)
        except re.error:
            continue
        if new != m.group(0):
            edits.append((m.start(), m.end(), new))
    return edits, f"{rule.find} -> {rule.replace}"


def _nearmiss_edits(text, key):
    closest = checker._match_token(key)
    if not closest:
        raise Unfixable(f"{key!r} no longer near-misses any glossary term")
    pattern = re.compile(r"(?<![A-Za-z])" + re.escape(key) + r"(?![A-Za-z])")
    edits = [(m.start(), m.end(),
              checker.canonicalize(closest, text, m.start(), m.end()))
             for m in pattern.finditer(text)]
    return edits, f"{key} -> {checker.canonical_term(closest)}"


def preview(path, category, key):
    """-> dict(count, change) without touching disk."""
    _, text = _read(path)
    edits, change = (_regression_edits(text, key) if category == "regression"
                     else _nearmiss_edits(text, key))
    return dict(count=len(edits), change=change)


def apply(path, category, key):
    """Rewrite every occurrence this flag covers in one file. Atomic."""
    if category not in ("regression", "nearmiss"):
        raise Unfixable(f"unknown flag category: {category}")
    f, text = _read(path)
    edits, change = (_regression_edits(text, key) if category == "regression"
                     else _nearmiss_edits(text, key))
    if not edits:
        raise Unfixable("nothing left to fix here; re-run the lint")
    new_text = _splice(text, edits)
    tmp = f.with_suffix(f.suffix + ".tmp~")
    tmp.write_text(new_text, encoding="utf-8")
    tmp.replace(f)
    return dict(ok=True, path=path, count=len(edits), change=change)
