"""Path guards for the three roots the server exposes.

The distinct roots are intentional: corpus paths serve the search/lint
surface, repo paths speak the same (repo, relative path) space as git
status, and fs paths cover the Files-tab tree rooted at FS_ROOT.
"""

from backend.adapters import gitops
from backend.config import CORPUS, FS_ROOT


def safe_corpus_path(rel):
    if not rel or ".git" in rel.split("/"):
        return None
    f = (CORPUS / rel).resolve()
    if not str(f).startswith(str(CORPUS)):
        return None
    return f


def safe_repo_path(repo, rel):
    """Resolve a repo-relative path under one of gitops' repos (ROOT for
    'corpus', the nested translation repo for 'repo'). The git views list
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


def safe_fs_path(rel):
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
