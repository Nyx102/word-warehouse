"""AI flag triage: a cheap model (haiku) judges lint flags from local context.

Conservative by contract: a flag is cleared ONLY when the model is certain the
flagged text is intentional (pronunciation contrasts, stylized speech, quotes).
The model may answer `need_more` to request a wider context window — escalation
is bounded (±2 → ±10 → ±30 lines); after that the flag is kept for the human.
Verdicts are cached by context hash: unchanged text is never re-judged.
Credits: one haiku call per batch of 8 flags, one-time per context state.
"""

import hashlib
import json
import os
import subprocess
import threading
import time

from backend.config import CORPUS, DATA
from backend.db import connect

BATCH = 8
RADII = (2, 10, 30)
CTX_CAPS = {2: 1500, 10: 4000, 30: 9000}
TIMEOUT = 240
BACKOFF_S = 600

INSTRUCTIONS = """You are auditing consistency-lint flags for an English fan \
translation of a light novel. Each item flags text that fuzzy-matches a known \
glossary term (nearmiss) or still matches a fan-term replacement rule \
(regression). Judge each item INDEPENDENTLY from its context lines only.

Verdict rules:
- "clear": ONLY when you are certain the flagged text is intentional and \
correct in context — e.g. a pronunciation/spelling explanation deliberately \
contrasting two forms, stylized/elongated ORDINARY words, a direct quotation, \
or an intentional pun. NEVER clear a stylized, elongated, or otherwise altered \
form of a NAME or glossary term (e.g. an elongated scream of a character's \
name): whether a name variant is deliberate or a typo always needs the human's \
eye — answer "keep" for those.
- "need_more": the given lines are genuinely insufficient to decide and more \
surrounding text would settle it.
- "keep": everything else — plausible typo, inconsistent terminology, or any \
uncertainty. When in doubt, keep.

Do not use any tools. Respond with ONLY a JSON array, no prose, no code \
fences: [{"id": <n>, "verdict": "keep"|"clear"|"need_more", "reason": "<one \
line>"}]

Items:
"""

_worker_lock = threading.Lock()
_worker_running = False
_last_failure = 0.0
_last_error = None  # Short message from the most recent failed batch (surfaced in the UI)


def _claude_bin():
    from backend.adapters.chat import CLAUDE_BIN  # Lazy: resolve the CLI at call time, not import
    return CLAUDE_BIN


def _context_for(flag, radius):
    parts = []
    for loc in flag.get("locations", [])[:5]:
        try:
            lines = (CORPUS / loc["path"]).read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        ln = min(max(loc["line"], 1), len(lines))
        a, b = max(1, ln - radius), min(len(lines), ln + radius)
        seg = "\n".join(
            ("»" if i == ln else " ") + " " + lines[i - 1]
            for i in range(a, b + 1))
        parts.append(f"{loc['path']}:{ln}\n{seg}")
    return "\n---\n".join(parts)[:CTX_CAPS[radius]]


def _flag_info(flag):
    if flag["category"] == "nearmiss":
        return dict(flagged=flag["key"], known_term=flag.get("closest"))
    return dict(matched=flag.get("matched"),
                rule=f"{flag.get('find')} -> {flag.get('replace')}")


PROMPT_VERSION = "2"  # Bump on INSTRUCTIONS changes: re-judges everything


def _base_hash(flag):
    basis = "|".join((PROMPT_VERSION, flag["category"], flag["key"],
                      json.dumps(_flag_info(flag), sort_keys=True),
                      _context_for(flag, RADII[0])))
    return hashlib.sha256(basis.encode()).hexdigest()


def _key(path, flag):
    # Per-file: the same token/rule flagged in two files has different context
    return f"{path}::{flag['key']}"


def _cached(conn, path, flag):
    row = conn.execute(
        "SELECT context_sha256, verdict, reason, judged_at FROM ai_triage"
        " WHERE category=? AND key=?",
        (flag["category"], _key(path, flag))).fetchone()
    if row is None:  # Wildcard user override applies across files
        row = conn.execute(
            "SELECT context_sha256, verdict, reason, judged_at FROM ai_triage"
            " WHERE category=? AND key=?",
            (flag["category"], _key("*", flag))).fetchone()
    return row


def _needs_judgment(conn, path, flag):
    """-> (needs: bool, current_base_hash). The hash is computed ONCE here and
    carried through the batch so the stored verdict is pinned to the context
    the model actually saw, not whatever is on disk after the call returns."""
    h = _base_hash(flag)
    row = _cached(conn, path, flag)
    if row is None:
        return True, h
    if row["context_sha256"] == "*":  # User override, permanent
        return False, h
    return row["context_sha256"] != h, h


def _store(conn, path, flag, verdict, reason, base_hash):
    conn.execute(
        "INSERT OR REPLACE INTO ai_triage(category, key, context_sha256, verdict,"
        " reason, judged_at) VALUES (?,?,?,?,?,?)",
        (flag["category"], _key(path, flag), base_hash, verdict, reason,
         time.time()))
    conn.commit()


def _call_batch(items):
    prompt = INSTRUCTIONS + json.dumps(items, ensure_ascii=False, indent=1)
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(("CLAUDECODE", "CLAUDE_CODE"))}
    r = subprocess.run(
        [_claude_bin(), "-p", prompt, "--model", "haiku",
         "--output-format", "json"],
        cwd=str(DATA), env=env, capture_output=True, text=True, timeout=TIMEOUT)
    if r.returncode != 0:
        raise RuntimeError(f"claude exited {r.returncode}: {r.stderr[:300]}")
    outer = json.loads(r.stdout)
    text = (outer.get("result") or "").strip()
    if text.startswith("```"):
        text = text.strip("`").lstrip("json").strip()
    verdicts = json.loads(text)
    if not isinstance(verdicts, list):
        raise RuntimeError("triage response is not a list")
    return {v.get("id"): v for v in verdicts if isinstance(v, dict)}


def run_pending(report, wait_for_chat=None):
    """Judge every unjudged flag in the report. Synchronous; call off-thread."""
    global _last_failure, _last_error
    conn = connect()
    queue = []
    for f in report.get("files", []):
        for flag in f["flags"]:
            if flag.get("dismissed"):
                continue
            needs, h = _needs_judgment(conn, f["path"], flag)
            if needs:
                queue.append([f["path"], flag, 0, h])  # [path, flag, esc, hash]

    while queue:
        if time.time() - _last_failure < BACKOFF_S:
            return
        if wait_for_chat:
            wait_for_chat()
        batch, queue = queue[:BATCH], queue[BATCH:]
        items = []
        for i, (path, flag, esc, h) in enumerate(batch, 1):
            items.append(dict(id=i, category=flag["category"],
                              **_flag_info(flag),
                              context=_context_for(flag, RADII[esc])))
        try:
            verdicts = _call_batch(items)
            _last_error = None  # A batch went through: clear any stale failure
        except Exception as e:
            _last_failure = time.time()
            _last_error = (str(e) or e.__class__.__name__)[:300]
            return
        for i, (path, flag, esc, h) in enumerate(batch, 1):
            v = verdicts.get(i)
            if not v or v.get("verdict") not in ("keep", "clear", "need_more"):
                continue  # Fail-closed: stays pending/visible
            if v["verdict"] == "need_more":
                if esc + 1 < len(RADII):
                    queue.append([path, flag, esc + 1, h])
                else:
                    _store(conn, path, flag, "keep",
                           "needs human review (context escalations exhausted)", h)
            else:
                _store(conn, path, flag, v["verdict"],
                       (v.get("reason") or "")[:300], h)


def schedule(report):
    """Fire-and-forget triage of a fresh lint report (single worker, pauses
    while chat turns are active to protect RAM)."""
    global _worker_running
    with _worker_lock:
        if _worker_running:
            return
        _worker_running = True

    def _work():
        global _worker_running
        try:
            from backend.adapters import chat  # Lazy: mirrors _claude_bin, no chat wiring at import

            def wait_for_chat():
                while chat.active_count() > 0:
                    time.sleep(10)
            run_pending(report, wait_for_chat=wait_for_chat)
        finally:
            with _worker_lock:
                _worker_running = False

    threading.Thread(target=_work, daemon=True).start()


def status():
    """Current worker state for the UI: whether triage is running, whether it's
    in the post-failure backoff window, and the last error message (if any)."""
    return dict(
        running=_worker_running,
        in_backoff=bool(_last_failure) and (time.time() - _last_failure) < BACKOFF_S,
        last_error=_last_error,
    )


def run_now(report):
    """Manual 'Triage now': clear any failure backoff and schedule immediately."""
    global _last_failure, _last_error
    _last_failure = 0.0
    _last_error = None
    schedule(report)


def annotate(report):
    """Attach flag['ai'] verdicts (only when the cached hash is current) and a
    report-level triage_pending count."""
    conn = connect()
    pending = 0
    for f in report.get("files", []):
        for flag in f["flags"]:
            row = _cached(conn, f["path"], flag)
            if row and (row["context_sha256"] == "*"
                        or row["context_sha256"] == _base_hash(flag)):
                flag["ai"] = dict(verdict=row["verdict"], reason=row["reason"],
                                  judged_at=row["judged_at"])
            elif not flag.get("dismissed"):
                pending += 1
    report["triage_pending"] = pending
    return report


def user_override(category, key):
    """The human disagrees with an AI 'clear' — pin the flag as kept forever.
    Deletes every per-file row for the key (they would shadow the wildcard in
    _cached), then writes the wildcard override."""
    conn = connect()
    suffix = f"::{key}"
    stale = [r["key"] for r in conn.execute(
        "SELECT key FROM ai_triage WHERE category=?", (category,))
        if r["key"].endswith(suffix)]
    for k in stale:
        conn.execute("DELETE FROM ai_triage WHERE category=? AND key=?",
                     (category, k))
    conn.execute(
        "INSERT OR REPLACE INTO ai_triage(category, key, context_sha256, verdict,"
        " reason, judged_at) VALUES (?,?,'*','keep','user override',?)",
        (category, f"*{suffix}", time.time()))
    conn.commit()
