"""Pydantic schemas for baseline exams and follow-up visits."""

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

VisitType = Literal["1M", "3M", "6M", "12M", "other"]


# ---------------------------------------------------------------------------
# Shared eye-data sub-schemas
# ---------------------------------------------------------------------------

class EyeData(BaseModel):
    """Ophthalmic measurements for a single eye at baseline.

    All measurements are optional — partial records are common in clinical
    settings where not all instruments are available.
    """

    sphere: Optional[float] = Field(None, description="球镜 diopters (D)")
    cylinder: Optional[float] = Field(None, description="柱镜 diopters (D)")
    axis: Optional[int] = Field(None, ge=0, le=180, description="轴向 degrees (0-180)")
    va: Optional[float] = Field(None, ge=0.0, description="视力 (e.g. 0.8, 1.0)")
    axial_length: Optional[float] = Field(None, description="眼轴长度 mm")
    corneal_curvature_flat: Optional[float] = Field(
        None, description="角膜曲率 K1 (flat meridian) D"
    )
    corneal_curvature_steep: Optional[float] = Field(
        None, description="角膜曲率 K2 (steep meridian) D"
    )


class FollowUpEyeData(BaseModel):
    """Simpler eye-data subset recorded at follow-up visits (no cornea)."""

    sphere: Optional[float] = Field(None, description="球镜 diopters (D)")
    cylinder: Optional[float] = Field(None, description="柱镜 diopters (D)")
    axis: Optional[int] = Field(None, ge=0, le=180, description="轴向 degrees (0-180)")
    va: Optional[float] = Field(None, ge=0.0, description="视力")
    axial_length: Optional[float] = Field(None, description="眼轴长度 mm")


# ---------------------------------------------------------------------------
# Baseline exam schemas
# ---------------------------------------------------------------------------

class BaselineExamCreate(BaseModel):
    """Payload for POST /exams/baseline."""

    patient_id: int
    exam_date: date
    od: EyeData = Field(default_factory=EyeData, description="Right eye (OD) data")
    os: EyeData = Field(default_factory=EyeData, description="Left eye (OS) data")
    lens_brand: Optional[str] = Field(None, max_length=200)
    lens_od_addition: Optional[float] = Field(None, description="Addition power OD (D)")
    lens_os_addition: Optional[float] = Field(None, description="Addition power OS (D)")


class BaselineExamResponse(BaseModel):
    """Full baseline exam record returned to API clients.

    Flat structure mirrors the DB columns directly for straightforward
    ORM serialisation with ``from_attributes=True``.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_id: int
    exam_date: date

    # Right eye
    od_sphere: Optional[float]
    od_cylinder: Optional[float]
    od_axis: Optional[int]
    od_va: Optional[float]
    od_axial_length: Optional[float]
    od_corneal_curvature_flat: Optional[float]
    od_corneal_curvature_steep: Optional[float]

    # Left eye
    os_sphere: Optional[float]
    os_cylinder: Optional[float]
    os_axis: Optional[int]
    os_va: Optional[float]
    os_axial_length: Optional[float]
    os_corneal_curvature_flat: Optional[float]
    os_corneal_curvature_steep: Optional[float]

    # Lens
    lens_brand: Optional[str]
    lens_od_addition: Optional[float]
    lens_os_addition: Optional[float]

    examiner_id: Optional[int]
    created_at: datetime


# ---------------------------------------------------------------------------
# Follow-up visit schemas
# ---------------------------------------------------------------------------

class FollowUpVisitCreate(BaseModel):
    """Payload for POST /visits."""

    patient_id: int
    visit_type: VisitType
    visit_date: date
    od: FollowUpEyeData = Field(default_factory=FollowUpEyeData, description="Right eye data")
    os: FollowUpEyeData = Field(default_factory=FollowUpEyeData, description="Left eye data")
    wearing_hours_per_day: Optional[float] = Field(None, ge=0.0, le=24.0)
    compliance_good: Optional[bool] = Field(None, description="佩戴依从性")
    complaints: Optional[str] = Field(None, description="Patient reported complaints")
    examiner_notes: Optional[str] = None


class FollowUpVisitResponse(BaseModel):
    """Full follow-up visit record returned to API clients."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_id: int
    visit_type: str
    visit_date: date

    # Right eye
    od_sphere: Optional[float]
    od_cylinder: Optional[float]
    od_axis: Optional[int]
    od_va: Optional[float]
    od_axial_length: Optional[float]

    # Left eye
    os_sphere: Optional[float]
    os_cylinder: Optional[float]
    os_axis: Optional[int]
    os_va: Optional[float]
    os_axial_length: Optional[float]

    wearing_hours_per_day: Optional[float]
    compliance_good: Optional[bool]
    complaints: Optional[str]
    examiner_notes: Optional[str]
    examiner_id: Optional[int]
    created_at: datetime
