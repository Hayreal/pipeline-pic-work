from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from google import genai
from google.genai import types

from look_pipeline.image_parts import bytes_to_image_part
from look_pipeline.manifest import (
    FACE_ROLE,
    LOGO_ROLE,
    POSE_REF_ROLE,
    ROLE_KEYS,
    rel_paths_for_role,
    role_has_reference_image,
)
from look_pipeline.preprocess import preprocess_for_model
from look_pipeline.retry import call_with_retries
from look_pipeline.spec_types import normalize_look_spec


def extract_json_object_from_model_text(text: str) -> dict[str, Any]:
    m = re.search(r"```json\s*([\s\S]*?)\s*```", text, flags=re.IGNORECASE)
    if m:
        return json.loads(m.group(1))
    return json.loads(text.strip())


def _ensure_schema_version_on_parsed_spec(spec: dict[str, Any]) -> None:
    """Models often omit ``schema_version``; downstream requires ``1``."""
    v = spec.get("schema_version")
    if v is None or (isinstance(v, str) and not str(v).strip()):
        spec["schema_version"] = 1
        return
    try:
        if int(v) == 1:
            spec["schema_version"] = 1
    except (TypeError, ValueError):
        spec["schema_version"] = 1


def _understand_system_prompt() -> str:
    return (
        "You are a senior fashion art director assistant. "
        "Given reference images with labeled roles: look_ref_side / look_ref_back are optional **extra garment views** "
        "for context; they may be used to inform the look and are available to later image steps. "
        "If ROLE=pose_ref is present: use it to fill pose.summary and pose.allowed_adjustments. "
        "Whether 2A also receives this same image is controlled by manifest `pose_ref_in_2a` (boolean, default false). "
        "If false, 2A does not use the pose image. If true, 2A also receives it as a reference; still keep pose text "
        "consistent with the image, and do not treat pose_ref as a second `look_ref` to reproduce unrelated lighting. "
        "face and logo_detail may be omitted. "
        "Emit ONE JSON object only, "
        "The root object MUST include the integer field \"schema_version\": 1. "
        "Also matching these fields for downstream brief compiler: "
        "look_style.summary, pose.summary, pose.allowed_adjustments, "
        "garment.structure_from (literal 'sku_flat'), garment.notes, "
        "fabric.notes, logo.placement, logo.notes, face.notes, "
        "consistency_priority as a list including logo, face, garment, look_style, fabric. "
        "For garment.notes: describe the main **product / hero item** to feature (shoes, bag, hat, "
        "accessories, or apparel — not limited to clothing). "
        "CRITICAL: look_style.summary MUST faithfully describe the actual look_ref image — its lighting, "
        "background, color palette, composition, and mood. Do NOT invent a generic style description; "
        "the generated image must recreate the same visual world as the look reference. "
        "POSE: If ROLE=pose_ref is **absent** and the operator supplement does **not** add pose/body/stance/camera "
        "requirements, base pose.summary and pose.allowed_adjustments strictly on what the **look_ref** image already "
        "shows (implied body orientation, crop, and framing) — do not invent a different pose, gesture, or viewpoint. "
        "If ROLE=pose_ref is present, use it per the role instructions above. "
        "If ROLE=face has no image, set face.notes to state that no separate face/identity close-up was provided "
        "(e.g. socks-only, accessories, or face only in the hero if visible). "
        "If ROLE=logo_detail has no image, set logo.notes to describe the intended mark from the product/SKU only "
        "and do not claim a separate logo reference exists. "
        "When CUSTOMER / OPERATOR SUPPLEMENT contains pose-related requirements, incorporate them into pose.summary. "
        "Return JSON inside a ```json fenced block."
    )


def _text_from_generate_content_response(response: Any) -> str:
    """Prefer SDK ``response.text``; if empty/None, concatenate text from candidates/parts."""
    text_prop = getattr(response, "text", None)
    if isinstance(text_prop, str) and text_prop.strip():
        return text_prop

    candidates = getattr(response, "candidates", None) or []
    chunks: list[str] = []
    for cand in candidates:
        content = getattr(cand, "content", None)
        if content is None:
            continue
        for part in getattr(content, "parts", None) or []:
            pt = getattr(part, "text", None)
            if isinstance(pt, str) and pt:
                chunks.append(pt)
    if chunks:
        return "".join(chunks)

    if isinstance(text_prop, str):
        return text_prop
    return ""


def run_understand_step(
    *,
    client: genai.Client,
    repo_root: Path,
    manifest: dict[str, Any],
    model: str,
    dest_spec_path: Path,
    dest_raw_path: Path,
) -> dict[str, Any]:
    parts: list[str | types.Part] = []
    parts.append(_understand_system_prompt())
    p2a = bool(manifest.get("pose_ref_in_2a", False))
    parts.append(
        f"Run manifest: pose_ref_in_2a=={p2a}. (If true, the same pose image is later passed to 2A; if false, only this "
        "understand pass uses the pose image for JSON wording.)"
    )
    pe = manifest.get("prompt_extra")
    if isinstance(pe, str) and pe.strip():
        parts.append(
            "CUSTOMER / OPERATOR SUPPLEMENT (hard requirements for this job — you MUST reflect these in the "
            "emitted JSON, especially garment.notes, fabric.notes, and any role-specific text; they override "
            "generic catalog assumptions when in conflict):\n\n"
            + pe.strip()
        )
    for role in ROLE_KEYS:
        if not role_has_reference_image(manifest, role):
            if role == FACE_ROLE:
                parts.append(
                    f"ROLE={role}: No face or identity close-up was supplied. "
                    "The job may be product-only (e.g. socks) with no model face, or identity is only in the hero image. "
                    "In the JSON, set face.notes to state that no separate face reference was provided."
                )
            elif role == LOGO_ROLE:
                parts.append(
                    f"ROLE={role}: No reference image was supplied for this role. "
                    "Infer only from other images and the garment; do not invent a logo bitmap from fabric texture alone."
                )
            elif role == POSE_REF_ROLE:
                parts.append(
                    "ROLE=pose_ref: No separate pose reference was supplied. "
                    "Set pose.summary and pose.allowed_adjustments from look_ref, sku_flat, and CUSTOMER / OPERATOR "
                    "SUPPLEMENT; ground pose text in the hero look, not a separate view."
                )
            else:
                parts.append(
                    f"ROLE={role}: No reference image was supplied for this role. "
                    "Infer only from other images when appropriate; do not invent unsupported details."
                )
            continue
        rels = rel_paths_for_role(manifest["roles"], role)
        n = len(rels)
        for i, rel in enumerate(rels):
            abs_path = (repo_root / rel).resolve()
            pre = preprocess_for_model(abs_path)
            if role == POSE_REF_ROLE:
                if p2a:
                    label = (
                        "ROLE=pose_ref: read for pose.summary / pose.allowed_adjustments. "
                        "This job also passes this image to 2A (pose_ref_in_2a): align pose text with a pose 2A may echo. "
                        "It is not a second hero look — look_style still comes from look_ref."
                    )
                else:
                    label = (
                        "ROLE=pose_ref (2A will NOT get this image — for pose text only): "
                        "read pose/body angle for pose.summary and pose.allowed_adjustments; hero defined by look_ref + JSON."
                    )
            elif n == 1:
                label = f"ROLE={role}"
            else:
                label = f"ROLE={role} view {i + 1}/{n} (multi-angle / multi-view)"
            parts.append(label)
            parts.append(bytes_to_image_part(pre.jpeg_bytes, pre.mime_type))
    dest_raw_path.parent.mkdir(parents=True, exist_ok=True)

    def call() -> str:
        response = client.models.generate_content(model=model, contents=parts)
        return _text_from_generate_content_response(response)

    text = call_with_retries(
        call,
        lambda e: "429" in str(e)
        or "500" in str(e)
        or "503" in str(e)
        or "timeout" in str(e).lower(),
        max_attempts=4,
        base_sleep_seconds=1.0,
    )
    dest_raw_path.write_text(text, encoding="utf-8")
    spec = extract_json_object_from_model_text(text)
    _ensure_schema_version_on_parsed_spec(spec)
    spec = normalize_look_spec(spec)
    dest_spec_path.parent.mkdir(parents=True, exist_ok=True)
    dest_spec_path.write_text(
        json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return spec
