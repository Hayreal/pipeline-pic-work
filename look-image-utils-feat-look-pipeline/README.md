# look-image-utils

本地 Look 生成管线（Gemini 多模态）：**理解参考图 → 出 brief → 2A 主成图**；可选在 2A 底图上做 **logo 修图**（需 `logo` 参考图）。  
旧版「2B 面料 4K 精修」已移除；**未来 2B** 计划为基于 2A 的细分能力（如皮肤细节、logo），需独立参考图与实现。

---

## 功能概览

| 能力 | 说明 |
| ---- | ---- |
| 主流程（默认到 2A） | 读 fixture → understand → 生成 2A 出图等产物 |
| 全链路 `full` | 2A 完成后，若 JSON 中配置了 logo 参考，可继续 **logo 修图**（`--through full`） |
| 分步命令 | `init-run`、`understand`、`approve-spec`、`draft-2a`、`logo-edit`、`face-edit`、`detail-edit`、`refine-pass`、`write-gate` 等，便于调试或接 Workbench |

---

## 环境要求

- **Python** ≥ 3.12（推荐用 [uv](https://github.com/astral-sh/uv) 装依赖）
- **包管理**：本仓库以 **uv** 为主；也兼容 `pip install -e .`

---

## 安装

在**本仓库根目录**执行一次同步依赖：

```bash
uv sync
```

之后不必每次激活 venv，用下面任一方式启动（**两种等价**）：

```bash
uv run look-pipeline run --fixture path/to/run.json
uv run python -m look_pipeline run --fixture path/to/run.json
```

若希望**全局**可用 `look-pipeline` 命令：

```bash
uv tool install .
```

---

## 工作目录与路径（无 `--repo` 参数）

工作仓库根由 `look_pipeline/repo_root.py` 的 `default_repo_root()` 决定，CLI 内经 `_work_repo_root()` 使用，与之一致：

- **包位于 `site-packages`（`uv run` / `pip` 装到 venv 的常见情况）或 PyInstaller 单文件/目录包**：工作仓库根 = **当前工作目录** `Path.cwd()`。请在**含** `jobs/`、`runs/`、`.env` 的**本仓库根**下 `cd` 再执行，fixture 中相对路径、以及 `runs/<run_id>/` 都相对该根。
- **其它**（`look_pipeline` 的模块路径不落在 `site-packages` 下的直跑源树，少见）：工作仓库根 = `look_pipeline` 的上一级目录（与本仓库结构一致时即仓库根）。

需要固定位置时，可对 `--fixture` 等参数使用**绝对路径**；输出目录 `runs/<run_id>/` 仍落在工作仓库根下。

---

## 配置

将下列变量写入仓库根目录的 `.env`（可对照 `.env.example`）。

| 变量 | 说明 |
| ---- | ---- |
| `GEMINI_API_KEY` | 必需 |
| `GEMINI_BASE_URL` | 可选，自定义兼容端点 |
| `GEMINI_UNDERSTAND_MODEL` | 理解步骤模型，默认 `gemini-3-flash-preview` |
| `GEN_MODEL_2A` / `GEN_MODEL_EDIT` | 2A 生图、logo 编辑；`GEN_MODEL_2B` 仅作回退名 |
| `GEN_IMAGE_SIZE` | `1K` / `2K` / `4K`，默认 `4K` |
| `GEN_IMAGE_ASPECT_RATIO` | 如 `3:4`、`2:3`；不设则由模型默认 |

---

## 操作：主命令

**推荐**（在本仓库根下、或已 `cd` 到项目根时）：

```bash
uv run look-pipeline run --fixture path/to/run.json
```

`--fixture` 可传相对或绝对路径；相对路径相对**工作仓库根**（见上节）。批量时可用多个 `--fixture` 与可选 `--fixture-glob`（`look-pipeline run --help`）。

**附加口播式要求**（会进入 understand 与 2A 主 prompt）：

```bash
uv run look-pipeline run --fixture jobs/家居/job_look_2.json \
  --extra-prompt "领口必须为双层罗纹圆领结构，与 sku 图一致，不要画成普通单层圆领。"
```

### 2A + logo 修图（`--through full`）

- Fixture 中增加 `logo_detail` 或 `logo_ref`（二选一，同时非空时以 `logo_detail` 为准）指向 **logo 特写**。
- 执行顺序：先完成 **2A** → 得到 `runs/<run_id>/draft_2a.png`；再以该图为底、logo 特写为参考做 **logo 修图** → 得到 `runs/<run_id>/look_logo_patch.png`。

```bash
uv run python -m look_pipeline run --through full --fixture path/to/run_with_logo.json
```

---

## Fixture 字段说明

所有路径为**相对工作仓库根**（见上文「工作目录与路径」）的 POSIX 风格字符串，且文件在运行前必须已存在。

| 字段 | 是否必填 | 说明 |
| ---- | -------- | ---- |
| `run_id` | 是 | 本次运行 ID，与 `runs/<run_id>/` 目录名一致 |
| `look_ref` | 是 | Look / 姿势参考图（与 `pose` 可同图；见下） |
| `sku_flat` | 是 | 平铺 SKU 图。可为**单个**路径，或**非空**路径**数组**（多角/正反等）；理解步骤与 2A 会按张带标签 `view 1/n` 送模型。`input_manifest` 中首项为 `path`，全部在 `paths` + `items` |
| `fabric_detail` | 是 | 面料特写参考 |
| `face` | 否 | 面部/身份参考；**可省略**（如袜子/静物等）。可单张或多张，语义同 `sku_flat` |
| `pose_ref` | 否 | 若省略或空字符串，**自动与 `look_ref` 相同** |
| `logo_detail` 或 `logo_ref` | 否 | 二选一即可（`logo_ref` 为别名）：**一张** logo 特写。仅当使用 `--through full` 时，在 2A 之后与 `draft_2a.png` 一起用于修图；同时也会被 understand 读入以写 spec |
| `look_ref_side` / `look_ref_back` | 否 | 衣身侧面 / 背面参考 |
| `prompt_extra` | 否 | 附加文字要求（`string` 或 `string[]`）。写入 `input_manifest.json`，并进入 understand 与 2A 主 prompt 的 `### USER_SUPPLEMENT_BLOCK` |

**仅 2A（默认）** 可不带 `face` 与任何 logo 字段。最小示例（无 `face`）：

```json
{
  "run_id": "sample-010",
  "look_ref": "tests/Look参考图/look_banana/0604bananain56494.jpg",
  "sku_flat": "tests/SKU面料素材/月粉 (2).png",
  "fabric_detail": "tests/SKU面料素材/面料与logo裁图/月粉.png"
}
```

**多张 `sku_flat` / `face`**（与单字符串二选一，勿混用类型）：

```json
"sku_flat": [
  "tests/SKU面料素材/月粉-正面.png",
  "tests/SKU面料素材/月粉-背面.png"
],
"face": [
  "tests/模特脸部特写/女模-1-正.png",
  "tests/模特脸部特写/女模-1-侧.png"
]
```

**2A + logo 修图** 示例：

```json
{
  "run_id": "sample-011",
  "look_ref": "tests/Look参考图/look_banana/0604bananain56494.jpg",
  "sku_flat": "tests/SKU面料素材/月粉 (2).png",
  "fabric_detail": "tests/SKU面料素材/面料与logo裁图/月粉.png",
  "face": "tests/模特脸部特写/女模-1.png",
  "pose_ref": "tests/Look参考图/look_banana/0604bananain56494.jpg",
  "logo_ref": "tests/某路径/logo特写.png"
}
```

---

## 分步命令（调试）

`init-run`、`understand`、`approve-spec`、`draft-2a`、`logo-edit`、`face-edit`、`detail-edit`、`refine-pass`、`write-gate` 等，用于分步排错或接 Workbench。

### 脸部精修 `face-edit`（对 `draft_2a.png` 二次编辑）

在**已有 2A 出图**（或精修图）上，用 manifest 中的 **face** 参考（可多张）做整图脸部优化。默认另附：① `look_ref` 作光影/色温/情绪主参考；② `pose_ref`（与 `look_ref` 同一路径时不会重复发图）。需同 `run_id` 下已有 `input_manifest.json` 与 `look_spec_approved.json`。

```bash
# 底图默认：该 run 下最新 draft_refined_*.png，否则 draft_2a.png
uv run python -m look_pipeline face-edit --run-id sample-010

# 显式指定底图
uv run python -m look_pipeline face-edit --run-id sample-010 --draft-image runs/sample-010/draft_2a.png

# 不附 pose，仅 look 光影 + face + 底图
uv run python -m look_pipeline face-edit --run-id sample-010 --no-pose-ref

# 不附 look_ref 作独立光影图（只按底图+face 修，少用）
uv run python -m look_pipeline face-edit --run-id sample-010 --no-look-lighting
```

输出：`runs/<run_id>/look_face_patch.png`。打光/色调以 `look_ref` 与底图为准；若偏色，可缩小 face 与现场光差异，或临时 `--no-look-lighting` / `--no-pose-ref` 对比。

### 细节增强 `detail-edit`（2A 底图 + 细节参考）

适用于 2A 整体可用但某结构（如双层罗纹领口）需加强的场景。会读 `look_spec_approved.json`、底图（默认 `draft_2a.png` 或最新 `draft_refined_*.png`），及你提供的 1–N 张细节图。

```bash
uv run python -m look_pipeline detail-edit \
  --run-id xxx \
  --draft-image runs/xxx/draft_2a.png \
  --ref tests/xxx/detail1.png \
  --note "领口参考我提供的领口细节图片，必须是双层罗纹圆领，不是普通圆领"
```

多张参考图可多次 `--ref`：

```bash
uv run python -m look_pipeline detail-edit \
  --run-id xxx \
  --ref tests/xxx/detail1.png \
  --ref tests/xxx/detail2.png \
  --note "袖口与领口同时增强，保持现有版型和人物姿态不变"
```

输出：`runs/<run_id>/look_detail_patch.png`。
