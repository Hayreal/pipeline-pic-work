"""
Streamlit 控制台：look-pipeline CLI 的图形化入口。

启动: uv run look-pipeline-ui
      或 uv run streamlit run look_pipeline/streamlit_app.py
默认: http://127.0.0.1:8501/  （见仓库根 .streamlit/config.toml）
"""
from __future__ import annotations
import base64
import os
import textwrap
from pathlib import Path
from typing import Any

import dotenv
import streamlit as st

from look_pipeline.fixture_from_paths import (
    STAGING_RELP,
    build_fixture,
    check_paths_exist,
    write_fixture_json,
)
from look_pipeline.pipeline_invoker import run_cli_argv
from look_pipeline.staging_upload import write_staging_from_uploads
from look_pipeline.repo_root import default_repo_root
from look_pipeline.ui_paths import list_job_fixtures, list_run_ids, workspace_root

try:
    from dotenv import get_key, set_key, unset_key
except ImportError:  # pragma: no cover
    get_key = set_key = unset_key = None  # type: ignore[assignment, misc]

# 侧栏**仅**展示这 4 个（其余从 .env / 系统环境读取，不在这里改）
MANAGED_ENV_KEYS: tuple[str, ...] = (
    "GEMINI_API_KEY",
    "GEMINI_BASE_URL",
    "GEN_IMAGE_SIZE",
    "GEN_IMAGE_ASPECT_RATIO",
)
_ENV_ALIASES: dict[str, str] = {
    "GEMINI_API_KEY": "API Key",
    "GEMINI_BASE_URL": "Base URL",
    "GEN_IMAGE_SIZE": "出图尺寸（如 4K、2K、1K）",
    "GEN_IMAGE_ASPECT_RATIO": "画幅比（如 2:3、3:4）",
}

_ENV_PREFIX = "lui_env__"
# 点「重载」后下一帧、在侧栏 text_input 创建前灌入 .env，避免与 widget 绑定的 key 冲突
_REQ_RELOAD = "lui_request_env_reload"


def _ekey(name: str) -> str:
    return f"{_ENV_PREFIX}{name}"


def _load_all_dotenv() -> None:
    dotenv.load_dotenv(override=True)
    p = (default_repo_root() / ".env").resolve()
    if p.is_file():
        dotenv.load_dotenv(p, override=True)


def _init_env_session() -> None:
    _load_all_dotenv()
    for k in MANAGED_ENV_KEYS:
        e = _ekey(k)
        if e not in st.session_state:
            st.session_state[e] = os.environ.get(k, "")


def _apply_env_to_os() -> None:
    for k in MANAGED_ENV_KEYS:
        e = _ekey(k)
        v = (st.session_state.get(e) or "").strip() if e in st.session_state else ""
        if v:
            os.environ[k] = v
        else:
            os.environ.pop(k, None)


def _env_path() -> Path:
    return workspace_root() / ".env"


def _write_env_merged() -> str | None:
    if get_key is None or set_key is None:
        return "python-dotenv 缺少 get_key/set_key"
    p = _env_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    if not p.exists():
        p.write_text("# look-pipeline (Streamlit)\n", encoding="utf-8")
    for k in MANAGED_ENV_KEYS:
        e = _ekey(k)
        raw = ((st.session_state.get(e) or "") if e in st.session_state else "").strip()
        if not raw:
            try:
                if unset_key:
                    unset_key(str(p), k)  # type: ignore[operator]
            except Exception:  # noqa: S110
                if get_key(str(p), k) is not None:  # type: ignore[operator]
                    set_key(str(p), k, "")  # type: ignore[operator]
        else:
            set_key(str(p), k, raw)  # type: ignore[operator]
    return None


def sh_quote(s: str) -> str:
    if not s:
        return "''"
    if not any(c in s for c in " \t\n\"'`$&|;<>()") and s != "":
        return s
    return "'" + s.replace("'", "'\"'\"'") + "'"


def format_cmd(args: list[str]) -> str:
    return "uv run look-pipeline " + " ".join(sh_quote(a) for a in args)


def build_run_cmd(
    picked: list[str],
    extra_lines: str,
    glob_pat: str,
    through: str,
    spec_ver: int,
    print_stages: bool,
    cont_err: bool,
    extra_prompt: str,
) -> list[str]:
    args: list[str] = ["run"]
    for f in picked:
        args += ["--fixture", f]
    for line in (extra_lines or "").splitlines():
        t = line.strip()
        if t:
            args += ["--fixture", t]
    g = (glob_pat or "").strip()
    if g:
        args += ["--fixture-glob", g]
    if through and through != "draft":
        args += ["--through", through]
    if int(spec_ver) != 0:
        args += ["--version", str(int(spec_ver))]
    if print_stages:
        args.append("--print-stages")
    if cont_err:
        args.append("--continue-on-error")
    p = (extra_prompt or "").strip()
    if p:
        args += ["--extra-prompt", p]
    return args


# ----- 布局与样式 -----
st.set_page_config(
    page_title="Look小工具",
    page_icon="🖼",
    layout="wide",
    initial_sidebar_state="expanded",
)
st.markdown(
    """
    <style>
    /* 主区上边距 */
    .block-container { padding-top: 1.25rem; max-width: 64rem; }
    /* 侧栏紧凑 */
    section[data-testid="stSidebar"] {
        min-width: 19rem;
    }
    h1#look-h1 { margin-bottom: 0.1rem; font-size: 1.65rem; font-weight: 700; }
    p.sub-hero { color: #5c6773; font-size: 0.95rem; margin: 0 0 0.5rem; }
    div.stTabs [data-baseweb="tab-list"] { gap: 8px; }
    /* 选图区：压缩上传区与预览之间的空白 */
    section[data-testid="stFileUploader"] { margin-bottom: 0.35rem !important; }
    /* 选图预览：固定高度容器，图在盒内居中等比，避免换图时整页跳变 */
    .lui-preview-slot {
        height: 240px;
        width: 100%;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f3f4f6;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        overflow: hidden;
        margin: 0 0 0.25rem 0;
    }
    .lui-preview-slot img {
        max-width: 100% !important;
        max-height: 100% !important;
        width: auto !important;
        height: auto !important;
        object-fit: contain !important;
        display: block;
    }
    .lui-preview-slot--grid {
        height: 180px;
    }
    </style>
    """,
    unsafe_allow_html=True,
)

if st.session_state.pop(_REQ_RELOAD, False):
    _load_all_dotenv()
    for kc in MANAGED_ENV_KEYS:
        st.session_state[_ekey(kc)] = os.environ.get(kc, "")

_init_env_session()
_apply_env_to_os()

st.sidebar.markdown("### 环境")
for k in MANAGED_ENV_KEYS:
    lab = f"`{k}` — {_ENV_ALIASES.get(k, '')}"
    extra_help = f"与 `.env` 中 {k} 相同；同步写入进程环境。"
    if k == "GEMINI_BASE_URL":
        st.sidebar.text_input(
            lab,
            key=_ekey(k),
            help=extra_help,
            placeholder="可空，用官方/兼容网关时填写",
        )
    elif "API" in k:
        st.sidebar.text_input(
            lab, key=_ekey(k), type="password", help=extra_help, placeholder="必填写则填"
        )
    else:
        st.sidebar.text_input(
            lab,
            key=_ekey(k),
            help=extra_help,
            placeholder="例: 4K" if "SIZE" in k else "例: 2:3",
        )

st.sidebar.caption("当前工作区根")
st.sidebar.code(str(workspace_root()), language="text")
st.sidebar.caption("在仓库根用 `LOOK_WORKSPACE_ROOT` 或于此前 `cd` 到项目。其它模型名等只读 .env 即可。")
_apply_env_to_os()

b1, b2 = st.sidebar.columns(2)
if b1.button("写 .env", use_container_width=True, help="合并这 4 个键到仓库 .env"):
    err = _write_env_merged()
    (st.sidebar.error if err else st.sidebar.success)(err or f"已保存 { _env_path() }")
if b2.button("重载", use_container_width=True, help="从 .env 再读入"):
    st.session_state[_REQ_RELOAD] = True
    st.rerun()

# ----- 主区：标题 + 说明 -----
st.markdown(
    """
<h1 id="look-h1">Look 小工具</h1>
<p class="sub-hero">在页面填路径/提示词或复用 <code>jobs</code> 下 fixture 执行管线；大任务会阻塞到模型完成。</p>
    """,
    unsafe_allow_html=True,
)

# ----- 标签页 -----
t_path, t_run, t_sub = st.tabs(
    ["# 初稿", "# 重绘", "# 分步"]
)

# st.caption("默认 **http://127.0.0.1:8501** 或 **http://localhost:8501**（见 `.streamlit/config.toml`）。")

_OUT_IMAGE_EXTS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".bmp",
    ".heic",
    ".avif",
    ".tiff",
    ".tif",
}


def _path_in_workspace(p: Path, root: Path) -> bool:
    p = p.resolve()
    r = root.resolve()
    if not p.is_file():
        return False
    if p == r or r in p.parents:
        return True
    return False


def _resolve_output_image_path(s: str, root: Path) -> Path | None:
    t = s.strip()
    if not t:
        return None
    p = Path(t).expanduser()
    # 尝试绝对路径
    if p.is_absolute():
        cand = p.resolve()
        if cand.is_file():
            return cand
    # 尝试相对路径（相对工作区根）
    cand = (root / t.lstrip("/")).resolve()
    if cand.is_file():
        return cand
    # 尝试相对 runs 目录
    if not t.startswith("runs/"):
        cand = (root / "runs" / t).resolve()
        if cand.is_file():
            return cand
    return None


def _candidates_from_run_line(line: str) -> list[str]:
    line = line.strip()
    if not line or "failed:" in line or " fixture failed" in line:
        return []
    if "\t" in line and line.count("\t") >= 1:
        # print_stages: "draft<TAB>/abs/path" 或 "logo<TAB>/abs/path"
        _, rest = line.split("\t", 1)
        return [rest] if rest.strip() else []
    if line.startswith("{") and line.rstrip().endswith("}"):
        return []
    return [line]


def _collect_image_paths_in_run_text(text: str, root: Path) -> list[Path]:
    out: list[Path] = []
    seen: set[Path] = set()
    for line in (text or "").splitlines():
        for raw in _candidates_from_run_line(line):
            p = _resolve_output_image_path(raw, root)
            if p is None:
                # 调试：记录无法解析的路径
                continue
            rp = p.resolve()
            if rp.suffix.lower() not in _OUT_IMAGE_EXTS or not rp.is_file():
                continue
            if rp in seen:
                continue
            seen.add(rp)
            out.append(rp)
    return out


def _preview_output_images(res: dict[str, Any], *, title: str = "图片预览") -> None:
    root = workspace_root()
    t = f"{(res.get('stdout') or '')}\n{(res.get('stderr') or '')}"
    paths = _collect_image_paths_in_run_text(t, root)
    if not paths:
        return
    st.subheader(title)
    rels: list[str] = []
    for pth in paths:
        try:
            rels.append(f"`{pth.resolve().relative_to(root.resolve()).as_posix()}`")
        except ValueError:
            rels.append(f"`{pth}`")
    st.caption(" · ".join(rels))
    ncols = min(3, len(paths))
    cols = st.columns(ncols)
    for i, pth in enumerate(paths[:9]):
        with cols[i % ncols]:
            st.caption(f"`{pth.name}`")
            try:
                if not pth.exists():
                    st.warning(f"文件不存在: {pth}")
                    continue
                # 使用 PIL 加载图片，更可靠
                from PIL import Image
                img = Image.open(pth)
                # 如果图片太大，缩小显示
                max_display_size = 800
                if max(img.size) > max_display_size:
                    ratio = max_display_size / max(img.size)
                    new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
                    img = img.resize(new_size, Image.Resampling.LANCZOS)
                st.image(img, use_container_width=True)
            except Exception as e:
                st.error(f"预览失败: {e}")
                st.caption(f"路径: {pth}")


def _out_block(res: dict[str, Any]) -> None:
    _preview_output_images(res)
    st.json(res, expanded=False)
    t = f"{(res.get('stdout') or '').rstrip()}\n{(res.get('stderr') or '')}".strip()
    st.code(t or "（无输出）", language="text", line_numbers=True)


# ----- Tab: 选图 / 路径 -----
_IMG_MIME = ["png", "jpg", "jpeg", "webp", "gif", "heic", "avif", "bmp"]


def _fp(uf) -> tuple[bytes, str] | None:  # noqa: ANN001
    if uf is None:
        return None
    return (uf.getvalue(), uf.name)  # type: ignore[union-attr]


def _fplist(uf) -> list[tuple[bytes, str]]:  # noqa: ANN001
    if not uf:
        return []
    if isinstance(uf, list):
        return [(f.getvalue(), f.name) for f in uf]  # type: ignore[union-attr]
    return [_fp(uf)]  # type: ignore[list-item]


# 选图区预览：限制最长边，避免小图经浏览器拉宽发糊；过大则拖慢页面
_PREVIEW_SINGLE_MAX_LONG_EDGE = 1280
_PREVIEW_LIST_THUMB = 320


def _markdown_image_in_slot(png_bytes: bytes, *, slot_class: str) -> None:
    b64 = base64.b64encode(png_bytes).decode("ascii")
    st.markdown(
        f'<div class="{slot_class}"><img src="data:image/png;base64,{b64}" alt="预览" /></div>',
        unsafe_allow_html=True,
    )


def _show_upload_thumbnail(uploaded_file, label: str = "") -> None:
    """显示单张上传预览：仅缩小过长边；固定高度容器内等比居中。"""
    if uploaded_file is None:
        return
    try:
        import io
        from PIL import Image
        img_bytes = uploaded_file.getvalue()
        img = Image.open(io.BytesIO(img_bytes))
        w, h = img.size
        m = max(w, h)
        cap = _PREVIEW_SINGLE_MAX_LONG_EDGE
        if m > cap:
            s = cap / m
            img = img.resize(
                (max(1, int(w * s)), max(1, int(h * s))), Image.Resampling.LANCZOS
            )
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        if label:
            st.caption(label)
        _markdown_image_in_slot(
            buf.getvalue(), slot_class="lui-preview-slot"
        )
        uploaded_file.seek(0)
    except Exception as e:
        st.caption(f"预览失败: {e}")


def _show_upload_list_thumbnails(uploaded_files: list, label: str = "") -> None:
    """多图横向；每格固定高度，图在格内等比。"""
    if not uploaded_files:
        return
    try:
        import io
        from PIL import Image
        if label:
            st.caption(label)
        n = min(len(uploaded_files), 4)
        cols = st.columns(n)
        tbox = (_PREVIEW_LIST_THUMB, _PREVIEW_LIST_THUMB)
        for i, uf in enumerate(uploaded_files[:4]):
            with cols[i % n]:
                try:
                    img_bytes = uf.getvalue()
                    img = Image.open(io.BytesIO(img_bytes))
                    img.thumbnail(tbox, Image.Resampling.LANCZOS)
                    buf = io.BytesIO()
                    img.save(buf, format="PNG")
                    _markdown_image_in_slot(
                        buf.getvalue(),
                        slot_class="lui-preview-slot lui-preview-slot--grid",
                    )
                    uf.seek(0)
                except Exception:
                    st.caption(f"#{i+1}")
        if len(uploaded_files) > 4:
            st.caption(f"... 共 {len(uploaded_files)} 张")
    except Exception as e:
        st.caption(f"预览失败: {e}")


with t_path:
    # st.caption("默认在下方**从本机选图**；图会保存到本仓库的「摄入」目录并生成配置。若图已在项目里，可改用**手填路径**。")
    p_mode = st.radio(
        "图片来源",
        options=["file", "path"],
        index=0,
        key="p_mode",
        format_func=lambda x: "从本机选图" if x == "file" else "手填相对路径（高级）",
        horizontal=True,
    )
    ing_rid = st.text_input(
        "运行编号",
        value="",
        key="p_rid",
        help="可留空则自动生成。支持中文与常见符号；` / \\ : * ? \" < > |` 等路径非法字符会替换。对应 runs/ 下目录与 jobs/_streamlit_ingest/ 落盘。",
    )

    f_look, f_pose, f_sku, f_fab, f_face, f_logo = (None,) * 6
    st.text_area(
        "补充提示词",
        value="",
        key="p_pe",
        height=100,
        help=(
            "会写入 `prompt_extra`：参与 understand 的 JSON 生成；2A 时整段作为**与参考图同条 user 里的首段文字**（不重复塞进 system），"
            "与 `POSE_BLOCK` 同级；另含软性的裁切/氛围说明在 system 内。"
        ),
    )
    st.caption(
        "写姿态/机位/半身等时，2A 以当前 LOOK 的影调/氛围 为锚、不硬抄其全身；另有「软」的防误裁说明。若你要紧裁/裁脸/特殊构图，在补充里写清即可覆盖默认提示。"
    )
    if p_mode == "file":
        # st.caption("三行两列：LOOK 与姿态、SKU 与细节、模特与 LOGO。每格为上传 + 预览。")
        r1a, r1b = st.columns(2, gap="medium")
        with r1a:
            with st.container(border=True):
                f_look = st.file_uploader(
                    "LOOK（必填）",
                    type=_IMG_MIME,
                    key="u_look",
                    help="主参考：气质、光影、机位与画面；对应 look_ref。",
                )
                _show_upload_thumbnail(f_look, "LOOK 预览")
        with r1b:
            with st.container(border=True):
                f_pose = st.file_uploader(
                    "姿态（可选）",
                    type=_IMG_MIME,
                    key="u_pose",
                    help="pose_ref 路径。默认只参与 understand 里 pose 段；下框勾选后 2A 生图也会引用该图。",
                )
                _show_upload_thumbnail(f_pose, "姿态预览")
                st.checkbox(
                    "姿态图作为成图参考",
                    value=False,
                    key="p_pose_in_2a",
                    help="关：仅 作为提示词`pose`文案。开：2A 与 LOOK/侧视/SKU/脸等一起作为参考图。",
                )
        r2a, r2b = st.columns(2, gap="medium")
        with r2a:
            with st.container(border=True):
                f_sku = st.file_uploader(
                    "SKU（必填）",
                    type=_IMG_MIME,
                    accept_multiple_files=True,
                    key="u_sku",
                    help="平铺/多角度，至少一张；对应 sku_flat。",
                )
                _show_upload_list_thumbnails(
                    f_sku if isinstance(f_sku, list) else ([f_sku] if f_sku else []),
                    "SKU 预览",
                )
        with r2b:
            with st.container(border=True):
                f_fab = st.file_uploader(
                    "SKU 细节（必填）",
                    type=_IMG_MIME,
                    key="u_fab",
                    help="细节特写；对应 fabric_detail。",
                )
                _show_upload_thumbnail(f_fab, "细节预览")
        r3a, r3b = st.columns(2, gap="medium")
        with r3a:
            with st.container(border=True):
                f_face = st.file_uploader(
                    "模特脸部（可选）",
                    type=_IMG_MIME,
                    key="u_face",
                    help="不选则走静物/无脸；对应 face。",
                )
                _show_upload_thumbnail(f_face, "脸部预览")
        with r3b:
            with st.container(border=True):
                f_logo = st.file_uploader(
                    "LOGO（可选）",
                    type=_IMG_MIME,
                    key="u_logo",
                    help="全链路 + Logo 时用于修图；不选则不做 Logo 专步。",
                )
                _show_upload_thumbnail(f_logo, "LOGO 预览")
    else:
        with st.expander("手填：图片在项目内的相对路径（相对当前工作区根）", expanded=True):
            pr1a, pr1b = st.columns(2)
            with pr1a:
                st.text_input(
                    "LOOK *",
                    key="p_look",
                    placeholder="如 tests/…/look.jpg",
                    help="look_ref，单张。",
                )
            with pr1b:
                st.text_input(
                    "姿态（选填）",
                    key="p_pose",
                    help="可空。pose_ref 相对路径。下方可勾选是否作为 2A 成图参考。",
                )
                st.checkbox(
                    "姿态图作为 2A 成图参考",
                    value=False,
                    key="p_pose_in_2a",
                    help="关：仅 spec 中 pose 文案。开：2A 生图时传入 pose 图。",
                )
            pr2a, pr2b = st.columns(2)
            with pr2a:
                st.text_area(
                    "SKU *",
                    key="p_sku",
                    height=100,
                    help="一行一个路径=多张。sku_flat。",
                    placeholder="每行一条，相对工作区根",
                )
            with pr2b:
                st.text_input("SKU 细节 *", key="p_fab", help="同 fabric_detail，单路径。")
            pr3a, pr3b = st.columns(2)
            with pr3a:
                st.text_input("模特脸部（选填）", key="p_face", help="可空，同 face。")
            with pr3b:
                st.text_input("LOGO（选填）", key="p_logo", help="可空，同 logo_ref / logo。")


    # st.caption("若开「全链路 + Logo」且已上传/填写 Logo，会在主图后增加 Logo 对位修图。")
    row4 = st.columns(4)
    with row4[0]:
        p_through = st.selectbox(
            "出图停在哪一步",
            options=["draft", "full"],
            key="p_through",
            index=0,
            help="仅主图=草图到 2A；全链路=在 2A 后如有 Logo 再修 Logo。",
            format_func=lambda x: "初稿" if x == "draft" else "初稿 + Logo修复",
        )
    with row4[1]:
        p_ver = st.number_input(
            "初稿版本号", min_value=0, value=0, key="p_ver", help="对应 look_spec 的版本，一般 0 即可"
        )
    with row4[2]:
        p_pst = st.checkbox(
            "在日志里输出各阶段文件路径",
            value=False,
            key="p_pst",
            help="等效 --print-stages。",
        )
    with row4[3]:
        p_coe = st.checkbox(
            "多项批量时，单个失败也继续",
            value=False,
            key="p_coe",
            help="等效 --continue-on-error。",
        )
    chk = st.checkbox(
        "手填路径时，检查文件是否已存在",
        value=True,
        key="p_chkfs",
        help="仅对「手填相对路径」模式；从本机选图时会自动落盘。",
    )

    st.divider()
    a1, a2 = st.columns(2)
    with a1:
        b_preview = st.button("保存配置", use_container_width=True, key="p_bprev")
    with a2:
        b_run = st.button("保存并运行", type="primary", use_container_width=True, key="p_brun")

    if b_preview or b_run:
        repo = workspace_root()
        d: dict[str, Any] | None = None
        err: str | None = None
        relp: str | None = None
        if p_mode == "file":
            d, err, jpath2 = write_staging_from_uploads(
                repo,
                (ing_rid or "").strip(),
                _fp(f_look),
                _fp(f_pose),
                bool(st.session_state.get("p_pose_in_2a", False)),
                _fplist(f_sku),
                _fp(f_fab),
                _fp(f_face),
                _fp(f_logo),
                str(st.session_state.get("p_pe", "") or ""),
            )
            if err:
                st.error(err)
            elif d is not None and jpath2 is not None:
                relp = jpath2.resolve().relative_to(repo.resolve()).as_posix()
                st.subheader("生成完成")
                st.json(d, expanded=False)
                st.success(f"存放路径：`{jpath2.parent}/`  `{jpath2.name}`。")
        else:
            d, err = build_fixture(
                (ing_rid or "").strip(),
                str(st.session_state.get("p_look", "") or ""),
                str(st.session_state.get("p_sku", "") or ""),
                str(st.session_state.get("p_fab", "") or ""),
                str(st.session_state.get("p_face", "") or ""),
                str(st.session_state.get("p_logo", "") or ""),
                str(st.session_state.get("p_pe", "") or ""),
                str(st.session_state.get("p_pose", "") or ""),
                bool(st.session_state.get("p_pose_in_2a", False)),
            )
            if err:
                st.error(err)
            elif d is not None:
                if chk:
                    for m in check_paths_exist(repo, d):
                        st.warning(m)
                if b_preview or b_run:
                    with st.spinner("写 JSON…"):
                        try:
                            jpx = write_fixture_json(repo, d)
                        except (OSError, ValueError) as e:
                            st.exception(e)
                        else:
                            relp = jpx.resolve().relative_to(repo.resolve()).as_posix()
                            st.success(f"已写 `{jpx.name}` 于 `{jpx.parent}`")
                            st.json(d, expanded=False)
        if b_run and relp is not None:
            a_img = build_run_cmd(
                [relp], "", "", p_through, int(p_ver), p_pst, p_coe, ""
            )
            _apply_env_to_os()
            st.code(format_cmd(a_img), language="bash")
            with st.spinner("运行中…"):
                _out_block(run_cli_argv(a_img))

# ----- Tab: 主流程 -----
with t_run:
    fixtures = list_job_fixtures()
    c_a, c_b = st.columns([1, 1])
    with c_a:
        picked = st.multiselect("jobs 下 .json 列表", fixtures, key="m_fixtures", default=[])
    with c_b:
        fglob = st.text_input("或批量匹配（glob）", value="", key="t_glob", help="例：jobs/袜子/**/*.json")
    extra = st.text_area("再附加若干配置路径（每行一条）", height=64, key="t_extra", placeholder="jobs/…/a.json")
    c1, c2 = st.columns(2)
    with c1:
        through = st.selectbox(
            "出图停在哪一步",
            options=["draft", "full"],
            index=0,
            key="w_through",
            format_func=lambda x: "初稿" if x == "draft" else "初稿 + Logo修复",
        )
    with c2:
        ver = st.number_input("理解稿版本号", min_value=0, value=0, key="n_ver", help="一般填 0")
    c3, c4, c5 = st.columns(3)
    with c3:
        print_st = st.checkbox("在日志里输出各阶段路径", value=False, key="c_pst")
    with c4:
        cont_e = st.checkbox("批量时遇错继续", value=False, key="c_coe")
    with c5:
        pass
    xprompt = st.text_area("附加上一句提示（可选，叠加到命令行）", value="", height=80, key="t_xp", help="对应 CLI 的 --extra-prompt。")

    a_run = build_run_cmd(
        picked, extra, fglob, through, int(ver), print_st, cont_e, xprompt
    )
    c1, c2 = st.columns(2)
    with c1:
        go = st.button("开始运行", type="primary", use_container_width=True, key="btn_run")
    with c2:
        st.code(format_cmd(a_run), language="bash")
    if go:
        if len(picked) == 0 and not any(
            x.strip() for x in (extra or "").splitlines()
        ) and not (fglob or "").strip():
            st.error("选列表、填附加路径或填 glob 至少其一。")
        else:
            _apply_env_to_os()
            with st.spinner("运行中…"):
                _out_block(run_cli_argv(a_run))

# ----- Tab: 分步 -----
with t_sub:
    st.caption("已有 run: " + (", ".join(list_run_ids()[:32]) or "无"))
    x1, x2 = st.columns(2)
    with x1:
        sub = st.selectbox(
            "子命令",
            [
                "init-run",
                "understand",
                "approve-spec",
                "draft-2a",
                "refine-pass",
                "logo-edit",
                "face-edit",
                "detail-edit",
                "write-gate",
            ],
            key="o_sub",
        )
    with x2:
        run_id = st.text_input("run-id", value="", key="i_rid")

    args2: list[str] = []
    st.divider()

    if sub == "init-run":
        fp = st.text_input("--fixture", value="", key="i_fp")
        ep = st.text_area("提示词 (extra-prompt，可选）", value="", key="i_ep", height=68)
        if (fp or "").strip():
            args2 = ["init-run", "--fixture", fp.strip()]
            if (ep or "").strip():
                args2 += ["--extra-prompt", ep.strip()]

    elif (run_id or "").strip():
        rid = run_id.strip()
        if sub == "understand":
            uver = st.number_input(
                "--version", min_value=0, value=0, step=1, key="i_uver"
            )
            args2 = ["understand", "--run-id", rid, "--version", str(int(uver))]
        elif sub == "approve-spec":
            srcv = st.text_input("--src", "look_spec_v0.json", key="i_asrc")
            args2 = [
                "approve-spec",
                "--run-id",
                rid,
                "--src",
                srcv or "look_spec_v0.json",
            ]
        elif sub == "draft-2a":
            args2 = ["draft-2a", "--run-id", rid]
        elif sub == "refine-pass":
            ix = st.number_input(
                "--index", min_value=0, value=0, step=1, key="i_rix"
            )
            args2 = ["refine-pass", "--run-id", rid, "--index", str(int(ix))]
        elif sub == "logo-edit":
            di = st.text_input("--draft-image（可空）", value="", key="i_ldi")
            args2 = ["logo-edit", "--run-id", rid]
            if (di or "").strip():
                args2 += ["--draft-image", di.strip()]
        elif sub == "face-edit":
            d2 = st.text_input("--draft-image", value="", key="i_fdi")
            nll = st.checkbox("--no-look-lighting", key="i_fnll")
            args2 = ["face-edit", "--run-id", rid]
            if (d2 or "").strip():
                args2 += ["--draft-image", d2.strip()]
            if nll:
                args2.append("--no-look-lighting")
        elif sub == "detail-edit":
            d3 = st.text_input("--draft-image", value="", key="i_ddi")
            rlines = st.text_area(
                "--ref（多行，每行一路径）", value="", key="i_dref", height=80
            )
            note = st.text_area("--note（必填）", value="", key="i_dnote", height=68)
            _refs = [r.strip() for r in (rlines or "").splitlines() if r.strip()]
            _n = (note or "").strip()
            if _n and _refs:
                args2 = ["detail-edit", "--run-id", rid]
                if (d3 or "").strip():
                    args2 += ["--draft-image", d3.strip()]
                for r in _refs:
                    args2 += ["--ref", r]
                args2 += ["--note", _n]
        elif sub == "write-gate":
            kind = st.selectbox(
                "--kind", ["draft", "final", "refine"], key="i_wgk"
            )
            args2 = ["write-gate", "--run-id", rid, "--kind", kind]
            if kind == "refine":
                rix2 = st.number_input(
                    "--refine-index", min_value=0, value=0, key="i_wgri"
                )
                args2 += ["--refine-index", str(int(rix2))]

    else:
        st.info("非 init-run 时请输入 run-id。")

    st.code(format_cmd(args2) if args2 else "（未组参数）", language="bash")
    v_run = st.button("执行子命令", type="primary", disabled=not bool(args2), key="go_sub")
    if v_run and args2:
        if sub == "write-gate" and not (run_id or "").strip():
            st.error("需要 run-id")
        elif sub == "detail-edit" and (
            not (st.session_state.get("i_dref", "") or "").splitlines()
            or not (st.session_state.get("i_dnote", "") or "").strip()
        ):
            st.error("detail-edit 需非空 --note 且至少一行 --ref。")
        else:
            _apply_env_to_os()
            with st.spinner("执行中…"):
                _out_block(run_cli_argv(args2))
