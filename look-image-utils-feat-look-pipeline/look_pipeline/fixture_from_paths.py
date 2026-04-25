"""
从「已存在于工作区内的相对路径」拼出与 README 一致的 fixture 字典，并可只落盘一个 .json（不复制任何图片文件）。
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

# 可选：将生成的仅含路径的 json 存于此目录下
STAGING_RELP = "jobs/_streamlit_ingest"
# 单一路径名段中在常见系统下不宜出现的字符；其余（含中文）可保留
_FORBIDDEN_IN_RUN_ID = re.compile(r'[/\\:\*\?"<>\|\x00-\x1f\x7f\u2028\u2029]')
_DOTDOT = re.compile(r"\.\.")


def safe_run_id(raw: str) -> str:
    t = (raw or "").strip()
    if not t:
        t = f"ui-{time.strftime('%Y%m%d-%H%M%S')}"
    t = _FORBIDDEN_IN_RUN_ID.sub("-", t)
    t = _DOTDOT.sub("-", t)
    t = t.strip("._- \t")
    t = t[:100]
    if not t or t in (".", ".."):
        t = f"ui-{int(time.time())}"
    return t


def _norm_relpath(s: str) -> str:
    return s.strip().replace("\\", "/").lstrip("/")


def build_fixture(
    run_id: str,
    look_ref: str,
    sku_multiline: str,
    fabric_detail: str,
    face: str,
    logo: str,
    prompt_extra: str,
    pose_ref: str = "",
    pose_ref_in_2a: bool = False,
) -> tuple[dict[str, Any], str | None]:
    """
    仅使用路径字符串（相对工作区根、POSIX 风格）组装 fixture。
    ``pose_ref`` 可选。``pose_ref_in_2a`` 为真时 2A 也会将姿态图作为参考，否则仅影响 understand 中 pose 段。
    成功返回 (dict, None)；失败返回 ({}, 错误信息)。
    """
    look = _norm_relpath(look_ref)
    fab = _norm_relpath(fabric_detail)
    if not look:
        return {}, "look_ref 不能为空"
    if not fab:
        return {}, "fabric_detail 不能为空"
    sku_list = [_norm_relpath(x) for x in sku_multiline.splitlines() if _norm_relpath(x)]
    if not sku_list:
        return {}, "sku（平铺图）请至少填一行有效路径，占一行一个路径；多张则多行"
    d: dict[str, Any] = {
        "run_id": safe_run_id(run_id),
        "look_ref": look,
        "sku_flat": sku_list[0] if len(sku_list) == 1 else sku_list,
        "fabric_detail": fab,
    }
    pr = _norm_relpath(pose_ref)
    if pr:
        d["pose_ref"] = pr
    f = _norm_relpath(face)
    if f:
        d["face"] = f
    lg = _norm_relpath(logo)
    if lg:
        d["logo_ref"] = lg
    p = (prompt_extra or "").strip()
    if p:
        d["prompt_extra"] = p
    d["pose_ref_in_2a"] = bool(pose_ref_in_2a)
    return d, None


def check_paths_exist(repo: Path, d: dict[str, Any]) -> list[str]:
    """若文件不在磁盘上，返回人可读提示行。"""
    repo = repo.resolve()
    missing: list[str] = []
    for key, val in d.items():
        if key in ("run_id", "prompt_extra", "pose_ref_in_2a"):
            continue
        if isinstance(val, str):
            paths = [val]
        elif isinstance(val, list):
            paths = [str(x) for x in val if isinstance(x, str) and str(x).strip()]
        else:
            continue
        for rel in paths:
            reln = _norm_relpath(rel)
            p = (repo / reln).resolve()
            try:
                p.relative_to(repo)
            except ValueError:
                missing.append(f"越界路径: {reln}")
                continue
            if not p.is_file():
                missing.append(f"不是已存在文件: {reln}")
    return missing


def write_fixture_json(
    repo: Path, d: dict[str, Any]
) -> Path:
    """写入 ``{STAGING_RELP}/<run_id>.json``，不触碰图片文件。"""
    rrepo = repo.resolve()
    rid = str(d["run_id"])
    if not rid:
        raise ValueError("missing run_id")
    relp = f"{STAGING_RELP}/{rid}.json"
    path = (rrepo / relp).resolve()
    if not str(path).startswith(str(rrepo)):
        raise ValueError("invalid path")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return path
