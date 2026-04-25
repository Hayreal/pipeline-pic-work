# AI 出图工作台

基于 Electron + Python 管线的桌面应用，通过 Gemini API 实现从素材上传到 2A 出图的完整自动化流程。

---

## 技术架构

```
┌─────────────────────────────────────────────────┐
│                  Electron 主进程                  │
│  - 窗口管理 / IPC 通信                            │
│  - 管线环境管理 (uv + Python venv)               │
│  - 文件读写 / 目录管理                             │
│  - 子进程调度 (spawn look_pipeline)              │
├─────────────────────────────────────────────────┤
│              Preload (contextBridge)             │
│  - 安全的 IPC 接口暴露给渲染进程                   │
├─────────────────────────────────────────────────┤
│              渲染进程 (React + Vite)              │
│  - React 18 + TypeScript                         │
│  - React Router (页面路由)                        │
│  - styled-components (样式)                       │
│  - lucide-react (图标)                            │
└─────────────────────────────────────────────────┘
```

---

## 运行流程

### 用户操作流程

```
准备素材 ──→ 描述稿确认 ──→ 出图生成 ──→ 精细终稿 ──→ 交付
  │             │             │            │          │
  │ 上传素材     │ 审阅AI生成    │ 查看2A出图   │ 选择版本   │ 下载产物
  │ 分类角色     │ 编辑描述     │ 预览缩略图   │ 精修(可选)  │ 导出文件
  │ 运行管线     │ 确认通过     │             │           │
  └─────────────┴─────────────┴─────────────┴──────────┴────
```

### 管线执行流程

```
fixture.json ──→ understand ──→ approve-spec ──→ draft-2a ──→ (full: logo-edit)
     │               │               │               │               │
     │ 构建输入       │ AI理解素材    │ 确认规格       │ 生成2A图片     │ 精修Logo
     │ JSON          │ 输出规格描述   │ 写入approved   │ 输出brief      │ (可选)
     └───────────────┴───────────────┴───────────────┴───────────────┴───
```

### 管线数据产物

每次运行在 `runs/{run_id}/` 目录下生成：

| 文件 | 说明 |
|------|------|
| `input_manifest.json` | 输入清单（素材路径、角色、元数据） |
| `look_spec_v0.json` | AI 理解的原始规格 |
| `look_spec_approved.json` | 确认后的规格描述 |
| `brief_2a.txt` | 2A 生成的提示简报 |
| `draft_2a_*.png` | 2A 出图结果 |
| `understand_v0_raw.txt` | understand 原始输出 |
| `regions_{k}.json` | 区域编辑定义（精细终稿用） |
| `draft_refined_{k}.png` | 精细终稿输出 |

---

## 页面说明

### 1. 准备素材

- **上传素材**：支持 JPG/PNG/WEBP 多选上传
- **素材分类**：为每张图片指定用途角色
  - `姿势参考 (look_ref)` — 人物全身照，参考姿势与光影
  - `平铺SKU (sku_flat)` — 服装平铺图
  - `面料特写 (fabric_detail)` — 面料/纹理细节图
  - `脸部参考 (face)` — 面部特写，用于精修
  - `Logo 参考 (logo_ref)` — Logo 图案，用于对位修图
  - `不使用 (none)` — 不参与管线
- **附加提示词**：可选的用户自定义要求
- **运行管线**：触发 `python -m look_pipeline run --through draft`

### 2. 描述稿确认

- 展示 AI 自动生成的服装描述（从 `look_spec_approved.json` 加载）
- 支持在线编辑描述文本
- 关键词提取与标签展示
- 素材缩略图预览
- 确认后进入出图生成

### 3. 出图生成

- 展示 2A 生成的初版画面（最多 3 张）
- 缩略图预览（base64 渲染，避免 file:// 协议限制）
- 生成进度条
- 失败检测：无图片时显示管线日志

### 4. 精细终稿

- 从初版中选择满意的构图
- 精细选项：
  - 脸部精修（需准备素材阶段指定 face 角色）
  - 输出分辨率选择（4K/2K/HD）
- 区域精修（refine-pass）：需在 run 目录中提供 `regions_{k}.json`

### 5. 交付

- 列出本次运行的所有产物文件
- 支持单个下载或批量下载
- 显示 Run ID 和目录路径

### 设置

- Gemini API Key（必需）
- Base URL（可选，API 代理地址）
- 2A 生成模型（默认 `gemini-3.1-flash-image-preview`）
- 输出尺寸（1K/2K/4K）
- 输出比例（1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9, 21:9）
- 管线环境状态显示与手动初始化

---

## 快速开始

### 环境要求

- Node.js >= 18
- Windows 10+ 或 macOS

### 安装与运行

```bash
# 1. 安装依赖
npm install

# 2. 初始化管线工作区（首次运行，下载 Python 环境）
npm run setup-pipeline

# 3. 启动开发模式
npm run dev
```

### 生产打包

```bash
# 1. 确保管线环境已初始化
npm run setup-pipeline

# 2. 打包 Windows 安装包
npm run electron:build:win

# 3. 打包 macOS
npm run electron:build:mac
```

打包后的安装包自动包含 `pipeline/` 目录，用户首次启动时会自动完成环境初始化。

---

## 项目结构

```
pencilAPP/
├── src/
│   ├── main/index.ts          # Electron 主进程（IPC、管线调度）
│   ├── preload/index.ts       # 安全的 IPC 桥接
│   └── renderer/
│       ├── App.tsx            # 路由入口
│       ├── components/        # 共享组件
│       │   ├── Layout.tsx     # 应用壳（侧边栏+内容区）
│       │   ├── Stepper.tsx    # 步骤导航
│       │   └── shared.tsx     # Button/Toggle/Tag/Card
│       ├── context/
│       │   └── WorkflowContext.tsx  # 全局工作流状态
│       ├── hooks/
│       │   └── useConfig.ts   # 配置管理
│       ├── pages/
│       │   ├── PrepareMaterialsPage.tsx    # 准备素材 + 分类
│       │   ├── ConfirmDescriptionPage.tsx  # 描述稿确认
│       │   ├── GenerateImagesPage.tsx      # 出图生成
│       │   ├── RefinePage.tsx              # 精细终稿
│       │   ├── DeliverPage.tsx             # 交付下载
│       │   └── SettingsPage.tsx            # 设置
│       ├── styles/
│       │   ├── theme.ts       # 主题配置
│       │   └── GlobalStyle.ts # 全局样式
│       └── types/
│           └── electron.d.ts  # Electron API 类型
├── look-image-utils-feat-look-pipeline/  # Python 管线项目
│   └── look_pipeline/         # look_pipeline 包
│       ├── __main__.py        # CLI 入口
│       ├── cli.py             # 命令定义（run/understand/draft-2a/refine-pass 等）
│       ├── understand.py      # AI 理解素材步骤
│       ├── generate.py        # 2A 图片生成
│       ├── refine.py          # 精细终稿（区域编辑）
│       ├── edit.py            # Logo/face/detail 精修
│       ├── manifest.py        # 输入清单构建
│       └── run_layout.py      # Run 目录布局
├── pipeline/                  # 管线工具目录
│   └── setup-workspace.js     # 工作区初始化脚本
├── package.json
├── vite.config.ts
└── tsconfig.json
```

---

## 关键路径

| 路径 | 说明 |
|------|------|
| `%LOCALAPPDATA%\ai-image-workbench\` | 运行时根目录 |
| `.../pipeline-workspace/` | 管线工作区（复制后的 Python 项目） |
| `.../pipeline-workspace/.venv/` | Python 虚拟环境 |
| `.../pipeline-workspace/runs/` | 运行产物目录 |
| `.../user-data/` | 用户数据（配置持久化） |
| `.../session-data/` | 会话数据 |
| `.../cache/` | 缓存目录 |

---

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发模式（Vite HMR + Electron） |
| `npm run build` | 构建生产包 |
| `npm run setup-pipeline` | 初始化管线工作区 |
| `npm run electron:build:win` | 打包 Windows 安装包 |
| `npm run electron:build:mac` | 打包 macOS 安装包 |
