from __future__ import annotations

from typing import Any, Mapping

_ALLOWED_KINDS = frozenset({"face", "logo", "detail"})


def validate_regions_payload(obj: Mapping[str, Any]) -> None:
    if int(obj.get("schema_version", -1)) != 1:
        raise ValueError("schema_version must be 1")
    image_ref = obj.get("image_ref")
    if not isinstance(image_ref, str) or not image_ref.strip():
        raise ValueError("image_ref must be a non-empty string")
    regions = obj.get("regions")
    if not isinstance(regions, list) or not regions:
        raise ValueError("regions must be a non-empty list")
    for i, r in enumerate(regions):
        if not isinstance(r, dict):
            raise ValueError(f"regions[{i}] must be an object")
        kind = r.get("kind")
        if kind not in _ALLOWED_KINDS:
            raise ValueError(f"regions[{i}].kind invalid: {kind!r}")
        rect = r.get("rect_norm")
        if not isinstance(rect, dict):
            raise ValueError(f"regions[{i}].rect_norm missing")
        for k in ("x", "y", "w", "h"):
            v = rect.get(k)
            if not isinstance(v, (int, float)):
                raise ValueError(f"regions[{i}].rect_norm.{k} must be number")
            if not (0.0 <= float(v) <= 1.0):
                raise ValueError(f"regions[{i}].rect_norm.{k} must be in [0,1]")
        if "note" in r and r["note"] is not None and not isinstance(r["note"], str):
            raise ValueError(f"regions[{i}].note must be string or absent")
