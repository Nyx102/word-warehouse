#!/usr/bin/env python3
"""WorldEnd translation workbench — pure-stdlib web server.

ThreadingHTTPServer + hand routing + SSE. Background poller keeps the index
fresh (5 s stat scan, purely local) and re-lints when anything changed.
"""

import argparse
import json
import queue
import re
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import chat
import checker
import gitops
import search as searchmod
from config import CORPUS, DATA, HOST, PORT, RULES_YAML
from db import connect
from indexer import ensure_fresh

STATIC = Path(__file__).resolve().parent / "static"
POLL_INTERVAL = 5

MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml",
        ".png": "image/png", ".ico": "image/x-icon"}

_lint_cache = {"report": None, "lock": threading.Lock()}


def _refresh_lint(force=False):
    with _lint_cache["lock"]:
        if _lint_cache["report"] is None or force:
            _lint_cache["report"] = checker.lint()
    return _lint_cache["report"]


def poller():
    while True:
        try:
            changed = ensure_fresh()
            if changed:
                _refresh_lint(force=True)
        except Exception:
            traceback.print_exc()
        time.sleep(POLL_INTERVAL)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "worldend-workbench"

    # ------------------------------------------------------------ plumbing
    def log_message(self, fmt, *args):
        pass  # quiet; errors surface via tracebacks

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, message, code=400):
        self._json({"error": message}, code)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        return json.loads(self.rfile.read(n).decode())

    def _q(self, name, default=None):
        vals = self.query.get(name)
        return vals[0] if vals else default

    # ------------------------------------------------------------- routing
    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def do_DELETE(self):
        self._route("DELETE")

    def _route(self, method):
        parsed = urlparse(self.path)
        self.query = parse_qs(parsed.query)
        path = unquote(parsed.path)
        try:
            for pattern, methods, fn in ROUTES:
                m = pattern.match(path)
                if m:
                    if method not in methods:
                        return self._error("method not allowed", 405)
                    return fn(self, *m.groups())
            if method == "GET":
                return self._static(path)
            self._error("not found", 404)
        except BrokenPipeError:
            pass
        except Exception as e:
            traceback.print_exc()
            try:
                self._error(f"{type(e).__name__}: {e}", 500)
            except Exception:
                pass

    def _static(self, path):
        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        f = (STATIC / rel).resolve()
        if not str(f).startswith(str(STATIC)) or not f.is_file():
            return self._error("not found", 404)
        body = f.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(f.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    # ------------------------------------------------------------ handlers
    def h_status(self):
        conn = connect()
        files = conn.execute("SELECT count(*) c FROM files").fetchone()["c"]
        chunks = conn.execute("SELECT count(*) c FROM chunks").fetchone()["c"]
        ts = conn.execute("SELECT v FROM meta WHERE k='last_scan_at'").fetchone()
        age = round(time.time() - float(ts["v"]), 1) if ts else None
        self._json(dict(
            index=dict(files=files, chunks=chunks, last_scan_age_s=age),
            git=dict(corpus=dict(dirty=gitops.dirty_count("corpus")),
                     repo=dict(dirty=gitops.dirty_count("repo"))),
            chat_active=chat.active_count()))

    def h_reindex(self):
        n = ensure_fresh(force=False)
        _refresh_lint(force=True)
        self._json(dict(reindexed=n))

    def h_search(self):
        q = self._q("q", "").strip()
        if not q:
            return self._error("missing q")
        rows = searchmod.search(
            q, lang=self._q("lang") or None, series=self._q("series") or None,
            source=self._q("source") or None, kind=self._q("kind") or "all",
            limit=min(int(self._q("limit", "20")), 100))
        self._json(dict(results=rows))

    def h_chunk(self, chunk_id):
        ctx = searchmod.context(int(chunk_id),
                                before=int(self._q("before", "2")),
                                after=int(self._q("after", "2")))
        if not ctx:
            return self._error("no such chunk", 404)
        self._json(ctx)

    def h_align(self):
        series = self._q("series")
        if not series:
            return self._error("missing series")
        self._json(dict(rows=searchmod.align(series, self._q("volume") or None)))

    def h_file(self):
        rel = self._q("path", "")
        f = (CORPUS / rel).resolve()
        if not str(f).startswith(str(CORPUS)) or not f.is_file():
            return self._error("not found", 404)
        lines = f.read_text(encoding="utf-8", errors="replace").splitlines()
        start = max(1, int(self._q("start", "1")))
        count = min(1000, int(self._q("count", "200")))
        self._json(dict(path=rel, total_lines=len(lines), start=start,
                        lines=lines[start - 1:start - 1 + count]))

    def h_coverage(self):
        p = CORPUS / "notes/coverage.md"
        self._json(dict(markdown=p.read_text(encoding="utf-8")
                        if p.is_file() else "no coverage report yet"))

    def h_lint(self):
        if self._q("include_dismissed"):
            self._json(checker.lint(include_dismissed=True))
        else:
            self._json(_refresh_lint())

    def h_lint_dismiss(self):
        b = self._body()
        checker.dismiss(b["category"], b["key"])
        _refresh_lint(force=True)
        self._json(dict(ok=True))

    def h_lint_undismiss(self):
        b = self._body()
        checker.undismiss(b["category"], b["key"])
        _refresh_lint(force=True)
        self._json(dict(ok=True))

    def h_threads(self):
        self._json(dict(threads=chat.list_threads()))

    def h_threads_create(self):
        b = self._body()
        self._json(dict(id=chat.create_thread(b.get("title"))))

    def h_thread_delete(self, tid):
        chat.delete_thread(int(tid))
        self._json(dict(ok=True))

    def h_messages(self, tid):
        self._json(dict(messages=chat.get_messages(int(tid))))

    def h_message(self, tid):
        b = self._body()
        text = (b.get("text") or "").strip()
        if not text:
            return self._error("empty message")
        try:
            turn = chat.start_turn(int(tid), text)
        except RuntimeError as e:
            return self._error(str(e), 409)
        self._json(dict(ok=True, turn=turn))

    def h_interrupt(self, tid):
        self._json(dict(ok=chat.interrupt(int(tid))))

    def h_stream(self, tid):
        tid = int(tid)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        def send(payload):
            data = json.dumps(payload, ensure_ascii=False)
            self.wfile.write(f"data: {data}\n\n".encode())
            self.wfile.flush()

        q = chat.subscribe(tid)
        try:
            active = chat.active_turn(tid)
            if active:
                conn = connect()
                for r in conn.execute(
                        "SELECT content FROM messages WHERE thread_id=? AND turn=?"
                        " ORDER BY seq", (tid, active.turn_no)):
                    send(json.loads(r["content"]))
            while True:
                try:
                    payload = q.get(timeout=15)
                    send(payload)
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            chat.unsubscribe(tid, q)

    def h_git_status(self, ):
        self._json(dict(files=gitops.status(self._q("repo", "corpus"))))

    def h_git_diff(self):
        self._json(dict(diff=gitops.diff(self._q("repo", "corpus"),
                                         self._q("path") or None)))

    def h_git_log(self):
        self._json(dict(log=gitops.log(self._q("repo", "corpus"),
                                       int(self._q("n", "20")))))

    def h_git_commit(self):
        b = self._body()
        try:
            h = gitops.commit(b.get("repo", "corpus"), b.get("message", ""),
                              b.get("paths") or [])
        except RuntimeError as e:
            return self._error(str(e))
        self._json(dict(ok=True, hash=h))


def R(pattern, methods, fn):
    return (re.compile(f"^{pattern}$"), methods, fn)


ROUTES = [
    R(r"/api/status", {"GET"}, Handler.h_status),
    R(r"/api/reindex", {"POST"}, Handler.h_reindex),
    R(r"/api/search", {"GET"}, Handler.h_search),
    R(r"/api/chunk/(\d+)", {"GET"}, Handler.h_chunk),
    R(r"/api/align", {"GET"}, Handler.h_align),
    R(r"/api/file", {"GET"}, Handler.h_file),
    R(r"/api/coverage", {"GET"}, Handler.h_coverage),
    R(r"/api/lint", {"GET"}, Handler.h_lint),
    R(r"/api/lint/dismiss", {"POST"}, Handler.h_lint_dismiss),
    R(r"/api/lint/undismiss", {"POST"}, Handler.h_lint_undismiss),
    R(r"/api/threads", {"GET"}, Handler.h_threads),
    R(r"/api/threads", {"POST"}, Handler.h_threads_create),
    R(r"/api/threads/(\d+)", {"DELETE"}, Handler.h_thread_delete),
    R(r"/api/threads/(\d+)/messages", {"GET"}, Handler.h_messages),
    R(r"/api/threads/(\d+)/message", {"POST"}, Handler.h_message),
    R(r"/api/threads/(\d+)/stream", {"GET"}, Handler.h_stream),
    R(r"/api/threads/(\d+)/interrupt", {"POST"}, Handler.h_interrupt),
    R(r"/api/git/status", {"GET"}, Handler.h_git_status),
    R(r"/api/git/diff", {"GET"}, Handler.h_git_diff),
    R(r"/api/git/log", {"GET"}, Handler.h_git_log),
    R(r"/api/git/commit", {"POST"}, Handler.h_git_commit),
]

# GET+POST share /api/threads: dispatch by method
ROUTES = [(p, m, f) for p, m, f in ROUTES]


def _dispatch_threads(handler):
    if handler.command == "GET":
        return Handler.h_threads(handler)
    return Handler.h_threads_create(handler)


ROUTES = [r for r in ROUTES if r[0].pattern != "^/api/threads$"]
ROUTES.insert(10, R(r"/api/threads", {"GET", "POST"}, _dispatch_threads))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default=HOST)
    ap.add_argument("--port", type=int, default=PORT)
    args = ap.parse_args()

    DATA.mkdir(parents=True, exist_ok=True)
    print(f"indexing… ({ensure_fresh()} files refreshed)")
    threading.Thread(target=poller, daemon=True).start()
    threading.Thread(target=_refresh_lint, daemon=True).start()

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    srv.daemon_threads = True
    print(f"workbench listening on http://{args.host}:{args.port}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
