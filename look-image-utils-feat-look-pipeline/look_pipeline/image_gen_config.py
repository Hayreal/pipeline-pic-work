"""Shared ``GenerateContentConfig`` for Nano Banana / image endpoints.

Environment (optional):

- ``GEN_IMAGE_SIZE``: ``1K`` | ``2K`` | ``4K`` (default ``4K``). Case-insensitive.
- ``GEN_IMAGE_ASPECT_RATIO``: one of ``1:1``, ``2:3``, ``3:2``, ``3:4``, ``4:3``,
  ``9:16``, ``16:9``, ``21:9``. If unset or empty, **aspect_ratio is omitted** so
  the model uses its default (do not pass ``""`` — the API rejects invalid values).

``candidate_count=1`` requests a single response candidate; we still save only the
first image part in ``save_first_image_from_response``.

**Loading ``.env``:** Before reading ``GEN_IMAGE_*``, this module loads
``<repo_root>/.env`` (directory above ``look_pipeline/``) and then ``load_dotenv()``
from the current working directory so variables apply even when the process was
started outside the project root (as long as ``.env`` sits next to ``look_pipeline``).
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from google.genai import types

_ALLOWED_ASPECT = frozenset(
    {"1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"}
)
_ALLOWED_SIZE = frozenset({"1K", "2K", "4K"})


def _strip_env_value(raw: str | None) -> str:
    """Trim whitespace and optional matching quotes from ``.env`` lines."""
    if raw is None:
        return ""
    s = raw.strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
        s = s[1:-1].strip()
    return s


def _normalize_aspect_ratio(raw: str) -> str:
    """Normalize user/``.env`` typos (fullwidth colon, spaces)."""
    s = raw.replace("\uff1a", ":").strip()
    if ":" in s:
        left, right = s.split(":", 1)
        s = f"{left.strip()}:{right.strip()}"
    return s


def _ensure_dotenv_loaded() -> None:
    """Load ``.env`` from package repo root, then CWD (later overrides earlier)."""
    try:
        import dotenv
    except ImportError:
        return
    repo_root = Path(__file__).resolve().parent.parent
    dotenv.load_dotenv(repo_root / ".env")
    dotenv.load_dotenv()


def _normalize_size(raw: str | None) -> str:
    if not raw:
        return "4K"
    s = raw.strip().upper()
    return s if s in _ALLOWED_SIZE else "4K"


def build_image_generate_content_config(
    *,
    system_instruction: str | None = None,
) -> types.GenerateContentConfig:
    _ensure_dotenv_loaded()
    size = _normalize_size(_strip_env_value(os.getenv("GEN_IMAGE_SIZE")))
    if size not in _ALLOWED_SIZE:
        size = "4K"

    ar = _normalize_aspect_ratio(_strip_env_value(os.getenv("GEN_IMAGE_ASPECT_RATIO")))
    image_cfg_kwargs: dict[str, Any] = {"image_size": size}
    if ar in _ALLOWED_ASPECT:
        image_cfg_kwargs["aspect_ratio"] = ar

    cfg_kwargs: dict[str, Any] = {
        "image_config": types.ImageConfig(**image_cfg_kwargs),
        "response_modalities": ["IMAGE", "TEXT"],
        "candidate_count": 1,
    }
    if system_instruction:
        cfg_kwargs["system_instruction"] = system_instruction

    return types.GenerateContentConfig(**cfg_kwargs)


def is_retryable_genai_http_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return "429" in str(exc) or "500" in str(exc) or "503" in str(exc) or "timeout" in msg
