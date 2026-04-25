# Electron 商品 Look 工作台 — 设计说明

**日期**：2026-04-21  
**状态**：已定稿待实现评审  
**前提**：与现有 `look_pipeline`（Python、`runs/` 血缘、Gemini 多模态）衔接；**全部在用户本机执行**（Electron + 本机 localhost 后端 + 本机 Python，经用户配置的 `GEMINI_*` 访问模型，不强制自建云端业务服务）。

---

## 1. 目标与范围

### 1.1 目标

交付 **Mac / Windows** 可安装的 **Electron** 应用，支撑：

1. **参考图**（Look、SKU 平铺、面料细节、脸、姿态、可选 Logo）→ **规范 JSON** → **初稿出图**（**支持批量仅到初稿**）。  
2. **全流程**：参考图 → JSON → 初稿 → **初稿审批** → **精细化编辑**（脸部 / Logo / 细节，**人工矩形框选区域**）→ **精修审批**（可多轮）→ **终稿** →（可选）**终稿审批**。  
3. 与 CLI 行为对齐：同一套 `runs/<run_id>/` 语义，便于脚本与桌面互操作。

### 1.2 首版 YAGNI（明确不做）

- 框选仅 **轴对齐矩形**，单区域序列化；**不做**多边形 / 钢笔 / 多选布尔运算。  
- 批量初稿 **串行**；**不做**并行度配置以外的复杂调度（遇错即停等列二期）。  
- **不做**自动美学打分；**不做**云端账号体系与本机以外的同步。

### 1.3 历史保留策略（已定）

- **初稿** `draft_2a.png` **生成后不覆盖**，作为只读基准。  
- 精修第 *k* 轮：写入 **`regions_k.json`** 与 **`draft_refined_k.png`**（*k* 从 1 递增）；闸门 **`gate_refine_k_approved.json`**。  
- 终稿默认 **`look_final_4k.png`**；若需多次终稿尝试，可采用带版本后缀或时间戳的新文件，**不覆盖**上一份终稿（实现时二选一写死一种并在 UI 标明）。

---

## 2. 整体架构

### 2.1 进程划分

| 部分 | 职责 |
|------|------|
| **Renderer** | 参考图配置、任务列表、JSON 查看/编辑、初稿画廊、**画布框选**、审批按钮、终稿对比。仅访问 **本机 localhost API**。 |
| **Electron Main** | 窗口与菜单、系统文件对话框、**启动/停止** localhost 后端子进程、向子进程 **注入环境变量**（`.env` 路径可配置）。 |
| **Local backend（Node，127.0.0.1）** | 任务与 `run_id` CRUD、**状态机**、批量队列、调用 **Python/`look_pipeline`**（子进程）、读写 `runs/`、`run_state.json`、接收 **框选 JSON** 并触发扩展后的编辑步骤。 |
| **Python（`look_pipeline`）** | 理解、2a、2b、整图编辑；**扩展**：按 `regions_k.json` 组装 **图+文** 局部编辑请求（实现阶段定 CLI 面）。 |

### 2.2 为何不是「纯渲染进程」

生成与密钥管理依赖 **Main / 本机子进程**；现有流水线为 **Python**，首版 **不重写** 为纯前端直连模型，以避免密钥进 bundle 与重复实现。

### 2.3 推荐形态（已定）

**Electron + 本机轻量 HTTP（localhost）+ Python 子进程**（头脑风暴方案 2）：便于队列、进度、错误集中处理；渲染层统一 `fetch`。

---

## 3. 数据流与产物

### 3.1 单条全流程（目录 `runs/<run_id>/`）

| 顺序 | 产物 / 动作 |
|------|-------------|
| UI 确认参考图 | `fixture_snapshot.json` |
| init 等价 | `input_manifest.json` |
| understand | `look_spec_v{n}.json`、`understand_v{n}_raw.txt` |
| 人工改 spec（可选） | 更新 `look_spec_v{n}.json` |
| approve-spec | `look_spec_approved.json` |
| draft-2a | `draft_2a.png`、`brief_2a.txt` |
| 初稿审批 | `gate_draft_approved.json` |
| 精修第 k 轮 | `regions_k.json` → 编辑 API → **`draft_refined_k.png`**（新文件） |
| 精修审批 | `gate_refine_k_approved.json` |
| final-2b | `look_final_4k.png`（或版本化文件名）、`brief_2b.txt` |
| 终稿审批（可选） | `gate_final_approved.json` |

### 3.2 `regions_k.json`（概念 schema）

- 顶层：`image_ref`（相对 run 目录的文件名，如 `draft_2a.png` 或 `draft_refined_{k-1}.png`）、`regions` 数组。  
- 每项：`kind` ∈ `face` | `logo` | `detail`、`rect_norm`：`{ x, y, w, h }` 均为 **0–1** 浮点，相对 **当前画布上该参考图像素宽高**。  
- 可选：`note` 字符串，供 prompt 拼接。

### 3.3 批量「仅到初稿」

- 任务表多行；每行独立 `run_id` 或子目录策略由实现定，**必须**能单独重试失败项。  
- 状态到达 **`DRAFT_READY`** 后标记 **`BATCH_DRAFT_DONE`**，**不自动**进入初稿审批之后阶段；用户可在 UI 将某条 **升级为全流程**。

---

## 4. 状态机（后端权威）

后端持久化 **`run_state.json`**（或等价），字段含 `state`、版本、最后错误摘要。

主流程状态（简化）：

`COLLECTING` → `READY` → `MANIFEST_OK` → `SPEC_READY` → `SPEC_APPROVED` → `DRAFT_READY` → **`DRAFT_APPROVED`** → **`REFINE_LOOP`**（`EDITING` ↔ `REFINE_PENDING_APPROVAL`，可多轮）→ **`FINAL_QUEUED`** → `FINAL_READY` → `FINAL_APPROVED` → `DONE`

非法跳转（例如未 `DRAFT_APPROVED` 调用 `final-2b`）**拒绝**并返回明确错误码。

---

## 5. 安全与隐私

- **API Key**：仅通过 Main/子进程环境注入；**禁止**写入前端静态资源；日志脱敏。  
- **网络**：Renderer **仅** `127.0.0.1`；后端调 Python；生产配置下 **禁止** Renderer 直连公网模型（调试模式可单独开关并醒目标注）。  
- **数据归属**：工作区默认用户选定路径；卸载应用 **不默认删除** `runs/`。

---

## 6. 错误处理

| 类型 | 行为 |
|------|------|
| Python 非零退出 | `run_error.json` + 状态 `FAILED`；UI 支持重试本步 |
| API 429/5xx | 复用现有退避策略；仍失败则 `FAILED` |
| 用户取消批量 | 完成当前项后停止；保留已完成产物 |
| 路径/磁盘 | 创建 run 前校验；失败阻断 |

---

## 7. 测试策略（实现阶段）

- **后端**：状态迁移非法路径、`regions` schema、路径规范化。  
- **集成**：临时目录 + mock 子进程或 dry-run，CI 不调真 API。  
- **Electron E2E**：二期；首版 **手测清单**（安装、选目录、单条全流程、批量初稿、框选一精修轮）。

---

## 8. 与现有仓库关系

- **新目录**：建议 `desktop/` 或 `apps/look-workbench/` 存放 Electron + Node 后端；**不**把 Python 逻辑复制进前端。  
- **`look_pipeline`**：扩展子命令或参数以消费 `regions_k.json`；JSON schema 与校验尽量 **单源** 或在文档中强制双端一致。

---

## 9. 非目标

- 云端多租户、协作实时同步。  
- 专业级非矩形抠图与复杂图层合成（首期）。

---

## 10. 后续工作

本 spec 评审通过后，使用 **writing-plans** 编写实现计划（Electron 工程初始化、localhost API、状态机、与 `look_pipeline` 的 CLI 契约、`regions` 编辑链路等）。
