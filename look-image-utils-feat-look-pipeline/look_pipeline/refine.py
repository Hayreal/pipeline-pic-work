from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping

from google import genai
from PIL import Image

from look_pipeline.image_gen_config import (
    build_image_generate_content_config,
    is_retryable_genai_http_error,
)
from look_pipeline.image_parts import bytes_to_image_part, save_first_image_from_response
from look_pipeline.regions_validate import validate_regions_payload
from look_pipeline.retry import call_with_retries
from look_pipeline.run_layout import RunLayout


def build_refine_edit_prompt(
    *,
    spec: Mapping[str, Any],
    regions_doc: Mapping[str, Any],
    pixel_boxes: list[tuple[str, tuple[int, int, int, int]]],
) -> str:
    """English instruction for a localized image edit inside listed pixel rectangles."""
    lines: list[str] = [
        "You are editing a single fashion LOOK photograph.",
        "",
        "Approved look specification (JSON, for context only — do not invent new garments):",
        json.dumps(spec, ensure_ascii=False, indent=2),
        "",
        "Apply localized improvements ONLY inside the following axis-aligned rectangles, "
        "given in pixel coordinates (x0, y0, x1, y1) relative to the full image:",
        "",
    ]
    regions_list = regions_doc.get("regions")
    if not isinstance(regions_list, list):
        regions_list = []
    for i, (kind, box) in enumerate(pixel_boxes):
        x0, y0, x1, y1 = box
        block = f"- Region {i + 1}: kind={kind!r}, pixels=({x0}, {y0}, {x1}, {y1})"
        if i < len(regions_list) and isinstance(regions_list[i], Mapping):
            note = regions_list[i].get("note")
            if isinstance(note, str) and note.strip():
                block += f"\n  Optional notes for this region: {note.strip()}"
        lines.append(block)
    lines.extend(
        [
            "",
            "Preserve the rest of the composition, pose, framing, lighting, palette, and "
            "global styling outside these rectangles. Do not change canvas size or aspect ratio.",
            "Return exactly ONE output image.",
        ]
    )
    return "\n".join(lines)


def _resolve_base_image_under_run(run_dir: Path, image_ref: str) -> Path:
    ref = image_ref.strip()
    if not ref:
        raise ValueError("image_ref is empty")
    p = Path(ref)
    if p.is_absolute():
        raise ValueError("image_ref must be a relative path under the run directory")
    if ".." in p.parts:
        raise ValueError("image_ref must not contain parent path segments")
    run_resolved = run_dir.resolve()
    candidate = (run_resolved / p).resolve()
    try:
        candidate.relative_to(run_resolved)
    except ValueError as exc:
        raise ValueError("image_ref resolves outside the run directory") from exc
    if not candidate.is_file():
        raise FileNotFoundError(f"Base image not found: {candidate}")
    return candidate


def _rect_norm_to_pixel_box(
    rect: Mapping[str, Any], width: int, height: int
) -> tuple[int, int, int, int]:
    x = float(rect["x"])
    y = float(rect["y"])
    w = float(rect["w"])
    h = float(rect["h"])
    x0 = int(round(x * width))
    y0 = int(round(y * height))
    x1 = int(round((x + w) * width))
    y1 = int(round((y + h) * height))
    x0 = max(0, min(width, x0))
    x1 = max(0, min(width, x1))
    y0 = max(0, min(height, y0))
    y1 = max(0, min(height, y1))
    if x0 > x1:
        x0, x1 = x1, x0
    if y0 > y1:
        y0, y1 = y1, y0
    return (x0, y0, x1, y1)


def run_refine_pass(
    *,
    client: genai.Client,
    repo_root: Path,
    layout: RunLayout,
    k: int,
    manifest: Mapping[str, Any],
    spec: Mapping[str, Any],
    model: str,
) -> Path:
    regions_path = layout.regions_path(k)
    regions_doc = json.loads(regions_path.read_text(encoding="utf-8"))
    validate_regions_payload(regions_doc)
    image_ref = str(regions_doc["image_ref"])
    base_path = _resolve_base_image_under_run(layout.run_dir, image_ref)

    with Image.open(base_path) as im:
        w, h = im.size

    pixel_boxes: list[tuple[str, tuple[int, int, int, int]]] = []
    for r in regions_doc["regions"]:
        kind = str(r["kind"])
        box = _rect_norm_to_pixel_box(r["rect_norm"], w, h)
        pixel_boxes.append((kind, box))

    prompt = build_refine_edit_prompt(spec=spec, regions_doc=regions_doc, pixel_boxes=pixel_boxes)
    base_bytes = base_path.read_bytes()
    mime = "image/png" if base_path.suffix.lower() == ".png" else "image/jpeg"
    contents = [bytes_to_image_part(base_bytes, mime)]
    cfg = build_image_generate_content_config(system_instruction=prompt)
    out_path = layout.refined_draft_path(k)

    def call() -> Any:
        return client.models.generate_content(model=model, contents=contents, config=cfg)

    resp = call_with_retries(
        call,
        is_retryable_genai_http_error,
        max_attempts=4,
        base_sleep_seconds=1.0,
    )
    save_first_image_from_response(resp, out_path)
    return out_path.resolve()
