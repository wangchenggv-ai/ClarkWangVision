"""Pydantic schemas for patients."""

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

ParentMyopiaType = Literal["none", "one", "both"]
GenderType = Literal["male", "female"]


class PatientCreate(BaseModel):
    """Payload for POST /patients."""

    name: str = Field(..., max_length=100)
    gender: Optional[GenderType] = None
    birth_date: date
    school_grade: Optional[str] = Field(None, max_length=50, description="e.g. 小学三年级")
    parent_myopia: Optional[ParentMyopiaType] = Field(
        None, description="父母近视情况: none | one | both"
    )
    outdoor_hours_per_day: Optional[float] = Field(
        None, ge=0.0, le=24.0, description="Average daily outdoor hours"
    )
    near_work_hours_per_day: Optional[float] = Field(
        None, ge=0.0, le=24.0, description="Average daily near-work hours"
    )
    notes: Optional[str] = None
    # center_id and enrolled_by are injected from the authenticated user context,
    # not accepted from the request body directly — keep here as optional overrides
    # for admin users who create patients on behalf of a center.
    center_id: Optional[int] = None


class PatientUpdate(BaseModel):
    """Payload for PATCH /patients/{id} — every field is optional."""

    name: Optional[str] = Field(None, max_length=100)
    gender: Optional[GenderType] = None
    birth_date: Optional[date] = None
    school_grade: Optional[str] = Field(None, max_length=50)
    parent_myopia: Optional[ParentMyopiaType] = None
    outdoor_hours_per_day: Optional[float] = Field(None, ge=0.0, le=24.0)
    near_work_hours_per_day: Optional[float] = Field(None, ge=0.0, le=24.0)
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class PatientListItem(BaseModel):
    """Compact patient representation used in paginated list responses."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_no: str
    name: str
    gender: Optional[str]
    birth_date: date
    school_grade: Optional[str]
    center_id: int
    enrolled_at: datetime
    is_active: bool


class PatientDetail(PatientListItem):
    """Full patient record including clinical summary fields."""

    model_config = ConfigDict(from_attributes=True)

    parent_myopia: Optional[str]
    outdoor_hours_per_day: Optional[float]
    near_work_hours_per_day: Optional[float]
    notes: Optional[str]
    enrolled_by: int
    # Populated by the router via aggregation — not ORM columns
    follow_up_visit_count: int = Field(0, description="Number of recorded follow-up visits")
    has_baseline: bool = Field(False, description="Whether a baseline exam exists")
