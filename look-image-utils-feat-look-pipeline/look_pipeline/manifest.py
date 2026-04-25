from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping

from look_pipeline.preprocess import preprocess_for_model

LOGO_ROLE = "logo_detail"
FACE_ROLE = "face"
# 仅给 understand 看，用于写 spec 里 pose 文案；2A/修图不喂此图
POSE_REF_ROLE = "pose_ref"

# Optional extra garment views (fixture may omit); same preprocessing as required roles.
LOOK_ANGLE_OPTIONAL_ROLES: tuple[str, ...] = ("look_ref_side", "look_ref_back")

ROLE_KEYS_REQUIRED = (
    "look_ref",
    "sku_flat",
    "fabric_detail",
)

# Understand / labeling order: required, optional face, extra views, logo, then pose_ref (understand-only).
ROLE_KEYS: tuple[str, ...] = (
    "look_ref",
    "sku_flat",
    "fabric_detail",
    FACE_ROLE,
) + LOOK_ANGLE_OPTIONAL_ROLES + (LOGO_ROLE, POSE_REF_ROLE)

# In fixture JSON these may be a single path (str) or a list of paths (multiple views).
_MULTI_IMAGE_ROLES: frozenset[str] = frozenset({"sku_flat", FACE_ROLE})


def _face_fixture_has_paths(fixture: Mapping[str, Any]) -> bool:
    """True when fixture provides at least one non-empty face path (str or list)."""
    raw = fixture.get(FACE_ROLE)
    if raw is None:
        return False
    if isinstance(raw, str):
        return bool(raw.strip())
    if isinstance(raw, list):
        return any(isinstance(x, str) and x.strip() for x in raw)
    return False


def _path_list_for_fixture_value(key: str, raw: Any) -> list[str]:
    if isinstance(raw, str):
        s = raw.strip()
        if not s:
            raise ValueError(f"{key} must be a non-empty path string or a non-empty list of paths")
        return [s.replace("\\", "/")]
    if isinstance(raw, list):
        out: list[str] = []
        for i, item in enumerate(raw):
            if not isinstance(item, str) or not item.strip():
                raise ValueError(f"{key}[{i}] must be a non-empty string path")
            out.append(item.strip().replace("\\", "/"))
        if not out:
            raise ValueError(f"{key} list must contain at least one path")
        return out
    raise TypeError(f"{key} must be a string or a list of string paths")


def _one_preprocessed_file(repo_root: Path, rel: str) -> dict[str, Any]:
    abs_path = (repo_root / rel).resolve()
    if not abs_path.is_file():
        raise FileNotFoundError(rel)
    pre = preprocess_for_model(abs_path)
    return {
        "path": rel,
        "original_size": {"w": pre.original_size_pixels[0], "h": pre.original_size_pixels[1]},
        "preprocessed_size": {"w": pre.size_pixels[0], "h": pre.size_pixels[1]},
        "sha256": pre.sha256_hex,
        "mime": pre.mime_type,
    }


def normalize_fixture_for_manifest(fixture: Mapping[str, Any]) -> dict[str, Any]:
    """Fill defaults and aliases so JSON fixtures stay short.

    - ``logo_ref``: alias for ``logo_detail`` when ``logo_detail`` is absent/empty.
    """
    f: dict[str, Any] = dict(fixture)
    if "look_ref" not in f:
        raise KeyError("look_ref")
    look = f["look_ref"]
    if not (isinstance(look, str) and look.strip()):
        raise ValueError("look_ref must be a non-empty string path")

    def _nonempty_str(k: str) -> str:
        v = f.get(k)
        return v.strip() if isinstance(v, str) else ""

    lr = f.get("logo_ref")
    if not _nonempty_str("logo_detail") and isinstance(lr, str) and lr.strip():
        f["logo_detail"] = lr.strip()
    return f


def _optional_rel_path(fixture: Mapping[str, Any], key: str) -> str | None:
    raw = fixture.get(key)
    if raw is None:
        return None
    if isinstance(raw, str):
        s = raw.strip()
        return s or None
    return None


def rel_paths_for_role(roles: Mapping[str, Any], role: str) -> list[str]:
    """Ordered relative paths for a role; supports legacy single ``path`` or new ``paths`` list."""
    info = roles.get(role)
    if not isinstance(info, dict) or info.get("skipped"):
        return []
    pl = info.get("paths")
    if isinstance(pl, list) and pl:
        return [str(p).replace("\\", "/") for p in pl if isinstance(p, str) and str(p).strip()]
    p = info.get("path")
    if isinstance(p, str) and p.strip():
        return [p.replace("\\", "/")]
    return []


def role_has_reference_image(manifest: Mapping[str, Any], role: str) -> bool:
    roles = manifest.get("roles") or {}
    info = roles.get(role)
    if not isinstance(info, dict):
        return False
    if info.get("skipped"):
        return False
    pl = info.get("paths")
    if isinstance(pl, list) and pl:
        return all(isinstance(p, str) and p.strip() for p in pl)
    path = info.get("path")
    return isinstance(path, str) and bool(path.strip())


def prompt_extra_from_fixture(fixture: Mapping[str, Any]) -> str | None:
    """Optional user text: string, or list of strings (joined with newlines)."""
    raw = fixture.get("prompt_extra")
    if raw is None:
        return None
    if isinstance(raw, str):
        s = raw.strip()
        return s or None
    if isinstance(raw, list):
        lines = [str(x).strip() for x in raw if str(x).strip()]
        if not lines:
            return None
        return "\n".join(lines)
    return None


def build_input_manifest(repo_root: Path, fixture: Mapping[str, Any]) -> dict[str, Any]:
    fixture = normalize_fixture_for_manifest(fixture)
    run_id = str(fixture["run_id"])
    roles_out: dict[str, Any] = {}
    for key in ROLE_KEYS_REQUIRED:
        if key in _MULTI_IMAGE_ROLES:
            rels = _path_list_for_fixture_value(key, fixture[key])
            items = [_one_preprocessed_file(repo_root, r) for r in rels]
            first = rels[0]
            roles_out[key] = {
                "path": first,
                "paths": rels,
                "items": items,
            }
        else:
            rel = str(fixture[key])
            abs_path = (repo_root / rel).resolve()
            if not abs_path.is_file():
                raise FileNotFoundError(rel)
            pre = preprocess_for_model(abs_path)
            roles_out[key] = {
                "path": rel.replace("\\", "/"),
                "original_size": {"w": pre.original_size_pixels[0], "h": pre.original_size_pixels[1]},
                "preprocessed_size": {"w": pre.size_pixels[0], "h": pre.size_pixels[1]},
                "sha256": pre.sha256_hex,
                "mime": pre.mime_type,
            }

    if _face_fixture_has_paths(fixture):
        key = FACE_ROLE
        rels = _path_list_for_fixture_value(key, fixture[key])
        items = [_one_preprocessed_file(repo_root, r) for r in rels]
        first = rels[0]
        roles_out[key] = {
            "path": first,
            "paths": rels,
            "items": items,
        }
    else:
        roles_out[FACE_ROLE] = {
            "path": None,
            "skipped": True,
        }

    logo_rel = _optional_rel_path(fixture, LOGO_ROLE)
    if logo_rel:
        abs_logo = (repo_root / logo_rel).resolve()
        if not abs_logo.is_file():
            raise FileNotFoundError(logo_rel)
        pre = preprocess_for_model(abs_logo)
        roles_out[LOGO_ROLE] = {
            "path": logo_rel.replace("\\", "/"),
            "original_size": {"w": pre.original_size_pixels[0], "h": pre.original_size_pixels[1]},
            "preprocessed_size": {"w": pre.size_pixels[0], "h": pre.size_pixels[1]},
            "sha256": pre.sha256_hex,
            "mime": pre.mime_type,
            "skipped": False,
        }
    else:
        roles_out[LOGO_ROLE] = {
            "path": None,
            "skipped": True,
        }

    for angle_key in LOOK_ANGLE_OPTIONAL_ROLES:
        rel = _optional_rel_path(fixture, angle_key)
        if rel:
            abs_path = (repo_root / rel).resolve()
            if not abs_path.is_file():
                raise FileNotFoundError(rel)
            pre = preprocess_for_model(abs_path)
            roles_out[angle_key] = {
                "path": rel.replace("\\", "/"),
                "original_size": {"w": pre.original_size_pixels[0], "h": pre.original_size_pixels[1]},
                "preprocessed_size": {"w": pre.size_pixels[0], "h": pre.size_pixels[1]},
                "sha256": pre.sha256_hex,
                "mime": pre.mime_type,
                "skipped": False,
            }
        else:
            roles_out[angle_key] = {"path": None, "skipped": True}

    pr = _optional_rel_path(fixture, POSE_REF_ROLE)
    if pr:
        abs_pr = (repo_root / pr).resolve()
        if not abs_pr.is_file():
            raise FileNotFoundError(pr)
        pre = preprocess_for_model(abs_pr)
        roles_out[POSE_REF_ROLE] = {
            "path": pr.replace("\\", "/"),
            "original_size": {"w": pre.original_size_pixels[0], "h": pre.original_size_pixels[1]},
            "preprocessed_size": {"w": pre.size_pixels[0], "h": pre.size_pixels[1]},
            "sha256": pre.sha256_hex,
            "mime": pre.mime_type,
            "skipped": False,
            "understand_only": True,
        }
    else:
        roles_out[POSE_REF_ROLE] = {
            "path": None,
            "skipped": True,
            "understand_only": True,
        }

    out: dict[str, Any] = {"run_id": run_id, "schema_version": 1, "roles": roles_out}
    out["pose_ref_in_2a"] = bool(fixture.get("pose_ref_in_2a", False))
    pe = prompt_extra_from_fixture(fixture)
    if pe:
        out["prompt_extra"] = pe
    return out


def write_input_manifest(repo_root: Path, fixture: Mapping[str, Any], dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    manifest = build_input_manifest(repo_root, fixture)
    dest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
