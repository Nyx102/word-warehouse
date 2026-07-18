#!/usr/bin/env python3
"""WorldEnd translation workbench — pure-stdlib web server.

ThreadingHTTPServer + hand routing + SSE. Background poller keeps the index
fresh (5 s stat scan, purely local) and re-lints when anything changed.
"""

import argparse
import json
import os
import queue
import re
import shutil
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
from config import CORPUS, DATA, FS_ROOT, HOST, PORT, RULES_YAML
from db import connect
from indexer import ensure_fresh

_APP_DIR = Path(__file__).resolve().parent
_DIST = _APP_DIR / "frontend" / "dist"
STATIC = _DIST if _DIST.is_dir() else _APP_DIR / "static"
POLL_INTERVAL = 5
MAX_BODY = 64 * 1024 * 1024  # reject oversize request bodies (uploads) up front

MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml",
        ".png": "image/png", ".ico": "image/x-icon",
        ".json": "application/json; charset=utf-8",
        ".webmanifest": "application/manifest+json; charset=utf-8"}

_lint_cache = {"reports": {}, "lock": threading.Lock()}


def _refresh_lint(force=False, scope="all"):
    with _lint_cache["lock"]:
        if force:
            _lint_cache["reports"].clear()
        if scope not in _lint_cache["reports"]:
            _lint_cache["reports"][scope] = checker.lint(scope=scope)
        return _lint_cache["reports"][scope]


def poller():
    import triage
    while True:
        try:
            changed = ensure_fresh()
            if changed:
                report = _refresh_lint(force=True)
                triage.schedule(report)
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
        raw = getattr(self, "_raw_body", b"")
        if not raw:
            return {}
        return json.loads(raw.decode())

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

    def do_PUT(self):
        self._route("PUT")

    def do_PATCH(self):
        self._route("PATCH")

    def _route(self, method):
        parsed = urlparse(self.path)
        self.query = parse_qs(parsed.query)
        path = unquote(parsed.path)
        try:
            # Drain the request body up front. With HTTP/1.1 keep-alive, any
            # bytes a handler leaves unread stay in the socket and get parsed
            # as the next request's start-line -> "501 Unsupported method".
            n = int(self.headers.get("Content-Length") or 0)
            if n > MAX_BODY:
                # Don't buffer a huge body just to reject it; close the socket
                # after the 413 so the undrained bytes can't desync keep-alive.
                self.close_connection = True
                return self._error("request body too large", 413)
            self._raw_body = self.rfile.read(n) if n > 0 else b""
            matched = False
            for pattern, methods, fn in ROUTES:
                m = pattern.match(path)
                if m:
                    matched = True
                    if method in methods:
                        return fn(self, *m.groups())
            if matched:
                return self._error("method not allowed", 405)
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
            if path.startswith("/api/"):
                return self._error("not found", 404)
            f = STATIC / "index.html"  # SPA fallback
            if not f.is_file():
                return self._error("not found", 404)
        body = f.read_bytes()
        immutable = "/assets/" in f.as_posix()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(f.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control",
                         "public, max-age=31536000, immutable" if immutable
                         else "no-cache")
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

    def _safe_corpus_path(self, rel):
        if not rel or ".git" in rel.split("/"):
            return None
        f = (CORPUS / rel).resolve()
        if not str(f).startswith(str(CORPUS)):
            return None
        return f

    def _safe_repo_path(self, repo, rel):
        """Resolve a repo-relative path under one of gitops' repos (ROOT for
        'corpus', the nested translation repo for 'repo'). The Diffs view lists
        files by (repo, repo-relative path); the file API must speak the same
        space so anything in a repo's git status is loadable/editable."""
        base = gitops.REPOS.get(repo)
        if base is None or not rel or ".git" in rel.split("/"):
            return None
        base = base.resolve()
        f = (base / rel).resolve()
        if not f.is_relative_to(base):
            return None
        return f

    def h_file(self):
        rel = self._q("path", "")
        repo = self._q("repo")
        f = self._safe_repo_path(repo, rel) if repo else self._safe_corpus_path(rel)
        if f is None or not f.is_file():
            return self._error("not found", 404)
        if self._q("full"):
            if f.stat().st_size > 2 * 1024 * 1024:
                return self._error("file too large for editor", 413)
            content = f.read_text(encoding="utf-8", errors="replace")
            import hashlib
            return self._json(dict(
                path=rel, content=content,
                sha256=hashlib.sha256(content.encode()).hexdigest(),
                total_lines=content.count("\n") + 1))
        lines = f.read_text(encoding="utf-8", errors="replace").splitlines()
        start = max(1, int(self._q("start", "1")))
        count = min(1000, int(self._q("count", "200")))
        self._json(dict(path=rel, total_lines=len(lines), start=start,
                        lines=lines[start - 1:start - 1 + count]))

    def h_file_put(self):
        import hashlib
        import os
        b = self._body()
        rel = b.get("path", "")
        repo = b.get("repo")
        f = self._safe_repo_path(repo, rel) if repo else self._safe_corpus_path(rel)
        if f is None:
            return self._error("bad path", 400)
        content = b.get("content")
        if content is None or len(content) > 5 * 1024 * 1024:
            return self._error("missing or oversized content", 400)
        expect = b.get("expect_sha256")
        if expect and f.is_file():
            cur = hashlib.sha256(f.read_bytes()).hexdigest()
            if cur != expect:
                return self._error("file changed on disk", 409)
        tmp = f.with_suffix(f.suffix + ".tmp~")
        tmp.write_text(content, encoding="utf-8")
        os.replace(tmp, f)
        self._json(dict(ok=True,
                        sha256=hashlib.sha256(content.encode()).hexdigest()))

    # -------------------------------------------------- files tab (/api/fs/*)
    def _safe_fs_path(self, rel):
        """Resolve a project-relative path under FS_ROOT (the Files-tab root).
        Blocks traversal and any .git segment (ROOT/.git + the nested repo's)."""
        if rel is None:
            return None
        rel = rel.strip().lstrip("/")
        if ".git" in rel.split("/"):
            return None
        f = (FS_ROOT / rel).resolve()
        if not f.is_relative_to(FS_ROOT):
            return None
        return f

    def h_fs_list(self):
        d = self._safe_fs_path(self._q("path", "") or "")
        if d is None or not d.is_dir():
            return self._error("not a directory", 404)
        rel = str(d.relative_to(FS_ROOT)) if d != FS_ROOT else ""
        entries = []
        for e in os.scandir(d):
            if e.name == ".git":
                continue
            try:
                st = e.stat(follow_symlinks=False)
            except OSError:
                continue
            is_dir = e.is_dir(follow_symlinks=False)
            entries.append(dict(
                name=e.name,
                path=(Path(rel) / e.name).as_posix() if rel else e.name,
                is_dir=is_dir,
                size=st.st_size,
                mtime=st.st_mtime))
        entries.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))
        self._json(dict(path=rel, entries=entries))

    def h_fs_mkdir(self):
        d = self._safe_fs_path(self._body().get("path", ""))
        if d is None or d == FS_ROOT:
            return self._error("bad path", 400)
        if d.exists():
            return self._error("already exists", 409)
        d.mkdir(parents=True)
        self._json(dict(ok=True))

    def h_fs_create(self):
        f = self._safe_fs_path(self._body().get("path", ""))
        if f is None or f == FS_ROOT:
            return self._error("bad path", 400)
        if f.exists():
            return self._error("already exists", 409)
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text("", encoding="utf-8")
        self._json(dict(ok=True))

    def h_fs_rename(self):
        b = self._body()
        src = self._safe_fs_path(b.get("path", ""))
        dst = self._safe_fs_path(b.get("to", ""))
        if src is None or dst is None or src == FS_ROOT or dst == FS_ROOT:
            return self._error("bad path", 400)
        if not src.exists():
            return self._error("not found", 404)
        if dst.exists():
            return self._error("target exists", 409)
        dst.parent.mkdir(parents=True, exist_ok=True)
        os.replace(src, dst)
        self._json(dict(ok=True))

    def h_fs_delete(self):
        f = self._safe_fs_path(self._body().get("path", ""))
        if f is None or f == FS_ROOT:
            return self._error("bad path", 400)
        if not f.exists():
            return self._error("not found", 404)
        if f.is_dir():
            shutil.rmtree(f)
        else:
            f.unlink()
        self._json(dict(ok=True))

    def h_fs_download(self):
        f = self._safe_fs_path(self._q("path", ""))
        if f is None or not f.is_file():
            return self._error("not found", 404)
        name = f.name.replace('"', "")
        self.send_response(200)
        self.send_header("Content-Type",
                         MIME.get(f.suffix.lower(), "application/octet-stream"))
        self.send_header("Content-Length", str(f.stat().st_size))
        self.send_header("Content-Disposition", f'attachment; filename="{name}"')
        self.end_headers()
        with open(f, "rb") as fh:
            while True:
                chunk = fh.read(65536)
                if not chunk:
                    break
                self.wfile.write(chunk)

    def h_fs_upload(self):
        f = self._safe_fs_path(self._q("path", ""))
        if f is None or f == FS_ROOT:
            return self._error("bad path", 400)
        data = getattr(self, "_raw_body", b"")
        f.parent.mkdir(parents=True, exist_ok=True)
        tmp = f.with_suffix(f.suffix + ".upload~")
        tmp.write_bytes(data)
        os.replace(tmp, f)
        self._json(dict(ok=True, size=len(data)))

    def h_git_file(self):
        try:
            self._json(gitops.show(self._q("repo", "corpus"),
                                   self._q("path", ""),
                                   self._q("rev", "HEAD")))
        except (RuntimeError, KeyError) as e:
            self._error(str(e), 400)

    def h_git_revert(self):
        b = self._body()
        try:
            gitops.revert(b.get("repo", "corpus"), b.get("path", ""))
        except RuntimeError as e:
            return self._error(str(e), 409)
        except KeyError:
            return self._error("bad repo", 400)
        self._json(dict(ok=True))

    def h_thread_patch(self, tid):
        b = self._body()
        conn = connect()
        if "model" in b:
            m = b["model"]
            if m not in ("haiku", "sonnet", "opus", "default", None):
                return self._error("bad model", 400)
            conn.execute("UPDATE threads SET model=? WHERE id=?", (m, int(tid)))
        if "title" in b:
            conn.execute("UPDATE threads SET title=? WHERE id=?",
                         (b["title"], int(tid)))
        conn.commit()
        self._json(dict(ok=True))

    def h_triage_reject(self):
        import triage
        b = self._body()
        triage.user_override(b["category"], b["key"])
        _refresh_lint(force=True)
        self._json(dict(ok=True))

    def h_triage_run(self):
        """Manual 'Triage now': force a triage pass over the current flags,
        clearing any failure backoff."""
        import triage
        report = _refresh_lint(scope="all")
        triage.run_now(dict(report))
        self._json(dict(ok=True, triage=triage.status()))

    def h_coverage(self):
        p = CORPUS / "notes/coverage.md"
        self._json(dict(markdown=p.read_text(encoding="utf-8")
                        if p.is_file() else "no coverage report yet"))

    def h_help(self):
        """Usage guide = the README's workflow section (single source of truth)."""
        from config import ROOT
        p = ROOT / "README.md"
        text = p.read_text(encoding="utf-8") if p.is_file() else "no README"
        start = text.find("## How you actually use it")
        if start != -1:
            end = text.find("\n## ", start + 10)
            text = text[start:end] if end != -1 else text[start:]
        self._json(dict(markdown=text))

    def h_lint(self):
        import triage
        scope = self._q("scope", "all")
        if scope not in ("raw", "finished", "all"):
            return self._error("bad scope", 400)
        if self._q("include_dismissed"):
            report = checker.lint(include_dismissed=True, scope=scope)
        else:
            report = _refresh_lint(scope=scope)
        report = dict(report)
        triage.annotate(report)
        # Auto-run triage when flags await review and the worker is idle (not
        # already running, not in post-failure backoff). This is what actually
        # drains "N awaiting review" — the poller only schedules on disk change.
        st = triage.status()
        if report.get("triage_pending", 0) > 0 and not st["running"] and not st["in_backoff"]:
            triage.schedule(report)
            st = triage.status()
        report["triage"] = st
        self._json(report)

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
    R(r"/api/help", {"GET"}, Handler.h_help),
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
    R(r"/api/git/file", {"GET"}, Handler.h_git_file),
    R(r"/api/git/revert", {"POST"}, Handler.h_git_revert),
    R(r"/api/file", {"PUT"}, Handler.h_file_put),
    R(r"/api/threads/(\d+)", {"PATCH"}, Handler.h_thread_patch),
    R(r"/api/triage/reject", {"POST"}, Handler.h_triage_reject),
    R(r"/api/triage/run", {"POST"}, Handler.h_triage_run),
    R(r"/api/fs/list", {"GET"}, Handler.h_fs_list),
    R(r"/api/fs/mkdir", {"POST"}, Handler.h_fs_mkdir),
    R(r"/api/fs/create", {"POST"}, Handler.h_fs_create),
    R(r"/api/fs/rename", {"POST"}, Handler.h_fs_rename),
    R(r"/api/fs/delete", {"POST"}, Handler.h_fs_delete),
    R(r"/api/fs/download", {"GET"}, Handler.h_fs_download),
    R(r"/api/fs/upload", {"POST"}, Handler.h_fs_upload),
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
