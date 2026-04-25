"""
以与 CLI 相同方式解析并执行子命令，捕获标准输出/错误，供 Web / Streamlit 复用。
"""
from __future__ import annotations

import contextlib
from io import StringIO
from typing import Any

from look_pipeline.cli import build_parser

MAX_INVOKE_ARGS = 256
MAX_PATH_LEN = 4096


def run_cli_argv(argv: list[str]) -> dict[str, Any]:
    if not argv or not isinstance(argv, list):
        return {"ok": False, "error": "args 必须为非空数组"}
    if len(argv) > MAX_INVOKE_ARGS:
        return {"ok": False, "error": f"args 数量过多（> {MAX_INVOKE_ARGS}）"}
    for a in argv:
        if not isinstance(a, str):
            return {"ok": False, "error": "args 中每项须为字符串"}
        if len(a) > MAX_PATH_LEN:
            return {"ok": False, "error": "参数过长"}
    out_buf = StringIO()
    err_buf = StringIO()
    try:
        with contextlib.redirect_stdout(out_buf), contextlib.redirect_stderr(err_buf):
            p = build_parser()
            ns = p.parse_args(argv)
            ns.func(ns)
    except SystemExit as e:
        code = e.code if e.code is not None else 0
        c = code if isinstance(code, int) else 2
        return {
            "ok": c == 0,
            "exit": c,
            "stdout": out_buf.getvalue(),
            "stderr": (err_buf.getvalue() or "") or "",
        }
    except Exception as e:
        return {
            "ok": False,
            "exit": 1,
            "error": f"{type(e).__name__}: {e}",
            "stdout": out_buf.getvalue(),
            "stderr": err_buf.getvalue() or "",
        }
    return {
        "ok": True,
        "exit": 0,
        "stdout": out_buf.getvalue(),
        "stderr": err_buf.getvalue() or "",
    }
