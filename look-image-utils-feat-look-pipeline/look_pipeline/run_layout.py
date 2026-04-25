from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class RunLayout:
    base_dir: Path
    run_id: str
    _draft_2a_cache: Path | None = field(default=None, init=False, repr=False, compare=False)

    @property
    def run_dir(self) -> Path:
        return self.base_dir / self.run_id

    @property
    def manifest_path(self) -> Path:
        return self.run_dir / "input_manifest.json"

    @property
    def approved_spec_path(self) -> Path:
        return self.run_dir / "look_spec_approved.json"

    @property
    def draft_2a_path(self) -> Path:
        """含时间戳的文件名。首次访问时生成并缓存，后续调用返回相同路径。"""
        if self._draft_2a_cache is not None:
            return self._draft_2a_cache
        timestamp_millisecond = int(time.time() * 1000)
        self._draft_2a_cache = self.run_dir / f"draft_2a_{timestamp_millisecond}.png"
        return self._draft_2a_cache

    @property
    def brief_2a_path(self) -> Path:
        return self.run_dir / "brief_2a.txt"

    def refined_draft_path(self, k: int) -> Path:
        return self.run_dir / f"draft_refined_{k}.png"

    def regions_path(self, k: int) -> Path:
        return self.run_dir / f"regions_{k}.json"

    def run_state_path(self) -> Path:
        return self.run_dir / "run_state.json"

    def gate_draft_approved_path(self) -> Path:
        return self.run_dir / "gate_draft_approved.json"

    def gate_final_approved_path(self) -> Path:
        return self.run_dir / "gate_final_approved.json"

    def gate_refine_approved_path(self, k: int) -> Path:
        return self.run_dir / f"gate_refine_{k}_approved.json"


def default_runs_dir(repo_root: Path) -> Path:
    return repo_root / "runs"
