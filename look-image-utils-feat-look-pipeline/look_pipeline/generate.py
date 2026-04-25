from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from google import genai
from google.genai import types

from look_pipeline.brief import (
    _supplement_mentions_pose,
    build_2a_user_turn_operator_lead,
    compile_brief_2a,
    normalize_prompt_extra,
)
from look_pipeline.image_gen_config import (
    build_image_generate_content_config,
    is_retryable_genai_http_error,
)
from look_pipeline.image_parts import bytes_to_image_part, save_first_image_from_response
from look_pipeline.manifest import POSE_REF_ROLE, rel_paths_for_role, role_has_reference_image
from look_pipeline.preprocess import preprocess_for_model
from look_pipeline.retry import call_with_retries


def _load_image_part(repo_root: Path, rel_path: str) -> types.Part:
    abs_path = (repo_root / rel_path).resolve()
    pre = preprocess_for_model(abs_path)
    return bytes_to_image_part(pre.jpeg_bytes, pre.mime_type)


def run_step_2a(
    *,
    client: genai.Client,
    repo_root: Path,
    manifest: Mapping[str, Any],
    spec: Mapping[str, Any],
    model: str,
    brief_path: Path,
    out_image: Path,
) -> None:
    roles = manifest["roles"]
    pe = normalize_prompt_extra(manifest)
    # 有运营补充时：原文放在 user 首条，不重复塞进 system，避免与「首段 user = 强指令」的常见模型习惯错开
    embed_op_in_system = not bool(pe)
    brief = compile_brief_2a(spec, manifest=manifest, embed_operator_in_system=embed_op_in_system)
    long_look_ref = bool(_supplement_mentions_pose(pe))
    brief_path.parent.mkdir(parents=True, exist_ok=True)
    brief_path.write_text(brief, encoding="utf-8")
    contents: list[str | types.Part] = []
    user_lead = build_2a_user_turn_operator_lead(manifest)
    if user_lead:
        contents.append(user_lead)
    order_2a: list[str] = ["look_ref"]
    for r in ("look_ref_side", "look_ref_back"):
        if role_has_reference_image(manifest, r):
            order_2a.append(r)
    if bool(manifest.get("pose_ref_in_2a", False)) and role_has_reference_image(
        manifest, POSE_REF_ROLE
    ):
        order_2a.append(POSE_REF_ROLE)
    order_2a.extend(["face", "sku_flat"])
    for role in order_2a:
        rels = rel_paths_for_role(roles, role)
        if not rels:
            continue
        n = len(rels)
        for i, rel in enumerate(rels):
            if role == POSE_REF_ROLE:
                label = (
                    "ROLE=pose_ref: additional pose/body view for the 2A render; align the hero with "
                    "### POSE_BLOCK in the system instruction; this image is included because pose_ref_in_2a is true"
                )
            elif role == "look_ref" and n == 1 and long_look_ref:
                label = (
                    "ROLE=look_ref (LOOK / hero). **Mood, lighting, palette, set, and atmosphere** follow **this** reference (each new "
                    "LOOK = new target; no fixed “one” composition for all jobs). For **pose and crop** vs. this file, use the **first user** "
                    "operator/运营段 in this same request with `### POSE_BLOCK` and the *soft* `### FRAMING_AND_ATMOSPHERE` in the system "
                    "instruction. If that operator text wants a tight crop, partial face, or dramatic framing, **follow the text** over the "
                    "default anti-clipping nudge; otherwise **bias away from accidental** edge cut-offs on head/hands that feel "
                    "unintentional for this shoot’s look."
                )
            elif n == 1:
                label = f"ROLE={role}"
            else:
                label = f"ROLE={role} view {i + 1}/{n} (multi-angle / multi-view)"
            contents.append(label)
            contents.append(_load_image_part(repo_root, rel))
    cfg = build_image_generate_content_config(system_instruction=brief)

    def call() -> Any:
        return client.models.generate_content(model=model, contents=contents, config=cfg)

    resp = call_with_retries(
        call,
        is_retryable_genai_http_error,
        max_attempts=4,
        base_sleep_seconds=1.0,
    )
    save_first_image_from_response(resp, out_image)

