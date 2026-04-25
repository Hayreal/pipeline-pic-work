# Electron Look 工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在仓库内新增 `apps/look-workbench`：Electron 壳 + 本机 Express 后端 + 复用 `look_pipeline` 子进程；实现 `regions_k.json` 校验、精修 CLI、`run_state.json` 状态机、串行批量初稿 API 与最小可跑 UI（健康检查 + 触发单步）。

**Architecture:** 渲染进程只调 `127.0.0.1`；Node 后端排队调用 `uv run python -m look_pipeline ...`；Python 扩展 `refine` 步骤读取框选 JSON 并生成 `draft_refined_k.png`；终稿步骤支持以「最新精修图或初稿」为底图。全本地、无自建云端业务 API。

**Tech Stack:** Electron 33+、TypeScript 5+、Express 4、Node 20+、`tsx` 开发运行；Python 3.12 现有栈；测试：Python `pytest` + Node `vitest`（仅后端逻辑）。

---

## 文件结构（落地前锁定）

| 路径 | 职责 |
|------|------|
| `schemas/regions.v1.json` | `regions_k.json` 的 JSON Schema（草案 2020-12），供文档与可选校验工具引用 |
| `look_pipeline/regions_validate.py` | 解析并校验 regions 文件，非法则 `ValueError` |
| `look_pipeline/refine.py` | `run_refine_pass(...)`：读底图 + regions，拼编辑 prompt，调用 `generate_content`，写 `draft_refined_k.png` |
| `look_pipeline/run_layout.py` | 增加 `refined_draft_path(k)`、`run_state_path`、`gate_draft_approved_path` 等 |
| `look_pipeline/cli.py` | 新增子命令 `refine-pass`、`write-gate`、`final-2b` 支持 `--draft-image` 可选覆盖底图路径 |
| `tests/test_regions_validate.py` | 校验器单元测试 |
| `tests/test_refine_mock.py` | 可选：mock client 测 prompt 组装（若成本高可二期） |
| `apps/look-workbench/package.json` | Electron + express + typescript + vitest + concurrently |
| `apps/look-workbench/tsconfig.json` | `moduleResolution: bundler`, `strict`, `outDir: dist` |
| `apps/look-workbench/src/backend/server.ts` | Express：`GET /health`, `POST /api/workspace`, `POST /api/runs/:runId/step/:name` |
| `apps/look-workbench/src/backend/pythonRunner.ts` | `spawn` `uv` 或 `python -m look_pipeline`，流式收集 stdout/stderr |
| `apps/look-workbench/src/backend/runState.ts` | 读写 `run_state.json`、合法迁移检查 |
| `apps/look-workbench/src/backend/batchQueue.ts` | 串行队列、取消标志 |
| `apps/look-workbench/src/main.ts` | Electron：BrowserWindow、`spawn` 后端子进程传 `PORT`、关闭时 kill |
| `apps/look-workbench/src/preload.ts` | `contextBridge.exposeInMainWorld` 暴露 `getBackendBase()` |
| `apps/look-workbench/src/renderer/index.html` | 极简页：显示 backend URL、按钮调 `/health` |

---

### Task 1: `schemas/regions.v1.json` + Python 校验器 + 测试

**Files:**
- Create: `schemas/regions.v1.json`
- Create: `look_pipeline/regions_validate.py`
- Create: `tests/test_regions_validate.py`

- [ ] **Step 1: 写失败测试 `tests/test_regions_validate.py`**

```python
import pytest

from look_pipeline.regions_validate import validate_regions_payload


def test_valid_minimal() -> None:
    payload = {
        "schema_version": 1,
        "image_ref": "draft_2a.png",
        "regions": [{"kind": "face", "rect_norm": {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4}}],
    }
    validate_regions_payload(payload)


def test_rejects_bad_kind() -> None:
    payload = {
        "schema_version": 1,
        "image_ref": "draft_2a.png",
        "regions": [{"kind": "nose", "rect_norm": {"x": 0, "y": 0, "w": 1, "h": 1}}],
    }
    with pytest.raises(ValueError):
        validate_regions_payload(payload)
```

- [ ] **Step 2: 运行 pytest 确认失败**

Run: `uv run pytest tests/test_regions_validate.py -q`  
Expected: `ImportError` 或 `validate_regions_payload` 未定义。

- [ ] **Step 3: 创建 `schemas/regions.v1.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://local.look-image-utils/regions.v1.json",
  "title": "RefineRegionsV1",
  "type": "object",
  "required": ["schema_version", "image_ref", "regions"],
  "properties": {
    "schema_version": { "const": 1 },
    "image_ref": { "type": "string", "minLength": 1 },
    "regions": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["kind", "rect_norm"],
        "properties": {
          "kind": { "enum": ["face", "logo", "detail"] },
          "note": { "type": "string" },
          "rect_norm": {
            "type": "object",
            "required": ["x", "y", "w", "h"],
            "properties": {
              "x": { "type": "number", "minimum": 0, "maximum": 1 },
              "y": { "type": "number", "minimum": 0, "maximum": 1 },
              "w": { "type": "number", "minimum": 0, "maximum": 1 },
              "h": { "type": "number", "minimum": 0, "maximum": 1 }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}
```

- [ ] **Step 4: 实现 `look_pipeline/regions_validate.py`**

```python
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
```

- [ ] **Step 5: 增加 `test_rejects_rect_out_of_range` 并运行 pytest**

```python
def test_rejects_rect_out_of_range() -> None:
    payload = {
        "schema_version": 1,
        "image_ref": "draft_2a.png",
        "regions": [{"kind": "face", "rect_norm": {"x": 1.1, "y": 0, "w": 0.1, "h": 0.1}}],
    }
    with pytest.raises(ValueError):
        validate_regions_payload(payload)
```

Run: `uv run pytest tests/test_regions_validate.py -q`  
Expected: `3 passed`。

- [ ] **Step 6: Commit**

```bash
git add schemas/regions.v1.json look_pipeline/regions_validate.py tests/test_regions_validate.py
git commit -m "feat: regions_k.json schema v1 and Python validator"
```

---

### Task 2: 扩展 `RunLayout` 路径助手

**Files:**
- Modify: `look_pipeline/run_layout.py`
- Create: `tests/test_run_layout_paths_extra.py`

- [ ] **Step 1: 在 `RunLayout` 增加方法**

```python
    def refined_draft_path(self, k: int) -> Path:
        return self.run_dir / f"draft_refined_{k}.png"

    def regions_path(self, k: int) -> Path:
        return self.run_dir / f"regions_{k}.json"

    def run_state_path(self) -> Path:
        return self.run_dir / "run_state.json"

    def gate_draft_approved_path(self) -> Path:
        return self.run_dir / "gate_draft_approved.json"
```

- [ ] **Step 2: 测试**

```python
from pathlib import Path

from look_pipeline.run_layout import RunLayout


def test_refined_and_regions_paths(tmp_path: Path) -> None:
    layout = RunLayout(tmp_path, "r1")
    assert layout.refined_draft_path(2) == tmp_path / "r1" / "draft_refined_2.png"
    assert layout.regions_path(2) == tmp_path / "r1" / "regions_2.json"
    assert layout.run_state_path() == tmp_path / "r1" / "run_state.json"
```

- [ ] **Step 3: Commit**

```bash
git add look_pipeline/run_layout.py tests/test_run_layout_paths_extra.py
git commit -m "feat: run layout paths for refine and run_state"
```

---

### Task 3: `refine.py` + CLI `refine-pass`

**Files:**
- Create: `look_pipeline/refine.py`
- Modify: `look_pipeline/cli.py`
- Create: `tests/test_refine_prompt_build.py`（纯函数测 prompt 文本，不调用 API）

- [ ] **Step 1: 在 `look_pipeline/refine.py` 实现 `build_refine_edit_prompt` 与 `run_refine_pass`**

要点：

- 读 `layout.run_dir / image_ref` 为底图字节；用 `PIL.Image.open` 得 `W,H`，把每个 `rect_norm` 换为像素 `x0,y0,x1,y1` 写入 prompt 列表。  
- 文本指令强调：**仅在给定矩形内**做局部增强，**不改变**整体构图与矩形外像素（模型尽力遵守）。  
- `generate_content` 配置复用 `build_image_generate_content_config()`；输出 `save_first_image_from_response` → `layout.refined_draft_path(k)`。

`build_refine_edit_prompt` 签名示例：

```python
def build_refine_edit_prompt(*, spec: Mapping[str, Any], regions_doc: Mapping[str, Any], pixel_boxes: list[tuple[str, tuple[int, int, int, int]]]) -> str:
    ...
```

`pixel_boxes` 每项为 `(kind, (x0, y0, x1, y1))`。

- [ ] **Step 2: CLI 子命令 `refine-pass`**

参数：`--run-id`、`--index k`、`--repo`；行为：读 `regions_k.json`，校验，调 `run_refine_pass`。

- [ ] **Step 3: 单元测试只测 `build_refine_edit_prompt` 含 `"face"` 与像素坐标子串**

- [ ] **Step 4: Commit**

```bash
git add look_pipeline/refine.py look_pipeline/cli.py tests/test_refine_prompt_build.py
git commit -m "feat: refine-pass CLI and region-based edit prompt"
```

---

### Task 4: `final-2b` 可选底图 + `write-gate` CLI

**Files:**
- Modify: `look_pipeline/cli.py` 中 `cmd_final_2b` 与 `generate.run_step_2b` 调用链  
- Modify: `look_pipeline/generate.py`：`run_step_2b` 增加可选参数 `draft_image: Path | None = None`；若 `None` 则解析 `run_dir` 下最新 `draft_refined_*.png` 否则 `draft_2a.png`（按文件名数字最大）。

- [ ] **Step 1: 在 `generate.run_step_2b` 增加参数 `draft_source: Path | None`**

若 `None`：`draft_source = resolve_latest_refined_or_draft(layout.run_dir)`（新辅助函数放在 `generate.py` 或 `run_layout`）。

- [ ] **Step 2: CLI `final-2b` 增加 `--draft-image` 可选**

- [ ] **Step 3: 新增 `write-gate` 子命令**

`write-gate --run-id X --name draft|refine_k|final` 写入对应 `gate_*.json`（内含 `iso8601` 时间戳字段 `approved_at`）。

- [ ] **Step 4: pytest 最小测试 `resolve_latest_refined_or_draft` 在临时目录放 `draft_refined_2.png` 与 `draft_2a.png` 时选前者**

- [ ] **Step 5: Commit**

```bash
git add look_pipeline/generate.py look_pipeline/cli.py tests/test_final_draft_resolve.py
git commit -m "feat: final-2b draft source resolution and write-gate CLI"
```

---

### Task 5: Node 后端包初始化

**Files:**
- Create: `apps/look-workbench/package.json`
- Create: `apps/look-workbench/tsconfig.json`
- Create: `apps/look-workbench/src/backend/server.ts`
- Create: `apps/look-workbench/src/backend/pythonRunner.ts`

`package.json` 核心字段：

```json
{
  "name": "look-workbench",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev:backend": "tsx watch src/backend/server.ts",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "express": "^4.21.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`server.ts` 最小实现：

```typescript
import express from "express";

const app = express();
app.use(express.json({ limit: "20mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const port = Number(process.env.LOOK_WORKBENCH_PORT ?? "17373");
app.listen(port, "127.0.0.1", () => {
  console.log(`look-workbench backend http://127.0.0.1:${port}`);
});
```

`pythonRunner.ts`：`export function runLookPipeline(args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<{ code: number; stdout: string; stderr: string }>` 使用 `child_process.spawn` 与 `uv run python -m look_pipeline`（`process.env.UV_PROJECT` 或 `cwd` 指向仓库根）。

- [ ] **Step 1:** `cd apps/look-workbench && npm install`  
- [ ] **Step 2:** `npx vitest run` 占位测试 `tests/backend/health.test.ts` 对 `GET /health` 使用 `supertest`（可选）或跳过首版  
- [ ] **Step 3: Commit**（含 `package-lock.json`）

---

### Task 6: `runState.ts` + `POST /api/runs/:id/step/:name`

**Files:**
- Create: `apps/look-workbench/src/backend/runState.ts`
- Modify: `apps/look-workbench/src/backend/server.ts`

状态枚举与迁移表与 spec §4 对齐；`POST .../step/draft-2a` 时检查前置 `SPEC_APPROVED` 等。

实现最小集：`init_fixture`（写 `fixture_snapshot` + 调 `init-run`）、`understand`、`approve_spec`、`draft_2a` 映射到已有 CLI 参数。

- [ ] **Step 1: 单元测试 `runState.test.ts`** 用 `vitest` 测非法迁移抛错  
- [ ] **Step 2: Commit**

---

### Task 7: 串行 `batchQueue.ts`

**Files:**
- Create: `apps/look-workbench/src/backend/batchQueue.ts`

队列元素：`{ runId, fixturePath }[]`；处理函数顺序 `init`→`understand`→`approve_spec`（首版可 `--src look_spec_v0.json` 自动）→`draft_2a`；失败写 `run_error.json` 并标记状态 `FAILED`。

- [ ] **Step 1: vitest 测队列在 reject 后停止**（mock runner）  
- [ ] **Step 2: Commit**

---

### Task 8: Electron Main + Preload + 极简 Renderer

**Files:**
- Add devDependencies: `electron`, `electron-builder`（仅打包阶段）  
- Create: `apps/look-workbench/src/main.ts`：创建窗口加载 `file://.../renderer/index.html`；`spawn` `node dist/backend/server.js` 或开发时 `tsx src/backend/server.ts`；通过 `LOOK_WORKBENCH_PORT` 通信。  
- Create: `apps/look-workbench/src/preload.ts`  
- Create: `apps/look-workbench/src/renderer/index.html` + `renderer.ts`：`fetch(\`http://127.0.0.1:${port}/health\`)` 显示结果。

- [ ] **Step 1: `package.json` scripts 增加 `"start": "electron ."` 且 `main` 指向编译后 `dist/main.js"`**  
- [ ] **Step 2: 手测：双终端 `npm run dev:backend` + `npm start` 能看到 health OK**  
- [ ] **Step 3: Commit**

---

### Task 9: 文档与仓库根 README 片段

**Files:**
- Modify: `README.md` 增加一节「Look Workbench（Electron）」：如何 `cd apps/look-workbench && npm install && npm run dev:backend`、如何配置 `WORKSPACE_ROOT` 指向含 `look_pipeline` 的仓库根。

（若你禁止改 README，可改为 `apps/look-workbench/README.md` 仅应用内文档。）

- [ ] **Step 1: Commit**

---

## Spec 对照自检

| Spec 章节 | 对应 Task |
|-----------|-----------|
| 1.1 全流程 + 批量初稿 | Task 6–7 |
| 1.2 YAGNI 矩形 | Task 1 schema + renderer 二期再画框 |
| 1.3 新文件历史 | Task 2–3 文件名、`final` 解析 |
| 3.2 regions | Task 1 |
| 4 状态机 | Task 6 |
| 5 安全 | Task 8 preload 仅暴露 port；无密钥进 renderer |
| 6 错误 | Task 6–7 `run_error.json` |
| 7 测试 | 各 Task pytest/vitest |
| 8 目录 `apps/look-workbench` | Task 5–8 |

**缺口（显式列在二期）：** 画布 UI、SSE 进度、electron-builder 签名流水线、`fixture_snapshot` 从 UI 生成的完整表单。

**Placeholder 扫描：** 无 TBD；`resolve_latest_refined_or_draft` 需在 Task 4 给出完整实现代码（实现时补全）。

**命名一致性：** `draft_refined_k`、`regions_k` 与 spec 一致。

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-21-electron-look-workbench.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — 每个 Task 单独子代理执行，Task 之间快速复核  

**2. Inline Execution** — 本会话按 Task 顺序执行，关键 Task 后设检查点  

**Which approach?**
