#!/usr/bin/env python3
"""Live verification of gitops against scratch repos under data/tmp-verify/.

Repoints gitops.REPOS["repo"] at throwaway repos, exercises every operation,
and cleans up afterward. Exits nonzero on the first failed assertion.
"""

import shutil
import subprocess
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.adapters import gitops  # noqa: E402
from backend.config import DATA  # noqa: E402

TMP = DATA / "tmp-verify"
MAIN = TMP / "main-repo"
UNBORN = TMP / "unborn-repo"

_passed = 0


def ok(cond, label):
    global _passed
    if not cond:
        raise AssertionError(label)
    _passed += 1
    print(f"  ok {label}")


def git(repo_dir, *args, input=None):
    r = subprocess.run(["git", "-C", str(repo_dir), *args], input=input,
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {r.stderr.strip()}")
    return r.stdout


def make_repo(path):
    path.mkdir(parents=True)
    git(path, "init", "-b", "main")
    git(path, "config", "user.name", "verify")
    git(path, "config", "user.email", "verify@example.invalid")


def raises(exc, fn, *args, **kw):
    try:
        fn(*args, **kw)
    except exc:
        return True
    except Exception:
        return False
    return False


def setup_main():
    make_repo(MAIN)
    (MAIN / "tracked.txt").write_text("one\ntwo\nthree\n")
    (MAIN / "old.txt").write_text("rename me\nwith stable body\nlines here\n")
    (MAIN / "sp ace.txt").write_text("spaced\n")
    (MAIN / "hunky.txt").write_text(
        "".join(f"line {i}\n" for i in range(1, 41)))
    git(MAIN, "add", "-A")
    git(MAIN, "commit", "-m", "initial")
    (MAIN / "second.txt").write_text("second\n")
    git(MAIN, "add", "second.txt")
    git(MAIN, "commit", "-m", "second commit")
    (MAIN / "tracked.txt").write_text("one\nTWO\nthree\n")
    git(MAIN, "commit", "-am", "third commit: edit tracked")


def t_status():
    print("status: porcelain v2 parsing")
    (MAIN / "tracked.txt").write_text("one\nTWO!\nthree\n")
    (MAIN / "sp ace.txt").write_text("spaced edited\n")
    (MAIN / "untracked.txt").write_text("new\n")
    git(MAIN, "mv", "old.txt", "new.txt")

    st = gitops.status("repo")
    ok(st["branch"]["head"] == "main", "branch.head is main")
    ok(len(st["branch"]["oid"]) == 40, "branch.oid is a full sha")
    by_path = {f["path"]: f for f in st["files"]}
    ok(by_path["tracked.txt"]["worktree"] == "M"
       and by_path["tracked.txt"]["index"] == ""
       and by_path["tracked.txt"]["status"] == "M", "worktree-modified entry")
    ok(by_path["sp ace.txt"]["worktree"] == "M", "filename with spaces parsed")
    u = by_path["untracked.txt"]
    ok(u["untracked"] and u["status"] == "??", "untracked entry")
    r = by_path["new.txt"]
    ok(r["index"] == "R" and r["orig_path"] == "old.txt"
       and r["status"] == "R", "rename entry consumes both NUL tokens")
    ok(gitops.dirty_count("repo") == len(st["files"]), "dirty_count matches")

    git(MAIN, "mv", "new.txt", "old.txt")
    (MAIN / "untracked.txt").unlink()


def t_stage_unstage():
    print("stage/unstage round trip")
    gitops.stage("repo", ["tracked.txt"])
    by_path = {f["path"]: f for f in gitops.status("repo")["files"]}
    ok(by_path["tracked.txt"]["index"] == "M"
       and by_path["tracked.txt"]["worktree"] == "", "stage moves M to index")
    gitops.unstage("repo", ["tracked.txt"])
    by_path = {f["path"]: f for f in gitops.status("repo")["files"]}
    ok(by_path["tracked.txt"]["index"] == ""
       and by_path["tracked.txt"]["worktree"] == "M", "unstage restores")
    ok((MAIN / "tracked.txt").read_text() == "one\nTWO!\nthree\n",
       "unstage never touches the worktree")


def split_first_hunk(diff_text):
    """(header block, [hunks]) split byte-exact on @@ boundaries."""
    lines = diff_text.splitlines(keepends=True)
    starts = [i for i, l in enumerate(lines) if l.startswith("@@")]
    header = "".join(lines[:starts[0]])
    bounds = starts + [len(lines)]
    hunks = ["".join(lines[a:b]) for a, b in zip(bounds, bounds[1:])]
    return header, hunks


def t_hunks():
    print("hunk cycle: stage one of two hunks, then reverse")
    (MAIN / "hunky.txt").write_text(
        "".join("EDITED 2\n" if i == 2 else "EDITED 38\n" if i == 38
                else f"line {i}\n" for i in range(1, 41)))
    diff = gitops.diff("repo", "hunky.txt", mode="worktree")
    header, hunks = split_first_hunk(diff)
    ok(len(hunks) == 2, "two far-apart edits produce two hunks")
    gitops.apply_patch("repo", header + hunks[0])
    staged = gitops.diff("repo", "hunky.txt", mode="staged")
    ok("EDITED 2" in staged and "EDITED 38" not in staged,
       "apply_patch staged hunk 1 only")
    gitops.apply_patch("repo", header + hunks[0], reverse=True)
    ok(gitops.diff("repo", "hunky.txt", mode="staged") == "",
       "reverse apply leaves the index clean")
    ok("EDITED 2" in (MAIN / "hunky.txt").read_text(),
       "worktree untouched by index-only applies")
    git(MAIN, "checkout", "--", "hunky.txt")


def t_commit_staged():
    print("commit with paths=None commits the staged set only")
    ok(raises(RuntimeError, gitops.commit, "repo", "nothing here"),
       "commit refuses when nothing is staged")
    ok(raises(ValueError, gitops.commit, "repo", "  "),
       "commit refuses empty message")
    gitops.stage("repo", ["tracked.txt"])
    (MAIN / "sp ace.txt").write_text("spaced edited again\n")
    h = gitops.commit("repo", "staged-only commit")
    ok(len(h) >= 7, "commit returned a short hash")
    by_path = {f["path"]: f for f in gitops.status("repo")["files"]}
    ok("tracked.txt" not in by_path, "staged file was committed")
    ok(by_path["sp ace.txt"]["worktree"] == "M",
       "unstaged edit left intact")
    git(MAIN, "checkout", "--", "sp ace.txt")


def t_log():
    print("log paging")
    total = len(git(MAIN, "rev-list", "HEAD").splitlines())
    first = gitops.log("repo", n=2, skip=0)
    ok(len(first["entries"]) == 2 and first["has_more"],
       "page 1 full with has_more")
    e = first["entries"][0]
    ok(set(e) >= {"hash", "oid", "author", "date", "subject"}
       and "T" in e["date"], "entry keys + iso-strict date")
    last = gitops.log("repo", n=2, skip=total - 1)
    ok(len(last["entries"]) == 1 and not last["has_more"],
       "last page short without has_more")
    subjects = [x["subject"]
                for x in gitops.log("repo", n=10, path="tracked.txt")["entries"]]
    ok(len(subjects) >= 2 and "second commit" not in subjects,
       "path-filtered log follows the file")


def t_commit_detail():
    print("commit_detail shape")
    d = gitops.commit_detail("repo", "HEAD")
    ok(set(d) == {"meta", "stat", "patch"}, "top-level keys")
    m = d["meta"]
    ok(len(m["hash"]) == 40 and m["subject"] == "staged-only commit"
       and m["author"] == "verify" and len(m["parents"]) == 1
       and "T" in m["date"], "meta fields")
    ok(d["stat"] and d["stat"][0]["path"] == "tracked.txt"
       and isinstance(d["stat"][0]["added"], int), "numstat entries")
    ok("diff --git" in d["patch"], "patch text present")
    ok(raises(ValueError, gitops.commit_detail, "repo", "bad rev; rm -rf"),
       "bad rev rejected")
    ok(raises(RuntimeError, gitops.commit_detail, "repo", "deadbeef123"),
       "unknown rev rejected")


def t_branches():
    print("branch create/switch/switch-back")
    gitops.switch_branch("repo", "feature", create=True)
    b = gitops.branches("repo")
    ok(b["current"] == "feature"
       and {x["name"] for x in b["branches"]} == {"main", "feature"}
       and [x for x in b["branches"] if x["name"] == "feature"][0]["current"],
       "created and switched to feature")
    gitops.switch_branch("repo", "main")
    ok(gitops.branches("repo")["current"] == "main", "switched back to main")
    ok(raises(ValueError, gitops.switch_branch, "repo", "bad..name"),
       "bad branch name rejected")
    ok(raises(ValueError, gitops.switch_branch, "repo", "-flag"),
       "dash-leading branch name rejected")
    ok(raises(RuntimeError, gitops.switch_branch, "repo", "nonexistent"),
       "switch to unknown branch is a git failure")


def t_rejections():
    print("unsafe patch paths")
    evil = ("diff --git a/../evil b/../evil\n"
            "--- a/../evil\n+++ b/../evil\n"
            "@@ -0,0 +1 @@\n+boom\n")
    ok(raises(ValueError, gitops.apply_patch, "repo", evil),
       "patch naming ../evil rejected")
    ok(raises(ValueError, gitops.stage, "repo", ["../escape"]),
       "stage of ../escape rejected")
    ok(raises(ValueError, gitops.stage, "repo", []), "stage of [] rejected")


def t_unborn():
    print("unborn HEAD behavior")
    make_repo(UNBORN)
    gitops.REPOS["repo"] = UNBORN
    (UNBORN / "fresh.txt").write_text("hello\n")
    st = gitops.status("repo")
    ok(st["branch"]["head"] == "main"
       and st["files"][0]["status"] == "??", "status works pre-first-commit")
    ok(gitops.diff("repo", mode="staged") == "", "staged diff empty")
    ok(gitops.log("repo") == dict(entries=[], has_more=False), "log empty")
    gitops.stage("repo", ["fresh.txt"])
    ok("fresh" in gitops.diff("repo", mode="staged"), "stage works")
    gitops.unstage("repo", ["fresh.txt"])
    by_path = {f["path"]: f for f in gitops.status("repo")["files"]}
    ok(by_path["fresh.txt"]["untracked"], "unstage falls back to rm --cached")
    gitops.stage("repo", ["fresh.txt"])
    gitops.commit("repo", "first commit")
    ok(gitops.log("repo")["entries"][0]["subject"] == "first commit",
       "commit on unborn HEAD lands")


def main():
    if TMP.exists():
        shutil.rmtree(TMP)
    saved = dict(gitops.REPOS)
    try:
        setup_main()
        gitops.REPOS["repo"] = MAIN
        t_status()
        t_stage_unstage()
        t_hunks()
        t_commit_staged()
        t_log()
        t_commit_detail()
        t_branches()
        t_rejections()
        t_unborn()
    except Exception:
        traceback.print_exc()
        print(f"\nFAILED after {_passed} passing assertions")
        return 1
    finally:
        gitops.REPOS.clear()
        gitops.REPOS.update(saved)
        shutil.rmtree(TMP, ignore_errors=True)
    print(f"\nall good: {_passed} assertions")
    return 0


if __name__ == "__main__":
    sys.exit(main())
