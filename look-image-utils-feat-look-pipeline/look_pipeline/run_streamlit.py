"""启动 Streamlit 控制台：`uv run look-pipeline-ui`。"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def main() -> int:
    app = Path(__file__).resolve().parent / "streamlit_app.py"
    return subprocess.call(
        [sys.executable, "-m", "streamlit", "run", str(app), *sys.argv[1:]],
    )


if __name__ == "__main__":
    raise SystemExit(main())
