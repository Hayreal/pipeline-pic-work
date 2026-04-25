from __future__ import annotations

import argparse
import glob
import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import dotenv
from google import genai

from look_pipeline.draft_resolve import resolve_draft_source
from look_pipeline.edit import run_detail_edit, run_face_edit, run_logo_edit
from look_pipeline.refine import run_refine_pass
from look_pipeline.generate import run_step_2a
from look_pipeline.manifest import role_has_reference_image, write_input_manifest
from look_pipeline.repo_root import default_repo_root
from look_pipeline.run_layout import RunLayout, default_runs_dir
from look_pipeline.understand import run_understand_step


def _work_repo_root() -> Path:
    return default_repo_root().resolve()


def _require_path(path: Path, *, hint: str) -> None:
    if not path.is_file():
        print(f"Missing required file: {path}\n{hint}", file=sys.stderr)
        raise SystemExit(2)


def _client() -> genai.Client:
    dotenv.load_dotenv()
    base = os.getenv("GEMINI_BASE_URL")
    kwargs: dict = {"api_key": os.getenv("GEMINI_API_KEY")}
    if base:
        kwargs["http_options"] = {"base_url": base}
    return genai.Client(**kwargs)


def cmd_init_run(args: argparse.Namespace) -> None:
    repo = _work_repo_root()
    fixture: dict = json.loads(Path(args.fixture).read_text(encoding="utf-8"))
    ex = getattr(args, "extra_prompt", None)
    if ex and str(ex).strip():
        fixture = dict(fixture)
        raw = fixture.get("prompt_extra")
        if raw is None:
            fixture["prompt_extra"] = str(ex).strip()
        elif isinstance(raw, list):
            merged = "\n".join(str(x).strip() for x in raw if str(x).strip())
            fixture["prompt_extra"] = (merged + "\n" + str(ex).strip()) if merged else str(ex).strip()
        else:
            b = str(raw).strip()
            e = str(ex).strip()
            fixture["prompt_extra"] = b + "\n" + e if b else e
    runs = default_runs_dir(repo)
    layout = RunLayout(runs, fixture["run_id"])
    layout.run_dir.mkdir(parents=True, exist_ok=True)
    write_input_manifest(repo, fixture, layout.manifest_path)
    print(layout.manifest_path)


def cmd_understand(args: argparse.Namespace) -> None:
    repo = _work_repo_root()
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
    repo = _work_repo_root()
    layout = RunLayout(default_runs_dir(repo), args.run_id)
    src = layout.run_dir / args.src
    _require_path(
        src,
        hint="Run `understand` first, or pass `--src` to an existing look_spec_v*.json in this run dir.",
    )
    shutil.copyfile(src, layout.approved_spec_path)
    print(layout.approved_spec_path)


def cmd_draft_2a(args: argparse.Namespace) -> None:
    repo = _work_repo_root()
    layout = RunLayout(default_runs_dir(repo), args.run_id)
    manifest = json.loads(layout.manifest_path.read_text(encoding="utf-8"))
    _require_path(
        layout.approved_spec_path,
        hint="Run `approve-spec` after `understand` (see: look_spec_v0.json → look_spec_approved.json).",
    )
    spec = json.loads(layout.approved_spec_path.read_text(encoding="utf-8"))
    client = _client()
    model = os.getenv("GEN_MODEL_2A", "gemini-3.1-flash-image-preview")
    draft_2a = layout.draft_2a_path
    run_step_2a(
        client=client,
        repo_root=repo,
        manifest=manifest,
        spec=spec,
        model=model,
        brief_path=layout.brief_2a_path,
        out_image=draft_2a,
    )
    print(draft_2a)


def _resolve_fixture_path(repo: Path, raw: str) -> Path:
    p = Path(raw)
    if not p.is_absolute():
        p = (repo / p).resolve()
    else:
        p = p.resolve()
    return p


def _collect_fixture_paths(repo: Path, fixtures: list[str], fixture_glob: str | None) -> list[Path]:
    out: list[Path] = []
    seen: set[Path] = set()

    for raw in fixtures:
        p = _resolve_fixture_path(repo, raw)
        if not p.is_file():
            print(f"Fixture is not a file: {p}", file=sys.stderr)
            raise SystemExit(2)
        if p not in seen:
            seen.add(p)
            out.append(p)

    if fixture_glob:
        pattern = fixture_glob
        if not Path(pattern).is_absolute():
            pattern = str(repo / pattern)
        for matched in sorted(glob.glob(pattern, recursive=True)):
            p = Path(matched).resolve()
            if p.is_file() and p not in seen:
                seen.add(p)
                out.append(p)

    if not out:
        print("No fixtures found. Pass --fixture and/or --fixture-glob.", file=sys.stderr)
        raise SystemExit(2)
    return out


PipelineThrough = Literal["draft", "full"]


def _primary_artifact(through: PipelineThrough, out: dict[str, Path]) -> Path:
    if through == "full" and "logo" in out:
        return out["logo"]
    return out["draft"]


def _run_from_fixture(
    repo: Path,
    fixture_path: Path,
    *,
    version: int,
    through: PipelineThrough,
    extra_prompt: str | None = None,
) -> dict[str, Path]:
    """Fixture JSON → understand → approve → 2A; with ``full``, optionally logo-edit on draft (requires logo in manifest)."""
    fixture: dict = json.loads(fixture_path.read_text(encoding="utf-8"))
    if extra_prompt and str(extra_prompt).strip():
        fixture = dict(fixture)
        raw = fixture.get("prompt_extra")
        if raw is None:
            merged = str(extra_prompt).strip()
        elif isinstance(raw, list):
            merged = "\n".join(str(x).strip() for x in raw if str(x).strip())
            if str(extra_prompt).strip():
                merged = merged + "\n" + str(extra_prompt).strip() if merged else str(extra_prompt).strip()
        else:
            base = str(raw).strip()
            ex = str(extra_prompt).strip()
            merged = base + "\n" + ex if base else ex
        fixture["prompt_extra"] = merged
    runs = default_runs_dir(repo)
    layout = RunLayout(runs, str(fixture["run_id"]))

    layout.run_dir.mkdir(parents=True, exist_ok=True)
    write_input_manifest(repo, fixture, layout.manifest_path)
    manifest = json.loads(layout.manifest_path.read_text(encoding="utf-8"))

    client = _client()
    understand_model = os.getenv("GEMINI_UNDERSTAND_MODEL", "gemini-3-flash-preview")
    out_spec = layout.run_dir / f"look_spec_v{version}.json"
    out_raw = layout.run_dir / f"understand_v{version}_raw.txt"
    run_understand_step(
        client=client,
        repo_root=repo,
        manifest=manifest,
        model=understand_model,
        dest_spec_path=out_spec,
        dest_raw_path=out_raw,
    )

    shutil.copyfile(out_spec, layout.approved_spec_path)
    spec = json.loads(layout.approved_spec_path.read_text(encoding="utf-8"))

    gen_2a = os.getenv("GEN_MODEL_2A", "gemini-3.1-flash-image-preview")
    draft_2a = layout.draft_2a_path
    run_step_2a(
        client=client,
        repo_root=repo,
        manifest=manifest,
        spec=spec,
        model=gen_2a,
        brief_path=layout.brief_2a_path,
        out_image=draft_2a,
    )
    out_paths: dict[str, Path] = {"draft": draft_2a}

    if through == "full" and role_has_reference_image(manifest, "logo_detail"):
        base = resolve_draft_source(layout.run_dir, None)
        _require_path(
            base,
            hint="2A 底图应已写入 draft_2a.png（或 refine 的 draft_refined_*.png）。",
        )
        edit_model = os.getenv("GEN_MODEL_EDIT", os.getenv("GEN_MODEL_2B", "gemini-3.1-flash-image-preview"))
        logo_out = layout.run_dir / "look_logo_patch.png"
        run_logo_edit(
            client=client,
            repo_root=repo,
            manifest=manifest,
            spec=spec,
            base_image=base,
            model=edit_model,
            out_image=logo_out,
        )
        out_paths["logo"] = logo_out

    return out_paths


def _run_pipeline_batch(
    args: argparse.Namespace,
    *,
    through: PipelineThrough,
) -> None:
    repo = _work_repo_root()
    fixture_paths = _collect_fixture_paths(repo, args.fixture, args.fixture_glob)
    print_stages: bool = bool(getattr(args, "print_stages", False))
    failed = False
    for fixture_path in fixture_paths:
        try:
            out = _run_from_fixture(
                repo,
                fixture_path,
                version=args.version,
                through=through,
                extra_prompt=getattr(args, "extra_prompt", None),
            )
            if print_stages:
                for key in ("draft", "logo"):
                    if key in out:
                        print(f"{key}\t{out[key]}")
            else:
                print(_primary_artifact(through, out))
        except Exception as e:
            failed = True
            label = "[run]"
            print(f"{label} fixture failed: {fixture_path} :: {e}", file=sys.stderr)
            if not args.continue_on_error:
                raise SystemExit(1) from e
    if failed:
        raise SystemExit(1)


def cmd_run(args: argparse.Namespace) -> None:
    _run_pipeline_batch(args, through=args.through)


def cmd_write_gate(args: argparse.Namespace) -> None:
    if args.kind == "refine" and args.refine_index is None:
        print("--refine-index is required when --kind is refine", file=sys.stderr)
        raise SystemExit(2)
    repo = _work_repo_root()
    layout = RunLayout(default_runs_dir(repo), args.run_id)
    payload = {"approved_at": datetime.now(timezone.utc).isoformat()}
    text = json.dumps(payload, indent=2) + "\n"
    if args.kind == "draft":
        dest = layout.gate_draft_approved_path()
    elif args.kind == "final":
        dest = layout.gate_final_approved_path()
    else:
        dest = layout.gate_refine_approved_path(args.refine_index)
    dest.write_text(text, encoding="utf-8")
    print(dest)


def cmd_refine_pass(args: argparse.Namespace) -> None:
    repo = _work_repo_root()
    layout = RunLayout(default_runs_dir(repo), args.run_id)
    manifest = json.loads(layout.manifest_path.read_text(encoding="utf-8"))
    _require_path(
        layout.approved_spec_path,
        hint="Run `approve-spec` after `understand`.",
    )
    _require_path(
        layout.regions_path(args.index),
        hint=f"Create regions_{args.index}.json in the run directory before refine-pass.",
    )
    spec = json.loads(layout.approved_spec_path.read_text(encoding="utf-8"))
    client = _client()
    model = os.getenv(
        "GEN_MODEL_EDIT",
        os.getenv("GEN_MODEL_2B", "gemini-3.1-flash-image-preview"),
    )
    out = run_refine_pass(
        client=client,
        repo_root=repo,
        layout=layout,
        k=args.index,
        manifest=manifest,
        spec=spec,
        model=model,
    )
    print(out)


def cmd_logo_edit(args: argparse.Namespace) -> None:
    repo = _work_repo_root()
    layout = RunLayout(default_runs_dir(repo), args.run_id)
    manifest = json.loads(layout.manifest_path.read_text(encoding="utf-8"))
    if not role_has_reference_image(manifest, "logo_detail"):
        print(
            "logo-edit skipped: input_manifest has no logo_detail image. "
            "Provide logo_detail in the run fixture to sharpen a logo.",
            file=sys.stderr,
        )
        raise SystemExit(2)
    _require_path(
        layout.approved_spec_path,
        hint="Run `approve-spec` after `understand`.",
    )
    spec = json.loads(layout.approved_spec_path.read_text(encoding="utf-8"))
    client = _client()
    model = os.getenv("GEN_MODEL_EDIT", os.getenv("GEN_MODEL_2B", "gemini-3.1-flash-image-preview"))
    if args.draft_image:
        raw = Path(args.draft_image)
        draft_explicit = (repo / raw).resolve() if not raw.is_absolute() else raw.resolve()
    else:
        draft_explicit = None
    try:
        base = resolve_draft_source(layout.run_dir, draft_explicit)
    except FileNotFoundError as e:
        print(str(e), file=sys.stderr)
        raise SystemExit(2) from e
    _require_path(
        base,
        hint="Run `draft-2a` / `run` / `refine-pass`, or pass `--draft-image` to an existing PNG.",
    )
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


def cmd_face_edit(args: argparse.Namespace) -> None:
    repo = _work_repo_root()
    layout = RunLayout(default_runs_dir(repo), args.run_id)
    manifest = json.loads(layout.manifest_path.read_text(encoding="utf-8"))
    if not role_has_reference_image(manifest, "face"):
        print(
            "face-edit: input_manifest 中没有有效的 face 参考。请在建跑时的 fixture 里为 face 提供单张或多张路径。",
            file=sys.stderr,
        )
        raise SystemExit(2)
    _require_path(
        layout.approved_spec_path,
        hint="Run `approve-spec` after `understand`.",
    )
    spec = json.loads(layout.approved_spec_path.read_text(encoding="utf-8"))
    client = _client()
    model = os.getenv("GEN_MODEL_EDIT", os.getenv("GEN_MODEL_2B", "gemini-3.1-flash-image-preview"))
    if args.draft_image:
        raw = Path(args.draft_image)
        draft_explicit = (repo / raw).resolve() if not raw.is_absolute() else raw.resolve()
    else:
        draft_explicit = None
    try:
        base = resolve_draft_source(layout.run_dir, draft_explicit)
    except FileNotFoundError as e:
        print(str(e), file=sys.stderr)
        raise SystemExit(2) from e
    _require_path(
        base,
        hint="先跑 `run` 或 `draft-2a` 生成 draft_2a.png，或 `--draft-image` 指定底图。",
    )
    with_look_light = not bool(getattr(args, "no_look_lighting", False))
    out = layout.run_dir / "look_face_patch.png"
    run_face_edit(
        client=client,
        repo_root=repo,
        manifest=manifest,
        spec=spec,
        base_image=base,
        model=model,
        out_image=out,
        with_look_lighting_ref=with_look_light,
    )
    print(out)


def _resolve_input_ref_paths(repo: Path, refs: list[str]) -> list[Path]:
    out: list[Path] = []
    for raw in refs:
        p = Path(raw)
        rp = (repo / p).resolve() if not p.is_absolute() else p.resolve()
        if not rp.is_file():
            print(f"detail-edit ref is not a file: {rp}", file=sys.stderr)
            raise SystemExit(2)
        out.append(rp)
    if not out:
        print("detail-edit requires at least one --ref PATH", file=sys.stderr)
        raise SystemExit(2)
    return out


def cmd_detail_edit(args: argparse.Namespace) -> None:
    repo = _work_repo_root()
    layout = RunLayout(default_runs_dir(repo), args.run_id)
    _require_path(
        layout.approved_spec_path,
        hint="Run `approve-spec` after `understand`.",
    )
    spec = json.loads(layout.approved_spec_path.read_text(encoding="utf-8"))
    if args.draft_image:
        raw = Path(args.draft_image)
        draft_explicit = (repo / raw).resolve() if not raw.is_absolute() else raw.resolve()
    else:
        draft_explicit = None
    try:
        base = resolve_draft_source(layout.run_dir, draft_explicit)
    except FileNotFoundError as e:
        print(str(e), file=sys.stderr)
        raise SystemExit(2) from e
    _require_path(
        base,
        hint="先跑 `run` 或 `draft-2a` 生成 draft_2a.png，或 `--draft-image` 指定底图。",
    )
    refs = _resolve_input_ref_paths(repo, args.ref)
    note = str(args.note).strip()
    if not note:
        print("detail-edit requires non-empty --note", file=sys.stderr)
        raise SystemExit(2)
    client = _client()
    model = os.getenv("GEN_MODEL_EDIT", os.getenv("GEN_MODEL_2B", "gemini-3.1-flash-image-preview"))
    out = layout.run_dir / "look_detail_patch.png"
    run_detail_edit(
        client=client,
        repo_root=repo,
        spec=spec,
        base_image=base,
        model=model,
        out_image=out,
        detail_refs=refs,
        note=note,
    )
    print(out)


def _add_fixture_batch_options(ap: argparse.ArgumentParser) -> None:
    ap.add_argument(
        "--fixture",
        action="append",
        default=[],
        metavar="PATH",
        help="Fixture JSON 路径。可多次指定以批量。",
    )
    ap.add_argument(
        "--fixture-glob",
        default=None,
        metavar="GLOB",
        help="与 --fixture 合并，匹配其它 fixture（支持 **）；相对路径相对工作仓库根（见 look_pipeline.repo_root.default_repo_root）",
    )
    ap.add_argument(
        "--version",
        type=int,
        default=0,
        help="understand 输出的 look_spec 版本号。",
    )
    ap.add_argument(
        "--continue-on-error",
        action="store_true",
        help="批量时单条失败则继续。",
    )


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="look-pipeline",
        description="Look 生成管线。日常请用子命令 `run`；单步子命令供调试与局部重跑。",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    s0 = sub.add_parser(
        "run",
        help="主流程：fixture → understand → 2A 主交付；full 时再接 logo 修图（需 fixture 含 logo 参考）",
    )
    _add_fixture_batch_options(s0)
    s0.add_argument(
        "--through",
        choices=["draft", "full"],
        default="draft",
        metavar="STAGE",
        help="draft=到 2A 止（默认）；full=2A 后再 logo-edit（manifest 有 logo 图时，否则同 draft）。",
    )
    s0.add_argument(
        "--print-stages",
        action="store_true",
        help="输出多行：draft / logo 路径；否则只打主交付物一行。",
    )
    s0.add_argument(
        "--extra-prompt",
        default=None,
        metavar="TEXT",
        help="附加要求（与 fixture 里 prompt_extra 合并，写入 understand 与 2A 主 prompt）",
    )
    s0.set_defaults(func=cmd_run)

    s1 = sub.add_parser("init-run", help="仅创建 run 目录与 input_manifest（调试）")
    s1.add_argument("--fixture", required=True)
    s1.add_argument(
        "--extra-prompt",
        default=None,
        metavar="TEXT",
        help="附加要求，与 JSON 中 prompt_extra 合并后写入 manifest",
    )
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

    s6 = sub.add_parser("logo-edit", help="基于 2A/refine 底图做 logo 对位修图（需 logo 参考图）")
    s6.add_argument("--run-id", required=True)
    s6.add_argument(
        "--draft-image",
        default=None,
        metavar="PATH",
        help="底图；省略则同 run 规则（最新 draft_refined_*.png 或 draft_2a.png）。",
    )
    s6.set_defaults(func=cmd_logo_edit)

    s6b = sub.add_parser(
        "face-edit",
        help="在 2A/refine 底图上做脸部精修，参考 manifest 中的 face；默认可附 look_ref 稳定光影",
    )
    s6b.add_argument("--run-id", required=True)
    s6b.add_argument(
        "--draft-image",
        default=None,
        metavar="PATH",
        help="底图；默认 resolve_draft_source（与 logo-edit 相同）",
    )
    s6b.add_argument(
        "--no-look-lighting",
        action="store_true",
        help="不附 look_ref 作独立光影参考（仅按底图+face 修，默认会附 look_ref 打光）",
    )
    s6b.set_defaults(func=cmd_face_edit)

    s6c = sub.add_parser(
        "detail-edit",
        help="基于 2A/refine 底图 + 参考细节图做二次结构/纹理增强（如领口、袖口、门襟）",
    )
    s6c.add_argument("--run-id", required=True)
    s6c.add_argument(
        "--draft-image",
        default=None,
        metavar="PATH",
        help="底图；默认 resolve_draft_source（与 logo-edit 相同）",
    )
    s6c.add_argument(
        "--ref",
        action="append",
        default=[],
        metavar="PATH",
        help="细节参考图，可重复 --ref 传多张",
    )
    s6c.add_argument(
        "--note",
        required=True,
        metavar="TEXT",
        help="本次细节增强要求（例如：领口必须双层罗纹圆领）",
    )
    s6c.set_defaults(func=cmd_detail_edit)

    s7 = sub.add_parser(
        "refine-pass",
        help="Region-based localized edit; writes draft_refined_{k}.png from regions_{k}.json",
    )
    s7.add_argument("--run-id", required=True)
    s7.add_argument("--index", type=int, required=True)
    s7.set_defaults(func=cmd_refine_pass)

    s8 = sub.add_parser(
        "write-gate",
        help="Write an approval gate JSON (approved_at UTC ISO-8601)",
    )
    s8.add_argument("--run-id", required=True)
    s8.add_argument("--kind", choices=["draft", "final", "refine"], required=True)
    s8.add_argument(
        "--refine-index",
        type=int,
        default=None,
        help="Required when --kind is refine; written to gate_refine_{k}_approved.json",
    )
    s8.set_defaults(func=cmd_write_gate)

    return p


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
