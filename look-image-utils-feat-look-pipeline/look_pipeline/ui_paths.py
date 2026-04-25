"""工作区路径与 jobs/runs 列表，供 Web UI 与 Streamlit 复用。"""
from __future__ import annotations

from pathlib import Path

from look_pipeline.repo_root import default_repo_root


def _is_under_root(repo: Path, candidate: Path) -> bool:
    try:
        candidate.resolve().relative_to(repo)
        return True
    except ValueError:
        return False


def workspace_root() -> Path:
    return default_repo_root().resolve()


def list_job_fixtures(repo: Path | None = None) -> list[str]:
    repo = repo or workspace_root()
    out: list[str] = []
    seen: set[Path] = set()
    jobs = repo / "jobs"
    if not jobs.is_dir():
        return []
    for f in sorted(jobs.rglob("*.json")):
        if not f.is_file():
            continue
        r = f.resolve()
        if r in seen or not _is_under_root(repo, r):
            continue
        seen.add(r)
        try:
            out.append(r.relative_to(repo).as_posix())
        except ValueError:
            continue
    return out


def list_run_ids(repo: Path | None = None) -> list[str]:
    repo = repo or workspace_root()
    rd = repo / "runs"
    if not rd.is_dir():
        return []
    return sorted(
        (d.name for d in rd.iterdir() if d.is_dir() and d.name and not d.name.startswith(".")),
        key=str.lower,
    )
