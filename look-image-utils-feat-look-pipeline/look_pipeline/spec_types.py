from __future__ import annotations

from typing import Any, Literal, Mapping

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic import ValidationError

# 与 understand 系统提示中的约定一致；若模型未输出则使用。
_DEFAULT_CONSISTENCY_PRIORITY: list[str] = [
    "logo",
    "face",
    "garment",
    "look_style",
    "fabric",
]


def _ve_to_value_error(e: ValidationError) -> ValueError:
    parts: list[str] = []
    for err in e.errors():
        loc = ".".join(str(x) for x in err.get("loc", ()))
        parts.append(f"{loc}: {err.get('msg', err)}")
    return ValueError("; ".join(parts) if parts else str(e))


class LookStyleBlock(BaseModel):
    model_config = ConfigDict(extra="allow")
    summary: str


class PoseBlock(BaseModel):
    model_config = ConfigDict(extra="allow")
    summary: str


class GarmentBlock(BaseModel):
    model_config = ConfigDict(extra="allow")
    notes: str
    structure_from: str = "sku_flat"


class FabricBlock(BaseModel):
    model_config = ConfigDict(extra="allow")
    notes: str


class LogoBlock(BaseModel):
    model_config = ConfigDict(extra="allow")
    placement: str
    notes: str


class FaceBlock(BaseModel):
    model_config = ConfigDict(extra="allow")
    notes: str


class LookSpecV1(BaseModel):
    """understand 产出的 look spec，schema_version=1；未填项用合理默认补全。"""

    model_config = ConfigDict(extra="allow", validate_assignment=True)
    schema_version: int = 1
    pose_ref_source: Literal["dedicated_image", "shared_with_look"] | None = None
    look_style: LookStyleBlock
    pose: PoseBlock
    garment: GarmentBlock
    fabric: FabricBlock
    logo: LogoBlock
    face: FaceBlock
    consistency_priority: list[str] = Field(
        default_factory=lambda: list(_DEFAULT_CONSISTENCY_PRIORITY)
    )

    @field_validator("schema_version", mode="before")
    @classmethod
    def _coerce_schema_version(cls, v: Any) -> int:
        if v is None or (isinstance(v, str) and not str(v).strip()):
            return 1
        return int(v)

    @field_validator("consistency_priority", mode="before")
    @classmethod
    def _default_consistency_if_missing_or_empty(cls, v: Any) -> Any:
        if v is None or v == []:
            return list(_DEFAULT_CONSISTENCY_PRIORITY)
        return v

    @model_validator(mode="after")
    def _assert_schema_1(self) -> LookSpecV1:
        if int(self.schema_version) != 1:
            raise ValueError("schema_version must be 1")
        return self


def normalize_look_spec(spec: dict[str, Any]) -> dict[str, Any]:
    """
    校验并补全默认项（如缺少 ``consistency_priority``），返回可 ``json.dumps`` 的 dict。
    根或子级上多出的键会保留（``extra="allow"``）。
    """
    try:
        m = LookSpecV1.model_validate(spec)
        # 省略未提供的可选字段（如 pose_ref_source），避免 spec JSON 里出现大量 null
        return m.model_dump(mode="json", exclude_none=True)
    except ValidationError as e:
        raise _ve_to_value_error(e) from e


def validate_look_spec(spec: Mapping[str, Any]) -> None:
    """仅校验不返回；与旧代码兼容（失败时抛 ``ValueError``）。"""
    try:
        LookSpecV1.model_validate(spec)
    except ValidationError as e:
        raise _ve_to_value_error(e) from e
