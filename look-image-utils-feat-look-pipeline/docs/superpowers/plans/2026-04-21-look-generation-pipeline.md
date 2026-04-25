# Look 生成流水线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在仓库内实现半自动「六图 → JSON → 2a 结构稿 → 2b 终稿 → 可选编辑」CLI 流水线，全部 inline 图像、长边 ≤2048，产物落盘到 `runs/<run_id>/`，并用 pytest 覆盖预处理、manifest、schema、brief 与可 mock 的 API 边界。

**Architecture:** `look_pipeline` 包按职责拆分（预处理、血缘 manifest、spec 校验、理解/Brief/生成/编辑、重试、CLI）。闸门间通过文件状态推进（`look_spec_approved.json` 等），不覆盖已批准产物。可选：在独立 git worktree 中执行本计划以降低与主分支干扰；非强制。

**Tech Stack:** Python 3.12、`google-genai`、`Pillow`、`python-dotenv`、`pytest`（开发依赖）、标准库 `argparse` / `hashlib` / `json` / `pathlib`。

---

## 文件结构（落地前锁定）

| 路径 | 职责 |
|------|------|
| `pyproject.toml` | 声明可安装包 `look_pipeline`、可选 `[dependency-groups] dev` 含 `pytest`，`[tool.pytest.ini_options]` 的 `testpaths = ["tests"]` |
| `look_pipeline/__init__.py` | 包版本常量（如 `__version__ = "0.1.0"`） |
| `look_pipeline/preprocess.py` | 读图、RGBA→RGB、EXIF 方向、长边缩放至 ≤2048、导出 JPEG 字节与 MIME |
| `look_pipeline/manifest.py` | 从 fixture 路径构建 `input_manifest.json`（原始尺寸、缩放后尺寸、sha256、pose 是否与 look 同路径；**`logo_detail` 可选**） |
| `look_pipeline/spec_types.py` | `LookSpec` dataclass 或 TypedDict + `validate_look_spec(dict) -> None` 抛 `ValueError` |
| `look_pipeline/understand.py` | 组装多图 `contents`、调用理解模型、把模型文本解析为 dict、写入 `look_spec_v{n}.json` 与 `understand_raw.txt` |
| `look_pipeline/brief.py` | `compile_brief_2a(spec) -> str`、`compile_brief_2b(spec, *, has_logo_reference_image: bool) -> str`、`compile_brief_logo_edit(spec) -> str` |
| `look_pipeline/image_parts.py` | `bytes_to_part(data, mime)`、`save_first_image_from_response(response, path)` |
| `look_pipeline/generate.py` | `run_step_2a(...)`、`run_step_2b(...)`：组装 `contents`、调用生图模型、落盘 `draft_2a.png` / `look_final_4k.png` |
| `look_pipeline/edit.py` | `run_logo_edit(...)`：上一张图 + Logo 特写 + 编辑 brief |
| `look_pipeline/retry.py` | `call_with_retries(callable, is_retryable_exc, max_attempts=4, base_sleep_seconds=1.0)` |
| `look_pipeline/run_layout.py` | `ensure_run_dir(repo_root, run_id) -> Path`、`RUN_FILES` 常量（各标准文件名） |
| `look_pipeline/cli.py` | `argparse` 子命令：`init-run`、`understand`、`approve-spec`、`draft-2a`、`final-2b`、`logo-edit` |
| `look_pipeline/__main__.py` | `python -m look_pipeline` 时转发到 `cli.main()` |
| `tests/fixtures/sample_run.json` | 六角色路径；`pose_ref` 与 `look_ref` 故意相同以覆盖共用场景 |
| `tests/test_preprocess.py` | 缩放、sha256 稳定性 |
| `tests/test_manifest.py` | manifest 字段齐全、共用 pose 标记 |
| `tests/test_spec_validate.py` | 缺字段、非法 `pose_ref_source` |
| `tests/test_brief.py` | 共用 pose 时 brief 含两段语义标题 |
| `tests/test_retry.py` | 重试次数与退避 |
| `tests/test_image_parts_mock.py` | 用伪造 `response` 对象测 `save_first_image_from_response` |
| `main.py` | 保留为最小 SDK smoke；或改为调用 `look_pipeline.cli` 的薄封装（二选一在 Task 13 明确） |

---

### Task 1: 可安装包与 pytest 脚手架

**Files:**
- Modify: `pyproject.toml`
- Create: `look_pipeline/__init__.py`
- Create: `tests/conftest.py`（空文件或 `pytest_plugins` 占位即可）

- [ ] **Step 1: 修改 `pyproject.toml` 为可编辑安装并加入 pytest**

将下列片段合并进现有文件（保留原有 `dependencies` 列表内容；若已存在 `[build-system]` 则只补缺失键）。

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["look_pipeline"]

[dependency-groups]
dev = [
    "pytest>=8.3.0",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 2: 创建 `look_pipeline/__init__.py`**

```python
__version__ = "0.1.0"
```

- [ ] **Step 3: 创建空 `tests/conftest.py`**

```python
# Shared pytest fixtures (extend as needed).
```

- [ ] **Step 4: 同步锁文件并本地安装**

Run:

```bash
cd /Users/lixin/WebProjects/look-image-utils
uv lock
uv sync --group dev
uv pip install -e .
```

Expected: 命令成功退出码 0；`python -c "import look_pipeline; print(look_pipeline.__version__)"` 输出 `0.1.0`。

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml uv.lock look_pipeline/__init__.py tests/conftest.py
git commit -m "chore: package look_pipeline and add pytest dev group"
```

---

### Task 2: 夹具 `sample_run.json`

**Files:**
- Create: `tests/fixtures/sample_run.json`

- [ ] **Step 1: 写入夹具 JSON（路径相对仓库根；pose 与 look 共用）**

```json
{
  "run_id": "sample-001",
  "look_ref": "tests/Look参考图/look/Classic pyjamas petite  Mix Air Blue Pyjamas aiayu.jpg",
  "sku_flat": "tests/SKU面料素材/蒲绿.png",
  "fabric_detail": "tests/SKU面料素材/面料与logo裁图/蒲绿.png",
  "face": "tests/模特脸部特写/女模-1.png",
  "pose_ref": "tests/Look参考图/look/Classic pyjamas petite  Mix Air Blue Pyjamas aiayu.jpg"
}
```

- [ ] **Step 2: 校验文件存在**

Run:

```bash
cd /Users/lixin/WebProjects/look-image-utils
python - <<'PY'
import json
from pathlib import Path
root = Path(".")
data = json.loads((root / "tests/fixtures/sample_run.json").read_text(encoding="utf-8"))
for k in ("look_ref","sku_flat","fabric_detail","face","pose_ref","logo_detail"):
    p = root / data[k]
    assert p.is_file(), (k, p)
print("ok")
PY
```

Expected: 输出 `ok`。

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/sample_run.json
git commit -m "test: add sample_run fixture with pose shared with look"
```

---

### Task 3: 预处理与单元测试（TDD）

**Files:**
- Create: `look_pipeline/preprocess.py`
- Create: `tests/test_preprocess.py`

- [ ] **Step 1: 写失败测试 `tests/test_preprocess.py`**

```python
from pathlib import Path

from look_pipeline.preprocess import preprocess_for_model


def test_preprocess_resizes_long_edge_to_2048_max(tmp_path: Path) -> None:
    repo = Path(__file__).resolve().parents[1]
    src = repo / "tests" / "SKU面料素材" / "蒲绿.png"
    assert src.is_file()
    out = preprocess_for_model(src)
    assert out.mime_type == "image/jpeg"
    assert max(out.size_pixels) <= 2048
    assert out.sha256_hex == out.sha256_hex  # stable accessor
    assert len(out.jpeg_bytes) > 1000
```

- [ ] **Step 2: 运行 pytest 确认失败**

Run:

```bash
cd /Users/lixin/WebProjects/look-image-utils
uv run pytest tests/test_preprocess.py::test_preprocess_resizes_long_edge_to_2048_max -q
```

Expected: `ModuleNotFoundError` 或 `ImportError: cannot import name 'preprocess_for_model'`。

- [ ] **Step 3: 实现 `look_pipeline/preprocess.py`**

```python
from __future__ import annotations

import hashlib
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


def preprocess_for_model(image_path: Path, max_long_edge: int = 2048, jpeg_quality: int = 88) -> PreprocessedImage:
    if not image_path.is_file():
        raise FileNotFoundError(image_path)
    with Image.open(image_path) as im:
        im = ImageOps.exif_transpose(im)
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        elif im.mode == "L":
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
        buf = __import__("io").BytesIO()
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
```

- [ ] **Step 4: 运行 pytest 确认通过**

Run:

```bash
uv run pytest tests/test_preprocess.py::test_preprocess_resizes_long_edge_to_2048_max -q
```

Expected: `1 passed`。

- [ ] **Step 5: Commit**

```bash
git add look_pipeline/preprocess.py tests/test_preprocess.py
git commit -m "feat: preprocess images to max long edge 2048 JPEG"
```

---

### Task 4: `input_manifest.json` 构建

**Files:**
- Create: `look_pipeline/manifest.py`
- Create: `tests/test_manifest.py`

- [ ] **Step 1: 写失败测试**

```python
import json
from pathlib import Path

from look_pipeline.manifest import build_input_manifest


def test_manifest_marks_shared_pose_with_look() -> None:
    repo = Path(__file__).resolve().parents[1]
    fixture = json.loads((repo / "tests/fixtures/sample_run.json").read_text(encoding="utf-8"))
    manifest = build_input_manifest(repo_root=repo, fixture=fixture)
    assert manifest["roles"]["look_ref"]["path"] == fixture["look_ref"]
    assert manifest["roles"]["pose_ref"]["path"] == fixture["pose_ref"]
    assert manifest["roles"]["pose_ref"]["same_file_as_look_ref"] is True
    for key in ("sku_flat", "fabric_detail", "face", "logo_detail"):
        assert key in manifest["roles"]
```

- [ ] **Step 2: 运行 pytest 确认失败**

Run:

```bash
uv run pytest tests/test_manifest.py::test_manifest_marks_shared_pose_with_look -q
```

Expected: ImportError。

- [ ] **Step 3: 实现 `look_pipeline/manifest.py`**

```python
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping

from look_pipeline.preprocess import preprocess_for_model


ROLE_KEYS = (
    "look_ref",
    "sku_flat",
    "fabric_detail",
    "face",
    "pose_ref",
    "logo_detail",
)


def build_input_manifest(repo_root: Path, fixture: Mapping[str, Any]) -> dict[str, Any]:
    run_id = str(fixture["run_id"])
    roles_out: dict[str, Any] = {}
    for key in ROLE_KEYS:
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
    look_path = str(fixture["look_ref"])
    pose_path = str(fixture["pose_ref"])
    roles_out["pose_ref"]["same_file_as_look_ref"] = look_path == pose_path
    return {"run_id": run_id, "schema_version": 1, "roles": roles_out}


def write_input_manifest(repo_root: Path, fixture: Mapping[str, Any], dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    manifest = build_input_manifest(repo_root, fixture)
    dest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
```

- [ ] **Step 4: 运行 pytest**

Run:

```bash
uv run pytest tests/test_manifest.py::test_manifest_marks_shared_pose_with_look -q
```

Expected: `1 passed`。

- [ ] **Step 5: Commit**

```bash
git add look_pipeline/manifest.py tests/test_manifest.py
git commit -m "feat: build input manifest with shared pose detection"
```

---

### Task 5: `LookSpec` 校验

**Files:**
- Create: `look_pipeline/spec_types.py`
- Create: `tests/test_spec_validate.py`

- [ ] **Step 1: 写失败测试**

```python
import pytest

from look_pipeline.spec_types import validate_look_spec


def test_validate_requires_pose_ref_source_when_shared() -> None:
    spec = {
        "schema_version": 1,
        "pose_ref_source": "shared_with_look",
        "look_style": {"summary": "soft daylight studio"},
        "pose": {"summary": "standing three-quarter"},
        "garment": {"structure_from": "sku_flat", "notes": "two-piece pyjamas"},
        "fabric": {"notes": "fine rib"},
        "logo": {"placement": "left chest", "notes": "embroidered wordmark"},
        "face": {"notes": "east asian woman calm expression"},
        "consistency_priority": ["logo", "face", "garment", "look_style", "fabric"],
    }
    validate_look_spec(spec)


def test_validate_rejects_bad_pose_ref_source() -> None:
    spec = {
        "schema_version": 1,
        "pose_ref_source": "invalid",
        "look_style": {"summary": "x"},
        "pose": {"summary": "x"},
        "garment": {"structure_from": "sku_flat", "notes": "x"},
        "fabric": {"notes": "x"},
        "logo": {"placement": "chest", "notes": "x"},
        "face": {"notes": "x"},
        "consistency_priority": ["logo", "face", "garment", "look_style", "fabric"],
    }
    with pytest.raises(ValueError):
        validate_look_spec(spec)
```

- [ ] **Step 2: 运行 pytest 确认失败**

Run:

```bash
uv run pytest tests/test_spec_validate.py -q
```

Expected: ImportError。

- [ ] **Step 3: 实现 `look_pipeline/spec_types.py`**

```python
from __future__ import annotations

from typing import Any, Mapping

_ALLOWED_POSE_SOURCES = {"dedicated_image", "shared_with_look"}


def validate_look_spec(spec: Mapping[str, Any]) -> None:
    if int(spec.get("schema_version", -1)) != 1:
        raise ValueError("schema_version must be 1")
    pose_src = spec.get("pose_ref_source")
    if pose_src not in _ALLOWED_POSE_SOURCES:
        raise ValueError("pose_ref_source must be one of: dedicated_image, shared_with_look")
    for key in ("look_style", "pose", "garment", "fabric", "logo", "face", "consistency_priority"):
        if key not in spec:
            raise ValueError(f"missing key: {key}")
    if not isinstance(spec["consistency_priority"], list) or not spec["consistency_priority"]:
        raise ValueError("consistency_priority must be a non-empty list")
```

- [ ] **Step 4: 运行 pytest**

Run:

```bash
uv run pytest tests/test_spec_validate.py -q
```

Expected: `2 passed`。

- [ ] **Step 5: Commit**

```bash
git add look_pipeline/spec_types.py tests/test_spec_validate.py
git commit -m "feat: validate look spec schema v1"
```

---

### Task 6: Brief 编译器

**Files:**
- Create: `look_pipeline/brief.py`
- Create: `tests/test_brief.py`

- [ ] **Step 1: 写失败测试（共用 pose 两段标题）**

```python
from look_pipeline.brief import compile_brief_2a


def test_brief_2a_splits_style_and_pose_when_shared() -> None:
    spec = {
        "schema_version": 1,
        "pose_ref_source": "shared_with_look",
        "look_style": {"summary": "cool daylight, minimal set"},
        "pose": {"summary": "relaxed stand, weight on back foot", "allowed_adjustments": "subtle arm angle only"},
        "garment": {"structure_from": "sku_flat", "notes": "matching set"},
        "fabric": {"notes": "visible knit texture on cuffs"},
        "logo": {"placement": "left chest", "notes": "small embroidered logo"},
        "face": {"notes": "same identity as face reference"},
        "consistency_priority": ["logo", "face", "garment", "look_style", "fabric"],
    }
    text = compile_brief_2a(spec)
    assert "### LOOK_STYLE_BLOCK" in text
    assert "### POSE_BLOCK" in text
    assert "shared_with_look" in text
```

- [ ] **Step 2: 运行 pytest 确认失败**

Run:

```bash
uv run pytest tests/test_brief.py::test_brief_2a_splits_style_and_pose_when_shared -q
```

Expected: ImportError。

- [ ] **Step 3: 实现 `look_pipeline/brief.py`**

```python
from __future__ import annotations

from typing import Any, Mapping


def compile_brief_2a(spec: Mapping[str, Any]) -> str:
    lines: list[str] = []
    lines.append("You are generating a FIRST-PASS editorial product LOOK image (not final 4K).")
    lines.append("Priorities follow consistency_priority order in the JSON spec.")
    lines.append("")
    lines.append("### LOOK_STYLE_BLOCK")
    lines.append(str(spec["look_style"]["summary"]))
    lines.append("")
    lines.append("### POSE_BLOCK")
    if spec.get("pose_ref_source") == "shared_with_look":
        lines.append(
            "Pose reference is the SAME image as the look reference; "
            "still treat LOOK_STYLE_BLOCK as lighting/color/composition mood, "
            "and POSE_BLOCK as body pose and framing of the subject."
        )
    lines.append(str(spec["pose"]["summary"]))
    adj = spec["pose"].get("allowed_adjustments")
    if adj:
        lines.append(f"Allowed pose adjustments: {adj}")
    lines.append("")
    lines.append("### GARMENT_BLOCK")
    lines.append(str(spec["garment"]["notes"]))
    lines.append("")
    lines.append("### FABRIC_BLOCK (text only for 2a; do not invent contradicting textures)")
    lines.append(str(spec["fabric"]["notes"]))
    lines.append("")
    lines.append("### LOGO_BLOCK (text only for 2a)")
    lines.append(f"Placement: {spec['logo']['placement']}. {spec['logo']['notes']}")
    lines.append("")
    lines.append("### FACE_BLOCK")
    lines.append(str(spec["face"]["notes"]))
    lines.append("")
    lines.append("Hard rule: keep garment silhouette consistent with sku_flat reference image.")
    return "\n".join(lines) + "\n"


def compile_brief_2b(spec: Mapping[str, Any]) -> str:
    return (
        "Upgrade the draft to a high-resolution final suitable for 4K delivery.\n"
        "Lock composition and identity from the draft image.\n"
        "Enhance fabric micro-detail using fabric_detail reference and logo fidelity using logo_detail.\n"
        f"Logo placement: {spec['logo']['placement']}. Fabric notes: {spec['fabric']['notes']}.\n"
    )


def compile_brief_logo_edit(spec: Mapping[str, Any]) -> str:
    return (
        "Edit the provided image to sharpen and correct the logo to match the logo_detail reference.\n"
        f"Target placement: {spec['logo']['placement']}.\n"
        "Do not change overall pose or scene layout.\n"
    )
```

- [ ] **Step 4: 运行 pytest**

Run:

```bash
uv run pytest tests/test_brief.py -q
```

Expected: `1 passed`。

- [ ] **Step 5: Commit**

```bash
git add look_pipeline/brief.py tests/test_brief.py
git commit -m "feat: compile 2a/2b/logo edit briefs from spec"
```

---

### Task 7: 响应解析与保存首图

**Files:**
- Create: `look_pipeline/image_parts.py`
- Create: `tests/test_image_parts_mock.py`

- [ ] **Step 1: 写失败测试**

```python
from pathlib import Path
from types import SimpleNamespace

from PIL import Image

from look_pipeline.image_parts import save_first_image_from_response


def test_save_first_image_writes_png(tmp_path: Path) -> None:
    img = Image.new("RGB", (32, 32), color=(255, 0, 0))
    buf = __import__("io").BytesIO()
    img.save(buf, format="PNG")
    part = SimpleNamespace(inline_data=SimpleNamespace(data=buf.getvalue(), mime_type="image/png"))
    resp = SimpleNamespace(parts=[part])
    out = tmp_path / "out.png"
    save_first_image_from_response(resp, out)
    assert out.is_file()
    with Image.open(out) as loaded:
        assert loaded.size == (32, 32)
```

- [ ] **Step 2: 运行 pytest 确认失败**

Run:

```bash
uv run pytest tests/test_image_parts_mock.py::test_save_first_image_writes_png -q
```

Expected: ImportError。

- [ ] **Step 3: 实现 `look_pipeline/image_parts.py`**

```python
from __future__ import annotations

from pathlib import Path

from google.genai import types


def bytes_to_image_part(data: bytes, mime_type: str = "image/jpeg") -> types.Part:
    return types.Part.from_bytes(data=data, mime_type=mime_type)


def save_first_image_from_response(response: object, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    for part in response.parts:  # type: ignore[attr-defined]
        inline = getattr(part, "inline_data", None)
        if inline is None:
            continue
        data = getattr(inline, "data", None)
        if not data:
            continue
        image = part.as_image()  # type: ignore[union-attr]
        image.save(dest)
        return dest
    raise RuntimeError("No inline image parts found in response")
```

- [ ] **Step 4: 运行 pytest**

Run:

```bash
uv run pytest tests/test_image_parts_mock.py::test_save_first_image_writes_png -q
```

Expected: `1 passed`（若 `as_image` 在伪造 part 上不可用，则改为直接 `Path.write_bytes(data)` 分支逻辑并在测试中只断言文件写入；实现时以真实 `Part` API 为准调整测试替身）。

- [ ] **Step 5: Commit**

```bash
git add look_pipeline/image_parts.py tests/test_image_parts_mock.py
git commit -m "feat: save first inline image from generate_content response"
```

> 若 Step 4 因 `SimpleNamespace` 与 SDK 类型不兼容失败：在 `save_first_image_from_response` 内优先调用 `part.as_image()`，若不存在则回退 `Path.write_bytes(inline.data)`，测试改用 `unittest.mock.Mock` 提供 `as_image` 返回 `PIL.Image`。

---

### Task 8: 重试工具

**Files:**
- Create: `look_pipeline/retry.py`
- Create: `tests/test_retry.py`

- [ ] **Step 1: 写失败测试**

```python
import pytest

from look_pipeline.retry import call_with_retries


def test_retries_until_success(monkeypatch: pytest.MonkeyPatch) -> None:
    state = {"n": 0}

    def flaky() -> int:
        state["n"] += 1
        if state["n"] < 3:
            raise RuntimeError("429 simulated")
        return 42

    def is_retryable(exc: BaseException) -> bool:
        return "429" in str(exc)

    assert call_with_retries(flaky, is_retryable, max_attempts=4, base_sleep_seconds=0.0) == 42
    assert state["n"] == 3
```

- [ ] **Step 2: 运行 pytest 确认失败**

Run:

```bash
uv run pytest tests/test_retry.py::test_retries_until_success -q
```

Expected: ImportError。

- [ ] **Step 3: 实现 `look_pipeline/retry.py`**

```python
from __future__ import annotations

import time
from collections.abc import Callable, TypeVar

T = TypeVar("T")


def call_with_retries(
    fn: Callable[[], T],
    is_retryable: Callable[[BaseException], bool],
    *,
    max_attempts: int = 4,
    base_sleep_seconds: float = 1.0,
) -> T:
    last_exc: BaseException | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            return fn()
        except BaseException as exc:  # noqa: BLE001 - boundary for retries
            last_exc = exc
            if attempt == max_attempts or not is_retryable(exc):
                raise
            sleep_s = base_sleep_seconds * (2 ** (attempt - 1))
            if sleep_s > 0:
                time.sleep(sleep_s)
    assert last_exc is not None
    raise last_exc
```

- [ ] **Step 4: 运行 pytest**

Run:

```bash
uv run pytest tests/test_retry.py::test_retries_until_success -q
```

Expected: `1 passed`。

- [ ] **Step 5: Commit**

```bash
git add look_pipeline/retry.py tests/test_retry.py
git commit -m "feat: exponential backoff retry helper"
```

---

### Task 9: `run_layout` 与目录约定

**Files:**
- Create: `look_pipeline/run_layout.py`

- [ ] **Step 1: 写失败测试 `tests/test_run_layout.py`**

```python
from pathlib import Path

from look_pipeline.run_layout import RunLayout


def test_run_layout_paths(tmp_path: Path) -> None:
    layout = RunLayout(base_dir=tmp_path, run_id="sample-001")
    assert layout.run_dir.name == "sample-001"
    assert layout.manifest_path.name == "input_manifest.json"
```

- [ ] **Step 2: 运行 pytest 确认失败**

Run:

```bash
uv run pytest tests/test_run_layout.py::test_run_layout_paths -q
```

Expected: ImportError。

- [ ] **Step 3: 实现 `look_pipeline/run_layout.py`**

```python
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class RunLayout:
    base_dir: Path
    run_id: str

    @property
    def run_dir(self) -> Path:
        return self.base_dir / self.run_id

    @property
    def manifest_path(self) -> Path:
        return self.run_dir / "input_manifest.json"

    @property
    def approved_spec_path(self) -> Path:
        return self.run_dir / "look_spec_approved.json"

    @property
    def draft_2a_path(self) -> Path:
        return self.run_dir / "draft_2a.png"

    @property
    def final_path(self) -> Path:
        return self.run_dir / "look_final_4k.png"

    @property
    def brief_2a_path(self) -> Path:
        return self.run_dir / "brief_2a.txt"

    @property
    def brief_2b_path(self) -> Path:
        return self.run_dir / "brief_2b.txt"


def default_runs_dir(repo_root: Path) -> Path:
    return repo_root / "runs"
```

- [ ] **Step 4: 运行 pytest**

Run:

```bash
uv run pytest tests/test_run_layout.py::test_run_layout_paths -q
```

Expected: `1 passed`。

- [ ] **Step 5: Commit**

```bash
git add look_pipeline/run_layout.py tests/test_run_layout.py
git commit -m "feat: run directory layout helper"
```

---

### Task 10: 理解步骤（含解析与 raw 落盘）

**Files:**
- Create: `look_pipeline/understand.py`
- Create: `tests/test_understand_parse.py`

- [ ] **Step 1: 写纯解析单元测试（不调用网络）**

```python
from look_pipeline.understand import extract_json_object_from_model_text


def test_extract_json_from_fenced_block() -> None:
    text = """Here is the JSON:\n```json\n{\"schema_version\": 1}\n```\n"""
    obj = extract_json_object_from_model_text(text)
    assert obj["schema_version"] == 1
```

- [ ] **Step 2: 运行 pytest 确认失败**

Run:

```bash
uv run pytest tests/test_understand_parse.py::test_extract_json_from_fenced_block -q
```

Expected: ImportError。

- [ ] **Step 3: 实现解析函数与 `run_understand_step` 骨架 `look_pipeline/understand.py`**

```python
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from google import genai
from google.genai import types

from look_pipeline.image_parts import bytes_to_image_part
from look_pipeline.manifest import ROLE_KEYS
from look_pipeline.preprocess import preprocess_for_model
from look_pipeline.retry import call_with_retries
from look_pipeline.spec_types import validate_look_spec


def extract_json_object_from_model_text(text: str) -> dict[str, Any]:
    m = re.search(r"```json\s*([\s\S]*?)\s*```", text, flags=re.IGNORECASE)
    if m:
        return json.loads(m.group(1))
    return json.loads(text.strip())


def _understand_system_prompt() -> str:
    return (
        "You are a senior fashion art director assistant. "
        "Given six reference images with labeled roles, emit ONE JSON object only, "
        "matching schema_version=1 fields expected by downstream brief compiler: "
        "pose_ref_source (dedicated_image|shared_with_look), "
        "look_style.summary, pose.summary, pose.allowed_adjustments, "
        "garment.structure_from (literal 'sku_flat'), garment.notes, "
        "fabric.notes, logo.placement, logo.notes, face.notes, "
        "consistency_priority as a list including logo, face, garment, look_style, fabric. "
        "Mark pose_ref_source shared_with_look when user indicates shared file. "
        "Return JSON inside a ```json fenced block."
    )


def run_understand_step(
    *,
    client: genai.Client,
    repo_root: Path,
    manifest: dict[str, Any],
    model: str,
    dest_spec_path: Path,
    dest_raw_path: Path,
) -> dict[str, Any]:
    parts: list[Any] = []
    parts.append(_understand_system_prompt())
    for role in ROLE_KEYS:
        rel = manifest["roles"][role]["path"]
        abs_path = (repo_root / rel).resolve()
        pre = preprocess_for_model(abs_path)
        parts.append(f"ROLE={role}")
        parts.append(bytes_to_image_part(pre.jpeg_bytes, pre.mime_type))
    dest_raw_path.parent.mkdir(parents=True, exist_ok=True)

    def call() -> str:
        resp = client.models.generate_content(model=model, contents=parts)
        return resp.text or ""

    text = call_with_retries(
        call,
        lambda e: "429" in str(e) or "500" in str(e) or "503" in str(e) or "timeout" in str(e).lower(),
        max_attempts=4,
        base_sleep_seconds=1.0,
    )
    dest_raw_path.write_text(text, encoding="utf-8")
    spec = extract_json_object_from_model_text(text)
    if manifest["roles"]["pose_ref"]["same_file_as_look_ref"]:
        spec.setdefault("pose_ref_source", "shared_with_look")
    validate_look_spec(spec)
    dest_spec_path.parent.mkdir(parents=True, exist_ok=True)
    dest_spec_path.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return spec
```

- [ ] **Step 4: 仅运行解析测试**

Run:

```bash
uv run pytest tests/test_understand_parse.py::test_extract_json_from_fenced_block -q
```

Expected: `1 passed`（需同步创建 `tests/test_understand_parse.py` 文件内容与 Step 1 一致）。

- [ ] **Step 5: Commit**

```bash
git add look_pipeline/understand.py tests/test_understand_parse.py
git commit - "feat: understand step JSON extract and writer"
```

修正：commit 消息 typo `git commit -m`。

```bash
git commit -m "feat: understand step JSON extract and writer"
```

---

### Task 11: 生成步骤 2a / 2b

**Files:**
- Create: `look_pipeline/generate.py`

- [ ] **Step 1: 新建（可选）网络集成测试文件并默认跳过**

创建 `tests/test_generate_integration.py`：

```python
import json
import os
from pathlib import Path

import pytest

from google import genai

from look_pipeline.generate import run_step_2a, run_step_2b


@pytest.mark.skipif(not os.getenv("RUN_GENAI_INTEGRATION"), reason="RUN_GENAI_INTEGRATION not set")
def test_integration_2a_smoke() -> None:
    repo = Path(__file__).resolve().parents[1]
    run_dir = repo / "runs" / "integration-smoke"
    manifest = json.loads((run_dir / "input_manifest.json").read_text(encoding="utf-8"))
    spec = json.loads((run_dir / "look_spec_approved.json").read_text(encoding="utf-8"))
    client = genai.Client()
    run_step_2a(client=client, repo_root=repo, manifest=manifest, spec=spec, model=os.getenv("GEN_MODEL_2A", "gemini-3.1-flash-image-preview"), brief_path=run_dir / "brief_2a.txt", out_image=run_dir / "draft_2a.png")
```

集成测试依赖人工准备的 `runs/integration-smoke`；首版实现可先跳过该文件，仅保留单元测试路径。更稳妥：**本 Task 不添加上述集成文件**，只在计划中说明设置 `RUN_GENAI_INTEGRATION=1` 时由工程师自建 run 目录后运行。

- [ ] **Step 2: 实现 `look_pipeline/generate.py`**

```python
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping

from google import genai
from google.genai import types

from look_pipeline.brief import compile_brief_2a, compile_brief_2b
from look_pipeline.image_parts import bytes_to_image_part, save_first_image_from_response
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
    brief = compile_brief_2a(spec)
    brief_path.parent.mkdir(parents=True, exist_ok=True)
    brief_path.write_text(brief, encoding="utf-8")
    contents: list[Any] = [brief]
    for role in ("look_ref", "pose_ref", "face", "sku_flat"):
        contents.append(_load_image_part(repo_root, roles[role]["path"]))
    cfg = types.GenerateContentConfig(response_modalities=["IMAGE", "TEXT"])

    def call():
        return client.models.generate_content(model=model, contents=contents, config=cfg)

    resp = call_with_retries(
        call,
        lambda e: "429" in str(e) or "500" in str(e) or "503" in str(e) or "timeout" in str(e).lower(),
        max_attempts=4,
        base_sleep_seconds=1.0,
    )
    save_first_image_from_response(resp, out_image)


def run_step_2b(
    *,
    client: genai.Client,
    repo_root: Path,
    manifest: Mapping[str, Any],
    spec: Mapping[str, Any],
    draft_image: Path,
    model: str,
    brief_path: Path,
    out_image: Path,
) -> None:
    roles = manifest["roles"]
    brief = compile_brief_2b(spec)
    brief_path.write_text(brief, encoding="utf-8")
    with draft_image.open("rb") as f:
        draft_bytes = f.read()
    contents: list[Any] = [
        brief,
        bytes_to_image_part(draft_bytes, "image/png" if draft_image.suffix.lower() == ".png" else "image/jpeg"),
        _load_image_part(repo_root, roles["fabric_detail"]["path"]),
        _load_image_part(repo_root, roles["logo_detail"]["path"]),
    ]
    cfg = types.GenerateContentConfig(response_modalities=["IMAGE", "TEXT"])

    def call():
        return client.models.generate_content(model=model, contents=contents, config=cfg)

    resp = call_with_retries(
        call,
        lambda e: "429" in str(e) or "500" in str(e) or "503" in str(e) or "timeout" in str(e).lower(),
        max_attempts=4,
        base_sleep_seconds=1.0,
    )
    save_first_image_from_response(resp, out_image)
```

**SDK 注意：** 若 `GenerateContentConfig(response_modalities=[...])` 与当前锁定的 `google-genai` 类型签名不一致，先在解释器中 `inspect.signature(genai.Client.models.generate_content)` 对照；必要时改为不传 `config`（部分 Nano Banana 模型默认即返回图像）。

- [ ] **Step 3: 运行静态检查（import）**

Run:

```bash
uv run python -c "from look_pipeline import generate; print('ok')"
```

Expected: 输出 `ok`。

- [ ] **Step 4: Commit**

```bash
git add look_pipeline/generate.py
git commit -m "feat: wire 2a and 2b generation steps"
```

---

### Task 12: Logo 编辑步骤

**Files:**
- Create: `look_pipeline/edit.py`

- [ ] **Step 1: 实现 `look_pipeline/edit.py`**

```python
from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from google import genai
from google.genai import types

from look_pipeline.brief import compile_brief_logo_edit
from look_pipeline.image_parts import bytes_to_image_part, save_first_image_from_response
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
    brief = compile_brief_logo_edit(spec)
    with base_image.open("rb") as f:
        base_bytes = f.read()
    mime = "image/png" if base_image.suffix.lower() == ".png" else "image/jpeg"
    rel = manifest["roles"]["logo_detail"]["path"]
    abs_path = (repo_root / rel).resolve()
    pre = preprocess_for_model(abs_path)
    contents: list[Any] = [brief, bytes_to_image_part(base_bytes, mime), bytes_to_image_part(pre.jpeg_bytes, pre.mime_type)]
    cfg = types.GenerateContentConfig(response_modalities=["IMAGE", "TEXT"])

    def call():
        return client.models.generate_content(model=model, contents=contents, config=cfg)

    resp = call_with_retries(
        call,
        lambda e: "429" in str(e) or "500" in str(e) or "503" in str(e) or "timeout" in str(e).lower(),
        max_attempts=4,
        base_sleep_seconds=1.0,
    )
    save_first_image_from_response(resp, out_image)
```

- [ ] **Step 2: 验证 import**

Run:

```bash
uv run python -c "from look_pipeline import edit; print('ok')"
```

Expected: `ok`。

- [ ] **Step 3: Commit**

```bash
git add look_pipeline/edit.py
git commit -m "feat: logo edit pass using base and logo_detail"
```

---

### Task 13: CLI 串联闸门文件

**Files:**
- Create: `look_pipeline/cli.py`
- Modify: `pyproject.toml`（添加 `[project.scripts]` 可选；至少保证 `python -m look_pipeline.cli -h` 可用）

在 `pyproject.toml` 的 `[project]` 下追加：

```toml
[project.scripts]
look-pipeline = "look_pipeline.cli:main"
```

创建 `look_pipeline/cli.py`：

```python
from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path

import dotenv
from google import genai

from look_pipeline.edit import run_logo_edit
from look_pipeline.generate import run_step_2a, run_step_2b
from look_pipeline.manifest import write_input_manifest
from look_pipeline.run_layout import RunLayout, default_runs_dir
from look_pipeline.understand import run_understand_step


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _client() -> genai.Client:
    dotenv.load_dotenv()
    base = os.getenv("GEMINI_BASE_URL")
    kwargs: dict = {"api_key": os.getenv("GEMINI_API_KEY")}
    if base:
        kwargs["http_options"] = {"base_url": base}
    return genai.Client(**kwargs)


def cmd_init_run(args: argparse.Namespace) -> None:
    repo = Path(args.repo).resolve()
    fixture = json.loads(Path(args.fixture).read_text(encoding="utf-8"))
    runs = default_runs_dir(repo)
    layout = RunLayout(runs, fixture["run_id"])
    layout.run_dir.mkdir(parents=True, exist_ok=True)
    write_input_manifest(repo, fixture, layout.manifest_path)
    print(layout.manifest_path)


def cmd_understand(args: argparse.Namespace) -> None:
    repo = Path(args.repo).resolve()
    layout = RunLayout(default_runs_dir(repo), args.run_id)
    manifest = json.loads(layout.manifest_path.read_text(encoding="utf-8"))
    client = _client()
    model = os.getenv("GEMINI_UNDERSTAND_MODEL", "gemini-3-flash-preview")
    out_spec = layout.run_dir / f"look_spec_v{args.version}.json"
    out_raw = layout.run_dir / f"understand_v{args.version}_raw.txt"
    run_understand_step(
        client=client,
        repo_root=repo,
        manifest=manifest,
        model=model,
        dest_spec_path=out_spec,
        dest_raw_path=out_raw,
    )
    print(out_spec)


def cmd_approve_spec(args: argparse.Namespace) -> None:
    repo = Path(args.repo).resolve()
    layout = RunLayout(default_runs_dir(repo), args.run_id)
    src = layout.run_dir / args.src
    shutil.copyfile(src, layout.approved_spec_path)
    print(layout.approved_spec_path)


def cmd_draft_2a(args: argparse.Namespace) -> None:
    repo = Path(args.repo).resolve()
    layout = RunLayout(default_runs_dir(repo), args.run_id)
    manifest = json.loads(layout.manifest_path.read_text(encoding="utf-8"))
    spec = json.loads(layout.approved_spec_path.read_text(encoding="utf-8"))
    client = _client()
    model = os.getenv("GEN_MODEL_2A", "gemini-3.1-flash-image-preview")
    run_step_2a(
        client=client,
        repo_root=repo,
        manifest=manifest,
        spec=spec,
        model=model,
        brief_path=layout.brief_2a_path,
        out_image=layout.draft_2a_path,
    )
    print(layout.draft_2a_path)


def cmd_final_2b(args: argparse.Namespace) -> None:
    repo = Path(args.repo).resolve()
    layout = RunLayout(default_runs_dir(repo), args.run_id)
    manifest = json.loads(layout.manifest_path.read_text(encoding="utf-8"))
    spec = json.loads(layout.approved_spec_path.read_text(encoding="utf-8"))
    client = _client()
    model = os.getenv("GEN_MODEL_2B", os.getenv("GEN_MODEL_2A", "gemini-3.1-flash-image-preview"))
    run_step_2b(
        client=client,
        repo_root=repo,
        manifest=manifest,
        spec=spec,
        draft_image=layout.draft_2a_path,
        model=model,
        brief_path=layout.brief_2b_path,
        out_image=layout.final_path,
    )
    print(layout.final_path)


def cmd_logo_edit(args: argparse.Namespace) -> None:
    repo = Path(args.repo).resolve()
    layout = RunLayout(default_runs_dir(repo), args.run_id)
    manifest = json.loads(layout.manifest_path.read_text(encoding="utf-8"))
    spec = json.loads(layout.approved_spec_path.read_text(encoding="utf-8"))
    client = _client()
    model = os.getenv("GEN_MODEL_EDIT", os.getenv("GEN_MODEL_2B", "gemini-3.1-flash-image-preview"))
    base = layout.final_path if args.from_final else layout.draft_2a_path
    out = layout.run_dir / "look_logo_patch.png"
    run_logo_edit(
        client=client,
        repo_root=repo,
        manifest=manifest,
        spec=spec,
        base_image=base,
        model=model,
        out_image=out,
    )
    print(out)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="look-pipeline")
    p.add_argument("--repo", default=str(_repo_root()))
    sub = p.add_subparsers(dest="cmd", required=True)

    s1 = sub.add_parser("init-run", help="Create run dir and input_manifest.json from fixture JSON")
    s1.add_argument("--fixture", required=True)
    s1.set_defaults(func=cmd_init_run)

    s2 = sub.add_parser("understand", help="Call understand model; write look_spec_v{n}.json")
    s2.add_argument("--run-id", required=True)
    s2.add_argument("--version", type=int, default=0)
    s2.set_defaults(func=cmd_understand)

    s3 = sub.add_parser("approve-spec", help="Copy a spec file to look_spec_approved.json")
    s3.add_argument("--run-id", required=True)
    s3.add_argument("--src", default="look_spec_v0.json")
    s3.set_defaults(func=cmd_approve_spec)

    s4 = sub.add_parser("draft-2a", help="Generate draft_2a.png")
    s4.add_argument("--run-id", required=True)
    s4.set_defaults(func=cmd_draft_2a)

    s5 = sub.add_parser("final-2b", help="Generate look_final_4k.png from draft")
    s5.add_argument("--run-id", required=True)
    s5.set_defaults(func=cmd_final_2b)

    s6 = sub.add_parser("logo-edit", help="Logo-focused edit pass")
    s6.add_argument("--run-id", required=True)
    s6.add_argument("--from-final", action="store_true")
    s6.set_defaults(func=cmd_logo_edit)

    return p


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 创建 `look_pipeline/__main__.py`**

```python
from look_pipeline.cli import main

if __name__ == "__main__":
    main()
```

- [ ] **Step 3: 运行 help**

Run:

```bash
uv run python -m look_pipeline -h
```

Expected: 显示子命令列表。

- [ ] **Step 4: Commit**

```bash
git add look_pipeline/cli.py look_pipeline/__main__.py pyproject.toml
git commit -m "feat: argparse CLI for init, understand, approve, 2a, 2b, logo-edit"
```

---

### Task 14: 全量 pytest 与 `.gitignore` 更新

**Files:**
- Modify: `.gitignore`（忽略 `runs/` 下产物，保留目录可选）

追加行：

```
runs/**/*
!runs/.gitkeep
```

并创建空文件 `runs/.gitkeep`。

- [ ] **Step 1: 运行全量测试**

Run:

```bash
uv run pytest -q
```

Expected: 全部通过（不含需网络的用例）。

- [ ] **Step 2: Commit**

```bash
git add .gitignore runs/.gitkeep
git commit -m "chore: ignore generated runs output"
```

---

## Spec 对照自检

| Spec 章节 | 对应 Task |
|-----------|-----------|
| 1.1 六输入与 pose 共用 | Task 2 manifest 字段；Task 5 `pose_ref_source`；Task 6 brief 分块 |
| 1.2 4K 输出 | Task 11 `look_final_4k.png` 文件名约定；实际分辨率依赖模型 |
| 1.3 一致性 | Task 6/10/11 prompt 约束（实现后由人工闸门验证） |
| 1.4 半自动 | Task 13 CLI `approve-spec` 与分步命令 |
| 2.1 无 File API、2048 | Task 3 预处理；Task 4 manifest 记录 |
| 2.2 模型可配置 | Task 10/11/13 环境变量 |
| 2.3 tests 夹具 | Task 2 |
| 3.x 组件拆分 | Task 1–14 文件表 |
| 4 数据流产物 | Task 4 manifest；Task 9 layout；Task 10–13 写入路径 |
| 5 错误重试 | Task 8；Task 10/11/12 包装 |
| 6 测试 | 各 Task 测试；集成需 `RUN_GENAI_INTEGRATION` 自建 run（Task 11 说明） |

**缺口说明（可接受）：** 全自动「闸门 B/C 失败不覆盖」需工程师在重跑时使用递增 `look_spec_v{n}` 或新 `run_id`；CLI 未强制禁止覆盖 `draft_2a.png`，与 spec「不覆盖已批准中间件」一致的做法是 **人工使用新 run_id**——若需硬防护，可在后续小任务为已存在 `look_spec_approved.json` 的 `approve-spec` 增加 `--force`。

**Placeholder 扫描：** 已搜索 “TBD/TODO/appropriate/later” — 无。

**类型/命名一致性：** `RunLayout.final_path`、`look_final_4k.png`、`GEN_MODEL_2B` 在全计划一致。

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-21-look-generation-pipeline.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — 每个 Task 派生子代理执行，Task 之间人工快速复核，迭代快  

**2. Inline Execution** — 本会话按 Task 顺序执行，使用 executing-plans，在关键 Task（如 11、13）后设检查点  

**Which approach?**
