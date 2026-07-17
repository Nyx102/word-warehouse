"""Thin git wrappers for the two repos the workbench exposes."""

import subprocess

from config import CORPUS, REPO

REPOS = {"corpus": CORPUS, "repo": REPO}


def _run(repo, *args, check=True):
    cwd = REPOS[repo]
    r = subprocess.run(["git", "-C", str(cwd), *args],
                       capture_output=True, text=True, timeout=30)
    if check and r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or f"git {' '.join(args)} failed")
    return r.stdout


def status(repo):
    out = _run(repo, "status", "--porcelain")
    files = []
    for line in out.splitlines():
        if len(line) > 3:
            files.append(dict(status=line[:2].strip(), path=line[3:].strip()))
    return files


def dirty_count(repo):
    try:
        return len(status(repo))
    except Exception:
        return -1


def diff(repo, path=None):
    args = ["diff", "HEAD"] if head_exists(repo) else ["diff"]
    if path:
        args += ["--", path]
    out = _run(repo, *args)
    if not out:
        # untracked files produce no diff vs HEAD; synthesize with -N intent
        args2 = ["diff"] + (["--", path] if path else [])
        out = _run(repo, *args2)
    return out


def head_exists(repo):
    r = subprocess.run(["git", "-C", str(REPOS[repo]), "rev-parse", "HEAD"],
                       capture_output=True, text=True)
    return r.returncode == 0


def log(repo, n=20):
    out = _run(repo, "log", f"-{n}", "--pretty=%h\t%ad\t%s", "--date=short")
    entries = []
    for line in out.splitlines():
        h, d, s = line.split("\t", 2)
        entries.append(dict(hash=h, date=d, subject=s))
    return entries


def commit(repo, message, paths):
    if not message.strip():
        raise RuntimeError("empty commit message")
    if not paths:
        raise RuntimeError("no paths selected")
    _run(repo, "add", "--", *paths)
    _run(repo, "commit", "-m", message)
    return _run(repo, "rev-parse", "--short", "HEAD").strip()
