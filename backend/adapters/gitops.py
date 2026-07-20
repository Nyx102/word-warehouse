"""Git wrappers for the two repos this server exposes.

Error contract: ValueError for rejected input (bad rev, unsafe path, bad
branch name, empty message), RuntimeError for a failed git command. Handlers
map them to 400 and 409 respectively.
"""

import re
import subprocess
import threading

from backend.config import REPO, ROOT

# "corpus" is the unified project repo (code + corpus data, user decision);
# "repo" is the nested translation repo. API key names are frozen contract.
REPOS = {"corpus": ROOT, "repo": REPO}

# Serializes mutating ops per repo; reads stay unlocked
_MUTEX = {name: threading.Lock() for name in REPOS}

_REV_OK = re.compile(r"^[0-9a-zA-Z][0-9a-zA-Z_./^~-]{0,63}$")


def _run(repo, *args, check=True):
    cwd = REPOS[repo]
    r = subprocess.run(["git", "-C", str(cwd), *args],
                       capture_output=True, text=True, timeout=30)
    if check and r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or f"git {' '.join(args)} failed")
    return r.stdout


def _safe_rel(path):
    if not path or path.startswith(("/", "-")) or ".." in path.split("/"):
        raise ValueError(f"unsafe path: {path!r}")
    return path


def head_exists(repo):
    r = subprocess.run(["git", "-C", str(REPOS[repo]), "rev-parse", "HEAD"],
                       capture_output=True, text=True)
    return r.returncode == 0


# ------------------------------------------------------------------- status

def _entry(path, orig_path, xy, untracked):
    return dict(path=path, orig_path=orig_path,
                index="" if xy[0] in ".?" else xy[0],
                worktree="" if xy[1] in ".?" else xy[1],
                untracked=untracked,
                # Legacy key kept for the pre-rework frontend ('M', '??', ...)
                status="??" if untracked else xy.replace(".", " ").strip())


def status(repo):
    out = _run(repo, "status", "--porcelain=v2", "-z", "--branch",
               "--untracked-files=all")
    branch = dict(head=None, oid=None, upstream=None, ahead=None, behind=None)
    files = []
    tokens = out.split("\0")
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        i += 1
        if not tok:
            continue
        if tok.startswith("# "):
            parts = tok.split(" ", 2)
            key, val = parts[1], (parts[2] if len(parts) > 2 else "")
            if key == "branch.head":
                branch["head"] = val
            elif key == "branch.oid":
                branch["oid"] = val
            elif key == "branch.upstream":
                branch["upstream"] = val
            elif key == "branch.ab":
                a, b = val.split(" ")
                branch["ahead"], branch["behind"] = int(a[1:]), int(b[1:])
        elif tok.startswith("1 "):
            parts = tok.split(" ", 8)
            files.append(_entry(parts[8], None, parts[1], untracked=False))
        elif tok.startswith("2 "):
            # Rename/copy entries consume TWO NUL tokens: path, then origPath
            parts = tok.split(" ", 9)
            orig = tokens[i]
            i += 1
            files.append(_entry(parts[9], orig, parts[1], untracked=False))
        elif tok.startswith("u "):
            parts = tok.split(" ", 10)
            files.append(_entry(parts[10], None, parts[1], untracked=False))
        elif tok.startswith("? "):
            files.append(_entry(tok[2:], None, "??", untracked=True))
    return dict(branch=branch, files=files)


def dirty_count(repo):
    try:
        return len(status(repo)["files"])
    except Exception:
        return -1


# --------------------------------------------------------------------- diff

def diff(repo, path=None, mode="head"):
    if mode == "worktree":
        args = ["diff"]
    elif mode == "staged":
        args = ["diff", "--cached"]
    elif mode == "head":
        args = ["diff", "HEAD"] if head_exists(repo) else ["diff"]
    else:
        raise ValueError(f"bad diff mode: {mode!r}")
    if path:
        args += ["--", path]
    out = _run(repo, *args)
    if mode == "head" and not out:
        # Untracked files produce no diff vs HEAD; synthesize with -N intent
        args2 = ["diff"] + (["--", path] if path else [])
        out = _run(repo, *args2)
    return out


def show(repo, path, rev="HEAD"):
    """Content of path at rev; {exists: False} when absent at that rev."""
    if not _REV_OK.match(rev):
        raise ValueError(f"bad rev: {rev!r}")
    _safe_rel(path)
    r = subprocess.run(["git", "-C", str(REPOS[repo]), "show", f"{rev}:{path}"],
                       capture_output=True, text=True, timeout=30)
    if r.returncode != 0:
        return dict(path=path, rev=rev, exists=False, content="")
    return dict(path=path, rev=rev, exists=True, content=r.stdout)


# -------------------------------------------------------------------- index

def stage(repo, paths):
    if not paths:
        raise ValueError("no paths")
    for p in paths:
        _safe_rel(p)
    with _MUTEX[repo]:
        _run(repo, "add", "--", *paths)


def unstage(repo, paths):
    """Index-only: never touches the worktree."""
    if not paths:
        raise ValueError("no paths")
    for p in paths:
        _safe_rel(p)
    with _MUTEX[repo]:
        if head_exists(repo):
            _run(repo, "restore", "--staged", "--", *paths)
        else:
            _run(repo, "rm", "--cached", "-r", "--ignore-unmatch", "--", *paths)


def _unquote(s):
    """Decode a C-style quoted path from git diff output far enough for the
    safety checks; octal escapes decode bytewise, which is fine because the
    checks only look at ASCII '.', '/', '-'."""
    body, out, i = s[1:-1], [], 0
    while i < len(body):
        c = body[i]
        if c == "\\" and i + 1 < len(body):
            e = body[i + 1]
            if e in "01234567":
                out.append(chr(int(body[i + 1:i + 4], 8)))
                i += 4
                continue
            out.append({"n": "\n", "t": "\t"}.get(e, e))
            i += 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


_DIFF_GIT = re.compile(r'^diff --git (?:"a/(.+)"|a/(.+?)) (?:"b/(.+)"|b/(.+))$')


def _patch_paths(patch):
    for line in patch.splitlines():
        if line.startswith("diff --git "):
            m = _DIFF_GIT.match(line)
            if not m:
                raise ValueError(f"unparsable diff header: {line!r}")
            qa, a, qb, b = m.groups()
            yield _unquote(f'"{qa}"') if qa is not None else a
            yield _unquote(f'"{qb}"') if qb is not None else b
        elif line.startswith(("--- ", "+++ ")):
            rest = line[4:]
            if rest == "/dev/null":
                continue
            if rest.startswith('"') and rest.endswith('"'):
                rest = _unquote(rest)
            if rest[:2] in ("a/", "b/"):
                rest = rest[2:]
            yield rest


def apply_patch(repo, patch, reverse=False):
    """Apply patch text to the index only. The caller sends server-produced
    diff text back verbatim (file header block + selected hunks); a stale
    index makes git apply fail cleanly, surfaced as 409."""
    for p in _patch_paths(patch):
        _safe_rel(p)
    args = ["apply", "--cached", "--whitespace=nowarn"]
    if reverse:
        args.append("-R")
    args.append("-")
    with _MUTEX[repo]:
        r = subprocess.run(["git", "-C", str(REPOS[repo]), *args],
                           input=patch, capture_output=True, text=True,
                           timeout=30)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or "git apply failed")


# ---------------------------------------------------------------------- log

def log(repo, n=20, skip=0, path=None):
    if not head_exists(repo):
        return dict(entries=[], has_more=False)
    # Fetch n+1 as the has_more sentinel; \x1f separates fields because
    # subjects can contain tabs
    args = ["log", f"-{n + 1}", f"--skip={skip}",
            "--format=%H%x1f%h%x1f%an%x1f%ad%x1f%s", "--date=iso-strict"]
    if path:
        _safe_rel(path)
        args += ["--follow", "--", path]
    entries = []
    for line in _run(repo, *args).splitlines():
        oid, short, author, date, subject = line.split("\x1f", 4)
        entries.append(dict(hash=short, oid=oid, author=author, date=date,
                            subject=subject))
    return dict(entries=entries[:n], has_more=len(entries) > n)


def commit_detail(repo, rev):
    if not _REV_OK.match(rev):
        raise ValueError(f"bad rev: {rev!r}")
    oid = _run(repo, "rev-parse", "--verify", "--end-of-options",
               f"{rev}^{{commit}}").strip()
    raw = _run(repo, "show", "-s", "--date=iso-strict",
               "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%P%x1f%s%x1f%b", oid)
    full, short, author, email, date, parents, subject, body = \
        raw.split("\x1f", 7)
    meta = dict(hash=full, short=short, author=author, email=email, date=date,
                parents=parents.split(), subject=subject,
                body=body.strip("\n"))
    stat = []
    for line in _run(repo, "show", "--numstat", "--format=", oid).splitlines():
        if not line.strip():
            continue
        added, deleted, p = line.split("\t", 2)
        stat.append(dict(path=p,
                         added=None if added == "-" else int(added),
                         deleted=None if deleted == "-" else int(deleted)))
    patch = _run(repo, "show", "--patch", "--format=", oid)
    return dict(meta=meta, stat=stat, patch=patch)


# ----------------------------------------------------------------- branches

def branches(repo):
    r = subprocess.run(
        ["git", "-C", str(REPOS[repo]), "symbolic-ref", "--quiet", "--short",
         "HEAD"], capture_output=True, text=True)
    current = r.stdout.strip() if r.returncode == 0 else None
    out = _run(repo, "for-each-ref", "refs/heads",
               "--format=%(refname:short)%1f%(objectname:short)%1f%(subject)")
    items = []
    for line in out.splitlines():
        name, short, subject = line.split("\x1f", 2)
        items.append(dict(name=name, current=(name == current),
                          short=short, subject=subject))
    return dict(current=current, branches=items)


def switch_branch(repo, name, create=False):
    ok = (name and not name.startswith("-")
          and subprocess.run(["git", "check-ref-format", "--branch", name],
                             capture_output=True).returncode == 0)
    if not ok:
        raise ValueError(f"bad branch name: {name!r}")
    args = ["switch", "-c", name] if create else ["switch", name]
    with _MUTEX[repo]:
        _run(repo, *args)


# ------------------------------------------------------------ revert/commit

def revert(repo, path):
    """Git restore a file to its HEAD state; refuse whenever the path has no
    HEAD version (untracked, staged-new, rename target). Restore would then
    DELETE the file rather than revert it, and this endpoint never deletes."""
    _safe_rel(path)
    with _MUTEX[repo]:
        st = _run(repo, "status", "--porcelain", "--", path)
        if not st.strip():
            return  # Already clean
        at_head = subprocess.run(
            ["git", "-C", str(REPOS[repo]), "cat-file", "-e", f"HEAD:{path}"],
            capture_output=True)
        if at_head.returncode != 0:
            raise RuntimeError(
                f"{path} has no committed version (untracked or newly staged);"
                " restoring would delete it—remove the file manually if unwanted")
        _run(repo, "restore", "--staged", "--worktree", "--", path)


def commit(repo, message, paths=None):
    """Truthy paths keeps the legacy add-then-commit contract; paths=None
    commits the staged set and requires staged content."""
    if not message.strip():
        raise ValueError("empty commit message")
    with _MUTEX[repo]:
        if paths:
            for p in paths:
                _safe_rel(p)
            _run(repo, "add", "--", *paths)
        elif subprocess.run(["git", "-C", str(REPOS[repo]), "diff", "--cached",
                             "--quiet"], capture_output=True).returncode == 0:
            raise RuntimeError("nothing staged")
        _run(repo, "commit", "-m", message)
    return _run(repo, "rev-parse", "--short", "HEAD").strip()
