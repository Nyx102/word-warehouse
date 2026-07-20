#!/usr/bin/env python3
"""WorldEnd translation server — FastAPI + uvicorn.

Sync path operations run in uvicorn's threadpool, so every request gets its own
thread-local sqlite connection and blocking git / subprocess / sqlite work never
stalls the event loop. One SSE endpoint streams chat turns; a lifespan-managed
background poller keeps the index fresh (5 s stat scan, purely local) and
re-lints when anything changed.
"""

import argparse
import contextlib
import hashlib
import json
import os
import queue
import shutil
import threading
import time
import traceback
from pathlib import Path

import anyio
import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import (FileResponse, JSONResponse, Response,
                               StreamingResponse)
from starlette.exceptions import HTTPException as StarletteHTTPException

from backend.adapters import chat
from backend.lint import checker
from backend.adapters import gitops
from backend.index import search as searchmod
from backend.config import CORPUS, DATA, DEV, FS_ROOT, HOST, PORT, ROOT
from backend.db import connect
from backend.index.indexer import ensure_fresh
from backend.adapters.pathsafe import safe_corpus_path, safe_fs_path, safe_repo_path

_DIST = ROOT / "frontend" / "dist"
STATIC = _DIST if _DIST.is_dir() else ROOT / "static"
POLL_INTERVAL = 5
MAX_BODY = 64 * 1024 * 1024  # Reject oversize request bodies (uploads) up front

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


_stop = threading.Event()


def poller():
    from backend.lint import triage  # Lazy: keeps the AI-credit machinery out of module import
    while not _stop.is_set():
        try:
            changed = ensure_fresh()
            if changed:
                report = _refresh_lint(force=True)
                triage.schedule(report)
        except Exception:
            traceback.print_exc()
        _stop.wait(POLL_INTERVAL)


# ---------------------------------------------------------------- plumbing

def _q(request, name, default=None):
    vals = request.query_params.getlist(name)
    return vals[0] if vals else default


async def json_body(request: Request) -> dict:
    raw = await request.body()
    return json.loads(raw) if raw else {}


async def raw_body(request: Request) -> bytes:
    return await request.body()


def _git_mutate(fn, *args):
    try:
        fn(*args)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    except KeyError:
        raise HTTPException(400, "bad repo")
    return dict(ok=True)


# --------------------------------------------------------------- lifespan

@contextlib.asynccontextmanager
async def lifespan(app):
    DATA.mkdir(parents=True, exist_ok=True)
    n = await anyio.to_thread.run_sync(ensure_fresh)  # Initial index off the event loop
    print(f"indexing… ({n} files refreshed)")
    threading.Thread(target=poller, daemon=True).start()
    threading.Thread(target=_refresh_lint, daemon=True).start()
    yield
    _stop.set()


app = FastAPI(lifespan=lifespan)


@app.middleware("http")
async def cap_body(request, call_next):
    cl = request.headers.get("content-length")
    if cl and int(cl) > MAX_BODY:
        return JSONResponse({"error": "request body too large"}, status_code=413)
    return await call_next(request)


@app.exception_handler(StarletteHTTPException)
async def on_http_exception(request, exc):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code,
                        headers=exc.headers)


# ---------------------------------------------------------------- handlers

@app.get("/api/status")
def status():
    conn = connect()
    files = conn.execute("SELECT count(*) c FROM files").fetchone()["c"]
    chunks = conn.execute("SELECT count(*) c FROM chunks").fetchone()["c"]
    ts = conn.execute("SELECT v FROM meta WHERE k='last_scan_at'").fetchone()
    age = round(time.time() - float(ts["v"]), 1) if ts else None
    return dict(
        index=dict(files=files, chunks=chunks, last_scan_age_s=age),
        git=dict(corpus=dict(dirty=gitops.dirty_count("corpus")),
                 repo=dict(dirty=gitops.dirty_count("repo"))),
        chat_active=chat.active_count())


@app.post("/api/reindex")
def reindex():
    n = ensure_fresh(force=False)
    _refresh_lint(force=True)
    return dict(reindexed=n)


@app.get("/api/search")
def search(request: Request):
    q = _q(request, "q", "").strip()
    if not q:
        raise HTTPException(400, "missing q")
    rows = searchmod.search(
        q, lang=_q(request, "lang") or None, series=_q(request, "series") or None,
        source=_q(request, "source") or None, kind=_q(request, "kind") or "all",
        limit=min(int(_q(request, "limit", "20")), 100))
    return dict(results=rows)


@app.get("/api/chunk/{chunk_id}")
def chunk(chunk_id: int, request: Request):
    ctx = searchmod.context(chunk_id,
                            before=int(_q(request, "before", "2")),
                            after=int(_q(request, "after", "2")))
    if not ctx:
        raise HTTPException(404, "no such chunk")
    return ctx


@app.get("/api/align")
def align(request: Request):
    return dict(rows=searchmod.align(
        _q(request, "series") or None, _q(request, "volume") or None))


@app.get("/api/file")
def file(request: Request):
    rel = _q(request, "path", "")
    repo = _q(request, "repo")
    f = safe_repo_path(repo, rel) if repo else safe_corpus_path(rel)
    if f is None or not f.is_file():
        raise HTTPException(404, "not found")
    if _q(request, "full"):
        if f.stat().st_size > 2 * 1024 * 1024:
            raise HTTPException(413, "file too large for editor")
        content = f.read_text(encoding="utf-8", errors="replace")
        return dict(
            path=rel, content=content,
            sha256=hashlib.sha256(content.encode()).hexdigest(),
            total_lines=content.count("\n") + 1)
    lines = f.read_text(encoding="utf-8", errors="replace").splitlines()
    start = max(1, int(_q(request, "start", "1")))
    count = min(1000, int(_q(request, "count", "200")))
    return dict(path=rel, total_lines=len(lines), start=start,
                lines=lines[start - 1:start - 1 + count])


@app.put("/api/file")
def file_put(body: dict = Depends(json_body)):
    rel = body.get("path", "")
    repo = body.get("repo")
    f = safe_repo_path(repo, rel) if repo else safe_corpus_path(rel)
    if f is None:
        raise HTTPException(400, "bad path")
    content = body.get("content")
    if content is None or len(content) > 5 * 1024 * 1024:
        raise HTTPException(400, "missing or oversized content")
    expect = body.get("expect_sha256")
    if expect and f.is_file():
        cur = hashlib.sha256(f.read_bytes()).hexdigest()
        if cur != expect:
            raise HTTPException(409, "file changed on disk")
    tmp = f.with_suffix(f.suffix + ".tmp~")
    tmp.write_text(content, encoding="utf-8")
    os.replace(tmp, f)
    return dict(ok=True, sha256=hashlib.sha256(content.encode()).hexdigest())


@app.get("/api/coverage")
def coverage():
    p = CORPUS / "notes/coverage.md"
    return dict(markdown=p.read_text(encoding="utf-8")
                if p.is_file() else "no coverage report yet")


@app.get("/api/help")
def help_():
    """Usage guide = the README's workflow section (single source of truth)."""
    p = ROOT / "README.md"
    text = p.read_text(encoding="utf-8") if p.is_file() else "no README"
    start = text.find("## How you actually use it")
    if start != -1:
        end = text.find("\n## ", start + 10)
        text = text[start:end] if end != -1 else text[start:]
    return dict(markdown=text)


@app.get("/api/lint")
def lint(request: Request):
    from backend.lint import triage  # Lazy: keeps the AI-credit machinery out of module import
    scope = _q(request, "scope", "all")
    if scope not in ("raw", "finished", "all"):
        raise HTTPException(400, "bad scope")
    if _q(request, "include_dismissed"):
        report = checker.lint(include_dismissed=True, scope=scope)
    else:
        report = _refresh_lint(scope=scope)
    report = dict(report)
    triage.annotate(report)
    # Auto-run triage when flags await review and the worker is idle (not
    # already running, not in post-failure backoff). This is what actually
    # drains "N awaiting review"; the poller only schedules on disk change.
    st = triage.status()
    if report.get("triage_pending", 0) > 0 and not st["running"] and not st["in_backoff"]:
        triage.schedule(report)
        st = triage.status()
    report["triage"] = st
    return report


@app.post("/api/lint/dismiss")
def lint_dismiss(body: dict = Depends(json_body)):
    checker.dismiss(body["category"], body["key"])
    _refresh_lint(force=True)
    return dict(ok=True)


@app.post("/api/lint/undismiss")
def lint_undismiss(body: dict = Depends(json_body)):
    checker.undismiss(body["category"], body["key"])
    _refresh_lint(force=True)
    return dict(ok=True)


@app.get("/api/threads")
def threads():
    return dict(threads=chat.list_threads())


@app.post("/api/threads")
def threads_create(body: dict = Depends(json_body)):
    return dict(id=chat.create_thread(body.get("title")))


@app.delete("/api/threads/{tid}")
def thread_delete(tid: int):
    chat.delete_thread(tid)
    return dict(ok=True)


@app.patch("/api/threads/{tid}")
def thread_patch(tid: int, body: dict = Depends(json_body)):
    try:
        chat.update_thread(tid, **body)
    except (TypeError, ValueError) as e:
        raise HTTPException(400, str(e))
    return dict(ok=True)


@app.get("/api/threads/{tid}/messages")
def messages(tid: int):
    return dict(messages=chat.get_messages(tid))


@app.post("/api/threads/{tid}/message")
def message(tid: int, body: dict = Depends(json_body)):
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(400, "empty message")
    try:
        turn = chat.start_turn(tid, text)
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    return dict(ok=True, turn=turn)


@app.get("/api/threads/{tid}/stream")
def stream(tid: int):
    def gen():
        q = chat.subscribe(tid)
        try:
            # Replay the active turn's persisted rows before going live. Read
            # them all up front so the sqlite cursor never crosses threadpool
            # worker threads between yields.
            replay = []
            active = chat.active_turn(tid)
            if active:
                conn = connect()
                replay = [json.loads(r["content"]) for r in conn.execute(
                    "SELECT content FROM messages WHERE thread_id=? AND turn=?"
                    " ORDER BY seq", (tid, active.turn_no))]
            for payload in replay:
                yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode()
            while True:
                try:
                    payload = q.get(timeout=15)
                    yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode()
                except queue.Empty:
                    yield b": ping\n\n"
        finally:
            chat.unsubscribe(tid, q)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "Connection": "keep-alive",
                                      "X-Accel-Buffering": "no"})


@app.post("/api/threads/{tid}/interrupt")
def interrupt(tid: int):
    return dict(ok=chat.interrupt(tid))


@app.get("/api/git/status")
def git_status(request: Request):
    try:
        return gitops.status(_q(request, "repo", "corpus"))
    except KeyError:
        raise HTTPException(400, "bad repo")


@app.get("/api/git/diff")
def git_diff(request: Request):
    try:
        return dict(diff=gitops.diff(_q(request, "repo", "corpus"),
                                     _q(request, "path") or None,
                                     _q(request, "mode", "head")))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except KeyError:
        raise HTTPException(400, "bad repo")


@app.get("/api/git/log")
def git_log(request: Request):
    try:
        res = gitops.log(_q(request, "repo", "corpus"),
                         n=int(_q(request, "n", "20")),
                         skip=int(_q(request, "skip", "0")),
                         path=_q(request, "path") or None)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except KeyError:
        raise HTTPException(400, "bad repo")
    return dict(log=res["entries"], has_more=res["has_more"])


@app.get("/api/git/show")
def git_show(request: Request):
    try:
        return gitops.commit_detail(_q(request, "repo", "corpus"),
                                    _q(request, "rev", ""))
    except (ValueError, RuntimeError) as e:
        raise HTTPException(400, str(e))
    except KeyError:
        raise HTTPException(400, "bad repo")


@app.get("/api/git/branches")
def git_branches(request: Request):
    try:
        return gitops.branches(_q(request, "repo", "corpus"))
    except KeyError:
        raise HTTPException(400, "bad repo")


@app.post("/api/git/commit")
def git_commit(body: dict = Depends(json_body)):
    try:
        h = gitops.commit(body.get("repo", "corpus"), body.get("message", ""),
                          body.get("paths") or None)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    except KeyError:
        raise HTTPException(400, "bad repo")
    return dict(ok=True, hash=h)


@app.post("/api/git/stage")
def git_stage(body: dict = Depends(json_body)):
    return _git_mutate(gitops.stage, body.get("repo", "corpus"),
                       body.get("paths") or [])


@app.post("/api/git/unstage")
def git_unstage(body: dict = Depends(json_body)):
    return _git_mutate(gitops.unstage, body.get("repo", "corpus"),
                       body.get("paths") or [])


@app.post("/api/git/apply")
def git_apply(body: dict = Depends(json_body)):
    return _git_mutate(gitops.apply_patch, body.get("repo", "corpus"),
                       body.get("patch") or "", bool(body.get("reverse")))


@app.post("/api/git/branch")
def git_branch(body: dict = Depends(json_body)):
    return _git_mutate(gitops.switch_branch, body.get("repo", "corpus"),
                       body.get("name") or "", bool(body.get("create")))


@app.get("/api/git/file")
def git_file(request: Request):
    try:
        return gitops.show(_q(request, "repo", "corpus"),
                           _q(request, "path", ""),
                           _q(request, "rev", "HEAD"))
    except (ValueError, RuntimeError, KeyError) as e:
        raise HTTPException(400, str(e))


@app.post("/api/git/revert")
def git_revert(body: dict = Depends(json_body)):
    try:
        gitops.revert(body.get("repo", "corpus"), body.get("path", ""))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    except KeyError:
        raise HTTPException(400, "bad repo")
    return dict(ok=True)


@app.post("/api/triage/reject")
def triage_reject(body: dict = Depends(json_body)):
    from backend.lint import triage  # Lazy: keeps the AI-credit machinery out of module import
    triage.user_override(body["category"], body["key"])
    _refresh_lint(force=True)
    return dict(ok=True)


@app.post("/api/triage/run")
def triage_run():
    """Manual 'Triage now': force a triage pass over the current flags,
    clearing any failure backoff."""
    from backend.lint import triage  # Lazy: keeps the AI-credit machinery out of module import
    report = _refresh_lint(scope="all")
    triage.run_now(dict(report))
    return dict(ok=True, triage=triage.status())


# -------------------------------------------------- files tab (/api/fs/*)

@app.get("/api/fs/list")
def fs_list(request: Request):
    d = safe_fs_path(_q(request, "path", "") or "")
    if d is None or not d.is_dir():
        raise HTTPException(404, "not a directory")
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
    return dict(path=rel, entries=entries)


@app.post("/api/fs/mkdir")
def fs_mkdir(body: dict = Depends(json_body)):
    d = safe_fs_path(body.get("path", ""))
    if d is None or d == FS_ROOT:
        raise HTTPException(400, "bad path")
    if d.exists():
        raise HTTPException(409, "already exists")
    d.mkdir(parents=True)
    return dict(ok=True)


@app.post("/api/fs/create")
def fs_create(body: dict = Depends(json_body)):
    f = safe_fs_path(body.get("path", ""))
    if f is None or f == FS_ROOT:
        raise HTTPException(400, "bad path")
    if f.exists():
        raise HTTPException(409, "already exists")
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("", encoding="utf-8")
    return dict(ok=True)


@app.post("/api/fs/rename")
def fs_rename(body: dict = Depends(json_body)):
    src = safe_fs_path(body.get("path", ""))
    dst = safe_fs_path(body.get("to", ""))
    if src is None or dst is None or src == FS_ROOT or dst == FS_ROOT:
        raise HTTPException(400, "bad path")
    if not src.exists():
        raise HTTPException(404, "not found")
    if dst.exists():
        raise HTTPException(409, "target exists")
    dst.parent.mkdir(parents=True, exist_ok=True)
    os.replace(src, dst)
    return dict(ok=True)


@app.post("/api/fs/delete")
def fs_delete(body: dict = Depends(json_body)):
    f = safe_fs_path(body.get("path", ""))
    if f is None or f == FS_ROOT:
        raise HTTPException(400, "bad path")
    if not f.exists():
        raise HTTPException(404, "not found")
    if f.is_dir():
        shutil.rmtree(f)
    else:
        f.unlink()
    return dict(ok=True)


@app.get("/api/fs/download")
def fs_download(request: Request):
    f = safe_fs_path(_q(request, "path", ""))
    if f is None or not f.is_file():
        raise HTTPException(404, "not found")
    return FileResponse(
        f, media_type=MIME.get(f.suffix.lower(), "application/octet-stream"),
        filename=f.name)


@app.post("/api/fs/upload")
def fs_upload(path: str = "", data: bytes = Depends(raw_body)):
    f = safe_fs_path(path)
    if f is None or f == FS_ROOT:
        raise HTTPException(400, "bad path")
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(f.suffix + ".upload~")
    tmp.write_bytes(data)
    os.replace(tmp, f)
    return dict(ok=True, size=len(data))


# ------------------------------------------------- static + SPA fallback

@app.get("/{full_path:path}")
def static(full_path: str, request: Request):
    path = request.url.path
    rel = "index.html" if path in ("/", "") else path.lstrip("/")
    f = (STATIC / rel).resolve()
    if not str(f).startswith(str(STATIC)) or not f.is_file():
        if path.startswith("/api/"):
            raise HTTPException(404, "not found")
        f = STATIC / "index.html"  # SPA fallback
        if not f.is_file():
            raise HTTPException(404, "not found")
    body = f.read_bytes()
    immutable = "/assets/" in f.as_posix()
    return Response(
        body, media_type=MIME.get(f.suffix, "application/octet-stream"),
        headers={"Cache-Control": "public, max-age=31536000, immutable"
                 if immutable else "no-cache"})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default=HOST)
    ap.add_argument("--port", type=int, default=PORT)
    args = ap.parse_args()

    # Dev mode turns on backend hot-reload: uvicorn's reloader respawns the
    # worker on any backend/ edit. reload= needs an import string (not the app
    # object) so the reloader can re-import; the watch is scoped to backend/
    # because the frontend has its own HMR server (see scripts/container-start.sh).
    if DEV:
        print(f"Word Warehouse (dev: backend hot-reload) on http://{args.host}:{args.port}")
        uvicorn.run("backend.server:app", host=args.host, port=args.port,
                    reload=True, reload_dirs=[str(ROOT / "backend")])
        return

    print(f"Word Warehouse listening on http://{args.host}:{args.port}")
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
