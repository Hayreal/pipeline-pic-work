"""Resolve which draft PNG to use as a base for downstream edits (logo, future 2B, etc.)."""

from __future__ import annotations

import re
from pathlib import Path

_REFINED_DRAFT_NAME = re.compile(r"^draft_refined_(\d+)\.png$")
_DRAFT_2A_NAME = re.compile(r"^draft_2a.*\.png$")


def resolve_draft_source(run_dir: Path, explicit: Path | None) -> Path:
    """Pick draft PNG: explicit path, else highest ``draft_refined_{k}.png``, else ``draft_2a*.png``."""
    if explicit is not None:
        p = explicit.resolve()
        if not p.is_file():
            msg = f"draft image is not a file: {p}"
            raise FileNotFoundError(msg)
        return p
    best_k: int | None = None
    best: Path | None = None
    for candidate in run_dir.glob("draft_refined_*.png"):
        m = _REFINED_DRAFT_NAME.match(candidate.name)
        if not m:
            continue
        k = int(m.group(1))
        if best_k is None or k > best_k:
            best_k = k
            best = candidate
    if best is not None:
        return best
    # Match timestamped draft_2a filename (e.g. draft_2a_1714234567890.png)
    for candidate in run_dir.glob("draft_2a*.png"):
        if _DRAFT_2A_NAME.match(candidate.name):
            return candidate
    return run_dir / "draft_2a.png"
