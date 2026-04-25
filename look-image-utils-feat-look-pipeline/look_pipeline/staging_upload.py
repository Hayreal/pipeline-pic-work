"""
将本机选中的图片落盘到 jobs/_streamlit_ingest/<run_id>/，并生成可执行 fixture JSON（路径相对工作区根）。

供 Streamlit `file_uploader` 等调用，与 `fixture_from_paths` 的 STAGING 约定一致。
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Sequence

from look_pipeline.fixture_from_paths import STAGING_RELP, safe_run_id, write_fixture_json

FilePair = tuple[bytes, str]  # 字节 + 原文件名
OptionalPair = FilePair | None


def _suffix(name: str) -> str:
    s = (Path(name).suffix or "").lower()
    if s in (
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".gif",
        ".bmp",
        ".tiff",
        ".heic",
        ".avif",
    ):
        return s
    return ".png"


def write_staging_from_uploads(
    repo: Path,
    run_id: str,
    look: OptionalPair,
    pose_ref: OptionalPair,
    pose_ref_in_2a: bool,
    skus: Sequence[OptionalPair],
    fabric: OptionalPair,
    face: OptionalPair,
    logo: OptionalPair,
    prompt_extra: str,
) -> tuple[dict[str, Any] | None, str | None, Path | None]:
    """
    将上传字节写入 STAGING 目录，再写 ``<run_id>.json``。
    ``pose_ref`` 可选；``pose_ref_in_2a`` 为真时 fixture 会带该开关，2A 也会把姿态图作参考（见 generate）。
    成功返回 (fixture_dict, None, json_path)；失败返回 (None, error, None)。
    """
    if not look or not fabric or not look[0] or not fabric[0]:
        return None, "请为 LOOK 与 SKU 细节 各选一张图。", None
    sku_ok = [p for p in skus if p and p[0]]
    if not sku_ok:
        return None, "请至少选一张 SKU 平铺图。", None

    rrepo = repo.resolve()
    rid = safe_run_id(run_id)
    b = f"{STAGING_RELP}/{rid}"
    d: dict[str, Any] = {"run_id": rid}

    def _save(rel_relp: str, data: bytes) -> str:
        dest = (rrepo / rel_relp).resolve()
        if not str(dest).startswith(str(rrepo)) or ".." in rel_relp:
            raise ValueError("path escape")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        return dest.resolve().relative_to(rrepo).as_posix()

    d["look_ref"] = _save(
        f"{b}/look{_suffix(look[1])}", look[0]  # type: ignore[union-attr]
    )
    if pose_ref and pose_ref[0]:
        d["pose_ref"] = _save(
            f"{b}/pose_ref{_suffix(pose_ref[1])}", pose_ref[0]  # type: ignore[union-attr]
        )
    if len(sku_ok) == 1:
        d["sku_flat"] = _save(
            f"{b}/sku_0{_suffix(sku_ok[0][1])}", sku_ok[0][0]  # type: ignore[union-attr]
        )
    else:
        d["sku_flat"] = [
            _save(
                f"{b}/sku_{i}{_suffix(s[1])}", s[0]  # type: ignore[union-attr]
            )
            for i, s in enumerate(sku_ok)
        ]
    d["fabric_detail"] = _save(
        f"{b}/fabric{_suffix(fabric[1])}", fabric[0]  # type: ignore[union-attr]
    )
    if face and face[0]:
        d["face"] = _save(
            f"{b}/face{_suffix(face[1])}", face[0]  # type: ignore[union-attr]
        )
    if logo and logo[0]:
        d["logo_ref"] = _save(
            f"{b}/logo{_suffix(logo[1])}", logo[0]  # type: ignore[union-attr]
        )
    p = (prompt_extra or "").strip()
    if p:
        d["prompt_extra"] = p
    d["pose_ref_in_2a"] = bool(pose_ref_in_2a)
    try:
        jpath = write_fixture_json(rrepo, d)
    except (OSError, ValueError) as e:
        return None, str(e), None
    return d, None, jpath
