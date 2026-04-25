from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from google import genai
from google.genai import types

from look_pipeline.brief import (
    compile_brief_detail_edit,
    compile_brief_face_edit,
    compile_brief_logo_edit,
)
from look_pipeline.image_gen_config import (
    build_image_generate_content_config,
    is_retryable_genai_http_error,
)
from look_pipeline.image_parts import bytes_to_image_part, save_first_image_from_response
from look_pipeline.manifest import rel_paths_for_role, role_has_reference_image
from look_pipeline.preprocess import preprocess_for_model
from look_pipeline.retry import call_with_retries


def run_logo_edit(
    *,
    client: genai.Client,
    repo_root: Path,
    manifest: Mapping[str, Any],
    spec: Mapping[str, Any],
    base_image: Path,
    model: str,
    out_image: Path,
) -> None:
    if not role_has_reference_image(manifest, "logo_detail"):
        raise ValueError(
            "input_manifest has no logo_detail image (skipped). "
            "Add logo_detail to the fixture or run without logo-edit."
        )
    brief = compile_brief_logo_edit(spec)
    with base_image.open("rb") as f:
        base_bytes = f.read()
    mime = "image/png" if base_image.suffix.lower() == ".png" else "image/jpeg"
    rel = manifest["roles"]["logo_detail"]["path"]
    abs_path = (repo_root / rel).resolve()
    pre = preprocess_for_model(abs_path)
    contents: list[str | types.Part] = [
        bytes_to_image_part(base_bytes, mime),
        bytes_to_image_part(pre.jpeg_bytes, pre.mime_type),
    ]
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


def run_face_edit(
    *,
    client: genai.Client,
    repo_root: Path,
    manifest: Mapping[str, Any],
    spec: Mapping[str, Any],
    base_image: Path,
    model: str,
    out_image: Path,
    with_look_lighting_ref: bool,
) -> None:
    if not role_has_reference_image(manifest, "face"):
        raise ValueError(
            "input_manifest has no face reference image. Add face (string or list of paths) to the run fixture."
        )
    face_rels = rel_paths_for_role(manifest["roles"], "face")
    if not face_rels:
        raise ValueError("face role has no resolvable paths in manifest")
    look_for_light: str | None = None
    if with_look_lighting_ref and role_has_reference_image(manifest, "look_ref"):
        lr = rel_paths_for_role(manifest["roles"], "look_ref")
        if lr:
            look_for_light = lr[0]
    brief = compile_brief_face_edit(
        spec,
        n_face_refs=len(face_rels),
        with_look_lighting_ref=look_for_light is not None,
    )
    with base_image.open("rb") as f:
        base_bytes = f.read()
    base_mime = "image/png" if base_image.suffix.lower() == ".png" else "image/jpeg"
    contents: list[str | types.Part] = [bytes_to_image_part(base_bytes, base_mime)]
    if look_for_light is not None:
        abs_look = (repo_root / look_for_light).resolve()
        pre = preprocess_for_model(abs_look)
        contents.append("LOOK_HERO_REFERENCE_FOR_LIGHTING_AND_COLOR_MATCH_SAME_SHOOT")
        contents.append(bytes_to_image_part(pre.jpeg_bytes, pre.mime_type))
    n = len(face_rels)
    for i, rel in enumerate(face_rels):
        label = f"FACE_REFERENCE_{i+1}_OF_{n} (identity; not lighting if conflict)"
        abs_path = (repo_root / rel).resolve()
        pre = preprocess_for_model(abs_path)
        contents.append(label)
        contents.append(bytes_to_image_part(pre.jpeg_bytes, pre.mime_type))
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


def run_detail_edit(
    *,
    client: genai.Client,
    repo_root: Path,
    spec: Mapping[str, Any],
    base_image: Path,
    model: str,
    out_image: Path,
    detail_refs: list[Path],
    note: str,
) -> None:
    refs = [p.resolve() for p in detail_refs if p.is_file()]
    if not refs:
        raise ValueError("detail-edit requires at least one valid --ref image")
    brief = compile_brief_detail_edit(spec, note=note, n_refs=len(refs))
    with base_image.open("rb") as f:
        base_bytes = f.read()
    base_mime = "image/png" if base_image.suffix.lower() == ".png" else "image/jpeg"
    contents: list[str | types.Part] = [bytes_to_image_part(base_bytes, base_mime)]
    n = len(refs)
    for i, p in enumerate(refs):
        pre = preprocess_for_model(p)
        contents.append(f"DETAIL_REFERENCE_{i+1}_OF_{n}")
        contents.append(bytes_to_image_part(pre.jpeg_bytes, pre.mime_type))
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
