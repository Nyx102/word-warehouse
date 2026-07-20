"""Chat backend: a modular interface with one implementation that drives the
authenticated `claude` CLI in headless stream-json mode (the same protocol the
Claude Agent SDK wraps). Sessions resume per thread; events are persisted to
sqlite and fanned out to SSE subscribers. AI credits are spent here and only
here — one CLI invocation per user message."""

import json
import os
import queue
import shutil
import subprocess
import threading
import time

from backend.config import CORPUS, DATA
from backend.db import connect

CLAUDE_BIN = (os.environ.get("WORLDEND_CLAUDE_BIN")
              or shutil.which("claude")
              or os.path.expanduser("~/.local/bin/claude"))
TURN_TIMEOUT = 600
MAX_GLOBAL_TURNS = 2

SYSTEM_BLURB = (
    "You are the WorldEnd translation assistant, reached through a web"
    " UI (not a terminal). Follow CLAUDE.md. Prefer the `corpus` CLI over"
    " grep/find for searching. Keep answers compact; cite corpus paths with line"
    " numbers so the user can jump to them."
)

# Permissions ride on explicit flags: headless mode does not honor a project
# .claude/settings.json in a directory without interactive trust.
ALLOWED_TOOLS = ["Read", "Edit", "Write", "Grep", "Glob", "WebSearch",
                 "WebFetch", "Bash(corpus:*)", "Bash(git status:*)",
                 "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)",
                 "Bash(ls:*)", "Bash(wc:*)", "Bash(head:*)", "Bash(tail:*)",
                 "Bash(grep:*)", "Bash(rg:*)", "Bash(find:*)", "Bash(diff:*)",
                 "Bash(python3:*)"]
DENIED_TOOLS = ["Bash(git commit:*)", "Bash(git push:*)", "Bash(git reset:*)",
                "Bash(git checkout:*)", "Bash(git restore:*)", "Bash(rm:*)",
                "Bash(sudo:*)"]

_global_turns = threading.Semaphore(MAX_GLOBAL_TURNS)


_hubs = {}  # thread_id -> [Queue]; streams outlive turns
_hubs_lock = threading.Lock()


def subscribe(thread_id):
    q = queue.Queue()
    with _hubs_lock:
        _hubs.setdefault(thread_id, []).append(q)
    return q


def unsubscribe(thread_id, q):
    with _hubs_lock:
        subs = _hubs.get(thread_id, [])
        if q in subs:
            subs.remove(q)


def _broadcast(thread_id, payload):
    with _hubs_lock:
        subs = list(_hubs.get(thread_id, []))
    for q in subs:
        q.put(payload)


class Turn:
    def __init__(self, thread_id, turn_no):
        self.thread_id = thread_id
        self.turn_no = turn_no
        self.proc = None
        self.done = threading.Event()
        self.seq = 0

    def publish(self, payload):
        _broadcast(self.thread_id, payload)


_active = {}  # thread_id -> Turn
_active_lock = threading.Lock()


def active_turn(thread_id):
    with _active_lock:
        return _active.get(thread_id)


def active_count():
    with _active_lock:
        return len(_active)


def _persist(conn, thread_id, turn_no, seq, kind, payload):
    conn.execute(
        "INSERT INTO messages(thread_id, turn, seq, kind, content, created_at)"
        " VALUES (?,?,?,?,?,?)",
        (thread_id, turn_no, seq, kind, json.dumps(payload, ensure_ascii=False),
         time.time()))
    conn.commit()


def start_turn(thread_id, text):
    """Spawn a claude turn. Returns turn number. Raises RuntimeError if busy."""
    with _active_lock:
        if thread_id in _active:
            raise RuntimeError("a turn is already running on this thread")
        if len(_active) >= MAX_GLOBAL_TURNS:
            raise RuntimeError(f"{MAX_GLOBAL_TURNS} turns already running; wait")
        conn = connect()
        row = conn.execute("SELECT coalesce(max(turn), 0) + 1 AS t FROM messages"
                           " WHERE thread_id=?", (thread_id,)).fetchone()
        turn = Turn(thread_id, row["t"])
        _active[thread_id] = turn

    try:
        conn = connect()
        turn.seq += 1
        _persist(conn, thread_id, turn.turn_no, turn.seq, "user_text",
                 dict(kind="user_text", text=text, turn=turn.turn_no, seq=turn.seq))
        conn.execute("UPDATE threads SET last_active=? WHERE id=?",
                     (time.time(), thread_id))
        conn.commit()
        worker = threading.Thread(target=_run_turn, args=(turn, text), daemon=True)
        worker.start()
    except BaseException:
        # Never leave a registered turn with no worker to clean it up
        with _active_lock:
            _active.pop(thread_id, None)
        raise
    return turn.turn_no


def _emit(turn, conn, kind, **payload):
    turn.seq += 1
    payload.update(kind=kind, turn=turn.turn_no, seq=turn.seq)
    try:
        _persist(conn, turn.thread_id, turn.turn_no, turn.seq, kind, payload)
    except Exception:
        # Persistence failure (db busy, thread deleted mid-turn) must not stop
        # the stream or the cleanup path; the row is merely absent from replay
        pass
    turn.publish(payload)


def _build_argv(text, session_id, model):
    argv = [CLAUDE_BIN, "-p", text,
            "--output-format", "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--permission-mode", "acceptEdits",
            "--allowedTools", ",".join(ALLOWED_TOOLS),
            "--disallowedTools", ",".join(DENIED_TOOLS),
            "--add-dir", str(DATA),
            "--append-system-prompt", SYSTEM_BLURB]
    if model != "default":
        argv += ["--model", model]
    if session_id:
        argv += ["--resume", session_id]
    return argv


def _attempt(turn, conn, text, session_id, model):
    """Run one claude invocation to completion, streaming its events. Returns
    (returncode, stderr_tail); stderr is only read on failure."""
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(("CLAUDECODE", "CLAUDE_CODE"))}
    turn.proc = subprocess.Popen(
        _build_argv(text, session_id, model), cwd=str(CORPUS), env=env,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    killer = threading.Timer(TURN_TIMEOUT, _kill, args=(turn, "timeout"))
    killer.daemon = True
    killer.start()
    try:
        _pump(turn, conn)
        turn.proc.wait()
    finally:
        killer.cancel()
    rc = turn.proc.returncode
    err = "" if rc in (0, None) else (turn.proc.stderr.read() or "")[:800]
    return rc, err


def _missing_session(rc, err):
    """A --resume against a session the CLI can't find (never persisted, or
    dropped) exits fast with this message. Distinct from a real turn failure."""
    return rc not in (0, None) and "No conversation found with session ID" in err


def _run_turn(turn, text):
    _global_turns.acquire()
    conn = connect()
    try:
        row = conn.execute("SELECT claude_session_id, model FROM threads WHERE id=?",
                           (turn.thread_id,)).fetchone()
        session_id = row["claude_session_id"] if row else None
        # App default is sonnet. NEVER inherit the CLI default silently (the
        # user's interactive default may be an expensive tier); "default"
        # explicitly opts back into the CLI default.
        model = (row["model"] if row and row["model"] else "sonnet")

        rc, err = _attempt(turn, conn, text, session_id, model)
        # The stored session may point at a transcript the CLI can't find (it
        # was never persisted, or was pruned). Resuming it fails fast before any
        # output, so clear the dead id and retry once as a fresh session rather
        # than erroring on every follow-up message.
        if session_id and _missing_session(rc, err):
            conn.execute("UPDATE threads SET claude_session_id=NULL WHERE id=?",
                         (turn.thread_id,))
            conn.commit()
            rc, err = _attempt(turn, conn, text, None, model)
        if rc not in (0, None):
            _emit(turn, conn, "error", message=f"claude exited {rc}: {err}")
    except Exception as e:
        _emit(turn, conn, "error", message=str(e))
    finally:
        if turn.proc and turn.proc.poll() is None:
            turn.proc.kill()
        try:
            _emit(turn, conn, "done")
        except Exception:
            pass
        with _active_lock:
            _active.pop(turn.thread_id, None)
        turn.done.set()
        _global_turns.release()


def _kill(turn, reason):
    if turn.proc and turn.proc.poll() is None:
        turn.proc.kill()


def _preview(value, limit=400):
    s = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return s[:limit] + ("…" if len(s) > limit else "")


def _pump(turn, conn):
    """Translate claude stream-json events into chat events."""
    text_acc = []
    for line in turn.proc.stdout:
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        et = ev.get("type")

        if et == "system" and ev.get("subtype") == "init":
            sid = ev.get("session_id")
            if sid:
                conn.execute("UPDATE threads SET claude_session_id=? WHERE id=?",
                             (sid, turn.thread_id))
                conn.commit()
            _emit(turn, conn, "init", session_id=sid)

        elif et == "stream_event":
            inner = ev.get("event") or {}
            # Ephemeral events get their own seq too: the client dedupes on
            # (turn, seq), so sharing the previous event's seq would swallow
            # every streamed delta after the first
            if inner.get("type") == "content_block_delta":
                delta = inner.get("delta") or {}
                if delta.get("type") == "text_delta" and delta.get("text"):
                    text_acc.append(delta["text"])
                    turn.seq += 1
                    turn.publish(dict(kind="text_delta", text=delta["text"],
                                      turn=turn.turn_no, seq=turn.seq))
            elif inner.get("type") == "content_block_start":
                block = inner.get("content_block") or {}
                if block.get("type") == "thinking":
                    turn.seq += 1
                    turn.publish(dict(kind="thinking", turn=turn.turn_no,
                                      seq=turn.seq))

        elif et == "assistant":
            for block in (ev.get("message") or {}).get("content", []):
                bt = block.get("type")
                if bt == "text" and block.get("text"):
                    text_acc = []
                    _emit(turn, conn, "assistant_text", text=block["text"])
                elif bt == "tool_use":
                    _emit(turn, conn, "tool_use", name=block.get("name", "?"),
                          input_preview=_preview(block.get("input", {}), 200))

        elif et == "user":
            for block in (ev.get("message") or {}).get("content", []):
                if isinstance(block, dict) and block.get("type") == "tool_result":
                    content = block.get("content")
                    if isinstance(content, list):
                        content = " ".join(
                            c.get("text", "") for c in content
                            if isinstance(c, dict))
                    _emit(turn, conn, "tool_result",
                          preview=_preview(content or ""),
                          is_error=bool(block.get("is_error")))

        elif et == "result":
            sid = ev.get("session_id")
            if sid:
                conn.execute("UPDATE threads SET claude_session_id=? WHERE id=?",
                             (sid, turn.thread_id))
                conn.commit()
            _emit(turn, conn, "result",
                  ok=(ev.get("subtype") == "success"),
                  duration_s=round((ev.get("duration_ms") or 0) / 1000, 1),
                  session_id=sid)
    # Exit status and stderr are handled by the caller (_attempt), which decides
    # whether a nonzero exit is a resume-miss worth retrying or a real error.


def interrupt(thread_id):
    turn = active_turn(thread_id)
    if not turn:
        return False
    _kill(turn, "interrupt")
    return True


# ------------------------------------------------------------------ threads

def list_threads():
    """All threads, archived included; the frontend sections them."""
    conn = connect()
    return [dict(r) for r in conn.execute(
        "SELECT * FROM threads ORDER BY pinned DESC, last_active DESC")]


_MODELS = ("haiku", "sonnet", "opus", "default", None)


def update_thread(thread_id, **fields):
    """Apply any of title/model/pinned/archived; ValueError on bad input."""
    sets, params = [], []
    for key, value in fields.items():
        if key == "model":
            if value not in _MODELS:
                raise ValueError("bad model")
        elif key == "title":
            if value is not None and not isinstance(value, str):
                raise ValueError("bad title")
        elif key in ("pinned", "archived"):
            if not isinstance(value, (bool, int)) or value not in (0, 1):
                raise ValueError(f"bad {key}")
            value = int(value)
        else:
            raise ValueError(f"unknown field: {key}")
        sets.append(f"{key}=?")
        params.append(value)
    if not sets:
        return
    conn = connect()
    conn.execute(f"UPDATE threads SET {', '.join(sets)} WHERE id=?",
                 (*params, thread_id))
    conn.commit()


def create_thread(title=None):
    conn = connect()
    now = time.time()
    cur = conn.execute(
        "INSERT INTO threads(title, created_at, last_active) VALUES (?,?,?)",
        (title, now, now))
    conn.commit()
    return cur.lastrowid


def delete_thread(thread_id):
    turn = active_turn(thread_id)
    if turn:
        _kill(turn, "thread deleted")
        turn.done.wait(10)
    conn = connect()
    conn.execute("DELETE FROM messages WHERE thread_id=?", (thread_id,))
    conn.execute("DELETE FROM threads WHERE id=?", (thread_id,))
    conn.commit()


def get_messages(thread_id):
    conn = connect()
    return [dict(r) for r in conn.execute(
        "SELECT id, turn, seq, kind, content, created_at FROM messages"
        " WHERE thread_id=? ORDER BY turn, seq", (thread_id,))]
