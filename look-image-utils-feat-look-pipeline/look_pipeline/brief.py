from __future__ import annotations

from typing import Any, Mapping

from look_pipeline.manifest import POSE_REF_ROLE, role_has_reference_image


def normalize_prompt_extra(manifest: Mapping[str, Any] | None) -> str | None:
    """从 manifest 取出 `prompt_extra`（支持 str 或 list 拼接），strip 后若无内容则 None。"""
    if manifest is None:
        return None
    pe = manifest.get("prompt_extra")
    if isinstance(pe, list):
        s = "\n".join(str(x).strip() for x in pe if str(x).strip()) or None
    elif isinstance(pe, str):
        s = (pe or "").strip() or None
    else:
        s = None
    return s


def _supplement_mentions_pose(prompt_extra: str | None) -> bool:
    """若运营补充里明确要求姿态/机位/体态，返回 True（此时不套用「无姿态则跟 LOOK」的默认条）。"""
    s = (prompt_extra or "").strip()
    if not s:
        return False
    t = s.lower()
    for kw in (
        "pose",
        "stance",
        "posture",
        "profile",
        "3/4",
    ):
        if kw in t:
            return True
    for kw in (
        "身体",
        "姿态",
        "体态",
        "姿势",
        "站位",
        "机位",
        "摆拍",
        "全身",
        "半身",
        "坐姿",
        "站姿",
    ):
        if kw in s:
            return True
    return False


def build_2a_user_turn_operator_lead(manifest: Mapping[str, Any] | None) -> str | None:
    """
    2A 生图时，把 `prompt_extra` 放在 **user 侧首条文本**（紧接在参考图前）。
    与将运营全文塞进 system instruction 二选一，由 `compile_brief_2a(..., embed_operator_in_system=...)` 控制。
    """
    pe = normalize_prompt_extra(manifest)
    if not pe:
        return None
    return (
        f"{pe}\n\n"
        "---\n"
        "与 system instruction 中 `### POSE_BLOCK` 同优先级；影调/布景/用光参考 `### LOOK_STYLE_BLOCK` 与首帧 LOOK 图。以下为按 ROLE= 附上的参考图。\n"
    )


def compile_brief_2a(
    spec: Mapping[str, Any],
    *,
    manifest: Mapping[str, Any] | None = None,
    embed_operator_in_system: bool = True,
) -> str:
    """若 ``embed_operator_in_system`` 为 False 且存在 ``prompt_extra``，运营原文仅出现在 user 首条消息，不写入 system。"""
    pe = normalize_prompt_extra(manifest)
    lines: list[str] = []
    lines.append("### OUTPUT_CONTRACT (read first — hard requirements)")
    lines.append(
        "Deliver exactly ONE single full-frame photograph: one coherent scene, one primary subject "
        "featuring the product (the hero item to sell — not limited to clothing), one camera viewpoint. "
        "This must read as ONE hero LOOK shot for e-commerce / editorial use."
    )
    lines.append(
        "Do NOT output: collage, grid of variants, A/B options layout, film strip, storyboard panels, "
        "diptych/triptych, split-screen before/after, duplicate side-by-side poses, mirrored twins, "
        "or multiple unrelated full figures. Do NOT paste reference thumbnails into the frame."
    )
    lines.append(
        "If the model stack emits more than one image asset, only the single best final frame should "
        "represent this step—conceptually there is exactly one deliverable photograph."
    )
    if pe and not embed_operator_in_system:
        _follow_crop = (
            "Body crop, distance, and pose follow `### POSE_BLOCK` in the system instruction **and** the first user text in "
            "this same request (operator / 运营, when the pipeline attaches it) — not an interpretation of "
        )
    elif pe and embed_operator_in_system:
        _follow_crop = (
            "Body crop, distance, and pose follow `### POSE_BLOCK` and `### OPERATOR_SUPPLEMENT` in the system instruction (when present) — not an interpretation of "
        )
    else:
        _follow_crop = (
            "Body crop, distance, and pose follow `### POSE_BLOCK` in the system instruction — not an interpretation of "
        )
    lines.append(
        "Here “full-frame” / “single full-frame photograph” means one full-bleed canvas image, not a "
        f"requirement to show a full-body (head-to-toe) figure. {_follow_crop}“full” as “full body”."
    )
    lines.append("")
    lines.append(
        "You are generating a FIRST-PASS (structure + identity) editorial product LOOK image; "
        "fine fabric micro-texture and final resolution polish may come in a later pass."
    )
    lines.append("Priorities follow the JSON field `consistency_priority` order.")
    lines.append("")
    lines.append("### QUALITY_BLOCK (negative constraints)")
    lines.append(
        "Avoid color banding, posterization, patchy artifacts, or uneven blocks in smooth/solid "
        "background areas. Background gradients must be clean and even without visible stepping "
        "or compression artifacts. Ensure natural noise/grain texture in flat regions to prevent "
        "artificial-looking smooth patches."
    )
    lines.append("")
    lines.append("### LOOK_STYLE_BLOCK")
    lines.append(str(spec["look_style"]["summary"]))
    lines.append("")
    lines.append("### POSE_BLOCK")
    if manifest is not None:
        if not role_has_reference_image(manifest, POSE_REF_ROLE) and not _supplement_mentions_pose(
            pe
        ):
            lines.append(
                "Default (no `pose_ref` image and no pose/body/stance requirements in the operator "
                "supplement): the subject’s placement, body orientation, and framing must follow the "
                "**LOOK** reference — do not invent a different pose, gesture, or camera relationship "
                "that is not implied by the LOOK. The JSON `pose` lines below must stay consistent with this."
            )
            lines.append("")
    lines.append(str(spec["pose"]["summary"]))
    lines.append("")
    if pe and embed_operator_in_system:
        lines.append("### OPERATOR_SUPPLEMENT")
        lines.append(
            "Customer/operator text for this run. Treat as high-priority next to (and not weaker than) "
            "`### POSE_BLOCK` for pose, hands, eye-line, crop, and camera distance when those topics appear here; "
            "use `### LOOK_STYLE_BLOCK` and the first LOOK image for overall lighting, mood, set, and palette unless "
            "this supplement explicitly overrides them for pose or framing only."
        )
        lines.append(pe)
        lines.append("")
    if pe and _supplement_mentions_pose(pe):
        lines.append("### FRAMING_AND_ATMOSPHERE (soft guidance — not a fixed global look)")
        lines.append(
            "This block only nudges the model when the **operator/POSE** asks for a crop or pose that is **not** a literal copy of "
            "this job’s first LOOK. **Mood, set, and atmosphere always follow the current shoot’s `### LOOK_STYLE_BLOCK` and the "
            "first LOOK image** — if you **swap the LOOK** next time, the *target* vibe and spacing follow **that** reference, not a "
            "rigid one-size-fits-all composition."
        )
        lines.append(
            "**Operator and `### POSE_BLOCK` override** this block when they explicitly want a look (e.g. tight fashion crop, "
            "close-up, partial face, or deliberate edge play). In those cases, follow the text — this guidance does not forbid them."
        )
        lines.append(
            "In the *default* case (waist-up / half-body without a special tight-crop request): **prefer** an intentional, "
            "on-brand frame that still feels like the *same* editorial world as this LOOK: avoid **accidental** cut-offs through the "
            "forehead, eyes, chin, or knuckles *when* a **slightly wider** frame would better match the LOOK’s calm spacing and the "
            "pose description. When in doubt, bias slightly toward more margin — unless the operator asked otherwise."
        )
        lines.append(
            "For hands/arms, **favor** showing the pose the garment needs without misfire at the **edge**; honor explicit **cropped** "
            "or partial hand gestures in the operator or spec when present."
        )
        lines.append("")
    lines.append("### PRODUCT_HERO_BLOCK")
    lines.append(
        "Focal product or on-brand hero item to feature (any category, not only apparel), from the approved "
        "JSON field `garment` / `garment.notes` — must read clearly as the main buyable or primary subject in frame."
    )
    lines.append(str(spec["garment"]["notes"]))
    lines.append("")
    lines.append("### FABRIC_BLOCK (do not invent contradicting textures)")
    lines.append(str(spec["fabric"]["notes"]))
    lines.append("")
    lines.append("### LOGO_BLOCK")
    lines.append(f"Placement: {spec['logo']['placement']}. {spec['logo']['notes']}")
    lines.append("")
    lines.append("### FACE_BLOCK")
    lines.append(str(spec["face"]["notes"]))
    lines.append("")
    lines.append("### OUTPUT_CONTRACT (recap)")
    if pe and not embed_operator_in_system:
        _recap_crop = "respect `### POSE_BLOCK` and the first user block (operator / 运营) for crop. "
    elif pe and embed_operator_in_system:
        _recap_crop = "respect `### POSE_BLOCK` / `### OPERATOR_SUPPLEMENT` for crop. "
    else:
        _recap_crop = "respect `### POSE_BLOCK` for crop. "
    lines.append(
        "One photograph only: full-bleed frame, a single clear hero with the product as the focal subject, "
        "no composite layouts. The product’s shape, proportions, and on-body / in-scene read must stay "
        "consistent with the sku_flat reference image(s). "
        "“Full-bleed” is not a mandate for full-body framing — " + _recap_crop
    )
    return "\n".join(lines) + "\n"


# Future 2B (not implemented): optional refinement on top of ``draft_2a.png`` — e.g. skin/face
# detail vs. logo fidelity, each driven by dedicated reference images and separate briefs. The
# removed old 2B was a single 4K fabric+logo upscale pass; it is no longer part of the pipeline.


def compile_brief_logo_edit(spec: Mapping[str, Any]) -> str:
    return (
        "Edit the provided image to sharpen and correct the logo to match the logo_detail reference.\n"
        f"Target placement: {spec['logo']['placement']}.\n"
        "Do not change overall pose or scene layout.\n"
    )


def compile_brief_face_edit(
    spec: Mapping[str, Any],
    *,
    n_face_refs: int,
    with_look_lighting_ref: bool,
) -> str:
    multi = f" {n_face_refs} reference image(s) follow (identity / feature reference only)." if n_face_refs > 1 else ""
    look_block = ""
    if with_look_lighting_ref:
        look_block = (
            "LOOK (hero) reference for LIGHTING: A separately labeled **LOOK_HERO_REFERENCE_FOR_LIGHTING_** image "
            "is attached. It is the **lighting, mood, and color-grade authority** for this same shoot. Match the "
            "face region's key/fill/rim, shadow quality, and skin in that lighting **world**, then make the result "
            "seamless with the **first image** (canvas) for framing and in-frame content. FACE reference crops are "
            "for identity/geometry, not for overriding this look if they disagree on light.\n"
            "\n"
        )
    first_light_bullet = (
        "- The **first image** is the full frame you return; re-light the face to match the scene, **prioritizing the "
        "attached LOOK reference for key/fill/mood and color** over the small FACE reference crops, then match skin "
        "and edges to the first image.\n"
        if with_look_lighting_ref
        else "- The **first image** is the full frame you return; re-light the face to the **light already in that "
        "image**; FACE reference crops are for identity, not for copying a different light.\n"
    )
    skin_bullet = (
        "- Skin tone: align with neck, chest if visible, and hands in the first image; honor the look reference's "
        "color **when it matches this shoot**.\n"
        if with_look_lighting_ref
        else "- Skin tone: align with neck, chest if visible, and hands in the first image.\n"
    )
    return (
        "You are given the CURRENT hero photograph to edit (first image) from an earlier 2A render.\n"
        "\n"
        "GOAL: FACE-FOCUSED refinement — align identity, skin, and facial features to the attached FACE "
        "reference(s). The face references are for WHO the person is and fine facial structure, not for "
        "copying their own crop lighting when it disagrees with the look / first image.\n"
        "\n"
        f"{look_block}"
        "LIGHTING & COLOR (critical — avoid a cut-out / mismatched look):\n"
        f"{first_light_bullet}"
        f"{skin_bullet}"
        "- Match shadow under the nose, chin, and eye sockets; feather jawline, hairline, ears with no hard edges.\n"
        "\n"
        "COMPOSITION: Keep garment, background, pose, and crop the same as the first image. Only adjust "
        "the head/face as needed for a seamless match.\n"
        f"Face notes from the approved spec: {spec['face']['notes']}\n"
        f"Return exactly ONE full-frame result image. Face reference(s):{multi}\n"
    )


def compile_brief_detail_edit(
    spec: Mapping[str, Any],
    *,
    note: str,
    n_refs: int,
) -> str:
    n = max(1, int(n_refs))
    return (
        "You are given the CURRENT hero photograph to edit (first image), generated by 2A.\n"
        "Perform a DETAIL-FOCUSED enhancement pass on top of this image.\n"
        f"Operator requirement (highest priority): {note.strip()}\n"
        f"{n} detail reference image(s) are attached after the first image.\n"
        "Use these references to improve target construction details (e.g. seams, materials, product edges, fabric micro-structure)\n"
        "while keeping the overall person identity, pose, composition, product/silhouette, and scene unchanged.\n"
        f"Product (garment) notes from approved spec: {spec['garment']['notes']}\n"
        f"Fabric notes from approved spec: {spec['fabric']['notes']}\n"
        "Return exactly ONE full-frame result image.\n"
    )