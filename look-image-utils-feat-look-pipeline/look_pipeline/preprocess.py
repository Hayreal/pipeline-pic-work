from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps


@dataclass(frozen=True)
class PreprocessedImage:
    jpeg_bytes: bytes
    mime_type: str
    original_size_pixels: tuple[int, int]
    size_pixels: tuple[int, int]
    sha256_hex: str


def preprocess_for_model(
    image_path: Path, max_long_edge: int = 2048, jpeg_quality: int = 88
) -> PreprocessedImage:
    if not image_path.is_file():
        raise FileNotFoundError(image_path)
    with Image.open(image_path) as im:
        im = ImageOps.exif_transpose(im)
        if im.mode != "RGB":
            im = im.convert("RGB")
        orig_w, orig_h = im.size
        w, h = orig_w, orig_h
        long_edge = max(w, h)
        if long_edge > max_long_edge:
            scale = max_long_edge / float(long_edge)
            new_w = max(1, int(round(w * scale)))
            new_h = max(1, int(round(h * scale)))
            im = im.resize((new_w, new_h), Image.Resampling.LANCZOS)
        else:
            new_w, new_h = w, h
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=jpeg_quality, optimize=True)
        jpeg_bytes = buf.getvalue()
    digest = hashlib.sha256(jpeg_bytes).hexdigest()
    return PreprocessedImage(
        jpeg_bytes=jpeg_bytes,
        mime_type="image/jpeg",
        original_size_pixels=(orig_w, orig_h),
        size_pixels=(new_w, new_h),
        sha256_hex=digest,
    )
