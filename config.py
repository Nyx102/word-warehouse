"""Shared paths and file classification for the WorldEnd workbench."""

import os
import re
from pathlib import Path

CORPUS = Path(os.environ.get("WORKBENCH_CORPUS", "/home/ubuntu/worldend/corpus"))
APP = Path(__file__).resolve().parent
DATA = Path(os.environ.get("WORKBENCH_DATA", str(APP / "data")))
DB_PATH = DATA / "corpus.db"

REPO = CORPUS / "worldend2/repo"
RULES_YAML = REPO / "Volumes/replacements.yaml"
SCRIPTS_DIR = REPO / "Scripts"

HOST = os.environ.get("WORKBENCH_HOST", "100.111.187.66")
PORT = int(os.environ.get("WORKBENCH_PORT", "8686"))

# glob patterns (relative to CORPUS) that make up the index, and nothing else
INCLUDE_GLOBS = [
    "worldend/official-en/*.txt",
    "worldend/jp/*.txt",
    "worldend/zh/*.txt",
    "worldend2/jp/*.txt",
    "worldend2/zh/*.txt",
    "worldend2/repo/Volumes/Volume_*/Text/*.md",
    "worldend2/repo/Docs/*.txt",
    "raw/*.md",
    "raw/*.txt",
    "inbox/*",
    "notes/*.md",
]

_VOL_FROM_NAME = re.compile(r"^v(\d+)")
_VOL_FROM_RAW = re.compile(r"vol(?:ume)?\.?\s*(\d+)", re.I)
_FAN_FILE = re.compile(r"worldend2/repo/Volumes/Volume_(\d+)/Text/([\d.]+)\.md$")


def classify(rel: str):
    """rel (posix, relative to CORPUS) -> dict(source, lang, series, volume, chapter_label) or None."""
    m = _FAN_FILE.search(rel)
    if m:
        return dict(source="fan", lang="en", series=2, volume=m.group(1),
                    chapter_label=m.group(2))
    parts = rel.split("/")
    name = parts[-1]
    stem = name.rsplit(".", 1)[0]

    def vol():
        m = _VOL_FROM_NAME.match(stem)
        if m:
            return m.group(1)
        return "ex" if stem.startswith("ex") else None

    if rel.startswith("worldend/official-en/"):
        return dict(source="official", lang="en", series=1, volume=vol(), chapter_label=None)
    # lang=None -> indexer sniffs the content (zh dirs mix simplified/traditional rips)
    if rel.startswith("worldend/jp/"):
        return dict(source="jp", lang=None, series=1, volume=vol(), chapter_label=None)
    if rel.startswith("worldend/zh/"):
        return dict(source="zh", lang=None, series=1, volume=vol(), chapter_label=None)
    if rel.startswith("worldend2/jp/"):
        return dict(source="jp", lang=None, series=2, volume=vol(), chapter_label=None)
    if rel.startswith("worldend2/zh/"):
        return dict(source="zh", lang=None, series=2, volume=vol(), chapter_label=None)
    if rel.startswith("worldend2/repo/Docs/"):
        return dict(source="docs", lang="en", series=2, volume=None, chapter_label=None)
    if rel.startswith("raw/"):
        m = _VOL_FROM_RAW.search(name)
        return dict(source="raw", lang=None, series=2, volume=(m.group(1).zfill(2) if m else None),
                    chapter_label=None)
    if rel.startswith("inbox/"):
        return dict(source="inbox", lang=None, series=None, volume=None, chapter_label=None)
    if rel.startswith("notes/"):
        return dict(source="notes", lang="en", series=None, volume=None, chapter_label=None)
    return None
