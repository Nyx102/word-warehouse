#!/usr/bin/env python3
"""Live-data check that per-flag regression fixes equal a replacement-script run.

Two properties, both over the real finished prose:

1. No rule's match set changes between the pristine file (what check_regression
   sees) and the file as of that rule's turn in the apply_rules pipeline (what
   the script sees). Order-sensitive rules would break this.
2. Applying every regression flag's fix, one flag at a time, reproduces
   apply_rules output byte for byte.
3. Every nearmiss fix lands on a canonical term: re-running the whole rule set
   over the fixed text leaves the repaired spans alone. A fix that stopped at
   the fan term it near-missed would fail this.

Read-only: nothing is written to the corpus.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.config import CORPUS, RULES_YAML, SCRIPTS_DIR  # noqa: E402
from backend.lint import checker, fixer  # noqa: E402

sys.path.insert(0, str(SCRIPTS_DIR))
import regex_replace  # noqa: E402

rules = regex_replace.load_rules(RULES_YAML)
files = sorted(CORPUS.glob("worldend2/repo/Volumes/Volume_*/Text/*.md"))
print(f"{len(rules)} rules, {len(files)} finished files")

order_bad = []
mismatch = []
fixed_files = 0
fixed_flags = 0

for f in files:
    rel = f.relative_to(CORPUS).as_posix()
    original = f.read_text(encoding="utf-8")

    # Property 1
    text = original
    for idx, rule in enumerate(rules, start=1):
        try:
            pattern = rule.pattern()
        except Exception:
            continue

        def live(t):
            repl = regex_replace.make_replacement_function(rule, t)
            return sorted(m.group(0) for m in pattern.finditer(t)
                          if repl(m) != m.group(0))

        if live(original) != live(text):
            order_bad.append((rel, idx, rule.find))
        text = pattern.sub(regex_replace.make_replacement_function(rule, text), text)
    script_out = text

    # Property 2
    flags = [fl for fl in checker.check_regression(original, rel)]
    patched = original
    for fl in flags:
        try:
            edits, _ = fixer._regression_edits(patched, fl["key"])
        except fixer.Unfixable as e:
            mismatch.append((rel, f"unfixable {fl['key']!r}: {e}"))
            continue
        if not edits:
            mismatch.append((rel, f"no edits for flagged {fl['key']!r}"))
            continue
        patched = fixer._splice(patched, edits)
        fixed_flags += 1
    if flags:
        fixed_files += 1
    if patched != script_out:
        mismatch.append((rel, "fixed text != apply_rules output"))

print(f"regression flags fixed: {fixed_flags} across {fixed_files} file(s)")

# Property 3: nearmiss fixes must land on a canonical term. Raw drafts carry
# most of these, so the sweep covers everything the linter targets.
stalled = []
nm_fixed = 0
for rel in checker.lint_targets():
    try:
        original = (CORPUS / rel).read_text(encoding="utf-8")
    except OSError:
        continue
    for fl in checker.check_nearmiss(original, rel):
        try:
            edits, _ = fixer._nearmiss_edits(original, fl["key"])
        except fixer.Unfixable:
            continue
        if not edits:
            continue
        nm_fixed += 1
        patched = fixer._splice(original, edits)
        settled, _, _ = regex_replace.apply_rules(patched, rules, rel)
        for start, end, written in edits:
            if written and written not in settled:
                stalled.append((rel, f"{fl['key']!r} -> {written!r} is not canonical"))
                break

print(f"nearmiss flags fixed: {nm_fixed}")
print(f"non-canonical nearmiss targets: {len(stalled)}")
for rel, why in stalled[:10]:
    print(f"  {rel}: {why}")
print(f"order divergences: {len(order_bad)}")
for row in order_bad[:10]:
    print(f"  {row}")
print(f"mismatches: {len(mismatch)}")
for rel, why in mismatch[:20]:
    print(f"  {rel}: {why}")
sys.exit(1 if order_bad or mismatch or stalled else 0)
