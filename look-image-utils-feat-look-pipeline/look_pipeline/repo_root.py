from __future__ import annotations

import os
import sys
from pathlib import Path

# PyInstaller 单文件/目录包内 __file__ 指向临时解压区，不能当作「工作仓库根」。
# 可执行包分发时默认用当前工作目录（设计师在含 jobs/、.env 的项目夹里执行）。


def default_repo_root() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path.cwd()
    w = (os.environ.get("LOOK_WORKSPACE_ROOT", "") or "").strip()
    if w:
        p = Path(w).expanduser().resolve()
        if p.is_dir():
            return p
    here = Path(__file__).resolve()
    # pip / `uv tool install` 时包在 site-packages，不能用包目录当「工作仓库根」
    if "site-packages" in here.parts:
        return Path.cwd()
    return here.parent.parent
