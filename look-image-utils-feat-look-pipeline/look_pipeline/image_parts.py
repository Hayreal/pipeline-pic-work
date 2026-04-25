from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Any

from google.genai import types
from PIL import Image


def bytes_to_image_part(data: bytes, mime_type: str = "image/jpeg") -> types.Part:
    return types.Part.from_bytes(data=data, mime_type=mime_type)


def save_first_image_from_response(response: Any, dest: Path) -> Path:
    """Save the first response part that carries inline image bytes.

    Tries ``part.as_image().save()`` first; on failure writes raw bytes and picks
    a file suffix from ``inline_data.mime_type``.
    """
    parts = getattr(response, "parts", None) or []
    dest = Path(dest)

    for part in parts:
        inline = getattr(part, "inline_data", None)
        if inline is None:
            continue
        data = getattr(inline, "data", None)
        if not data:
            continue
        try:
            part.as_image().save(str(dest))
        except Exception:
            # Always write to the path the pipeline expects (e.g. draft_2a.png).
            im = Image.open(BytesIO(data))
            im.load()
            if im.mode not in ("RGB", "RGBA"):
                im = im.convert("RGB")
            elif im.mode == "RGBA" and dest.suffix.lower() in (".jpg", ".jpeg"):
                im = im.convert("RGB")
            dest.parent.mkdir(parents=True, exist_ok=True)
            fmt = "PNG" if dest.suffix.lower() == ".png" else "JPEG"
            im.save(dest, format=fmt)
            return dest.resolve()
        else:
            return dest.resolve()

    raise ValueError("No inline image part found in response")
