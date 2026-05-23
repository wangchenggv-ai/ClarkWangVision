"""Pydantic schemas for API request/response validation."""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field

from models.patient import Design, ProfileSource, Eye


# ── Patient ──────────────────────────────────────────────────────────────

class PatientBase(BaseModel):
    patient_id: str = Field(..., max_length=20)
    age: int = Field(..., ge=1, le=120)
    eye: Eye = Eye.OD
    k1: float = Field(..., gt=5.0, lt=12.0)
    k2: float = Field(..., gt=5.0, lt=12.0)
    e_value: float = Field(..., ge=0.0, le=1.0)
    hvid: float = Field(..., gt=8.0, lt=16.0)
    epi_central: float = Field(..., ge=30.0, le=80.0)
    pupil: float = Field(..., gt=1.0, lt=8.0)
    sph: float = Field(..., gt=-20.0, lt=0.0)
    cyl: float = Field(..., ge=-5.0, le=0.0)
    add_target: float = Field(..., ge=0.0, le=4.0)
    design: Design = Design.CN
    profile_source: ProfileSource = ProfileSource.PARAMETRIC


class PatientCreate(PatientBase):
    pass


class PatientUpdate(BaseModel):
    patient_id: Optional[str] = None
    age: Optional[int] = Field(None, ge=1, le=120)
    eye: Optional[Eye] = None
    k1: Optional[float] = Field(None, gt=5.0, lt=12.0)
    k2: Optional[float] = Field(None, gt=5.0, lt=12.0)
    e_value: Optional[float] = Field(None, ge=0.0, le=1.0)
    hvid: Optional[float] = Field(None, gt=8.0, lt=16.0)
    epi_central: Optional[float] = Field(None, ge=30.0, le=80.0)
    pupil: Optional[float] = Field(None, gt=1.0, lt=8.0)
    sph: Optional[float] = Field(None, gt=-20.0, lt=0.0)
    cyl: Optional[float] = Field(None, ge=-5.0, le=0.0)
    add_target: Optional[float] = Field(None, ge=0.0, le=4.0)
    design: Optional[Design] = None
    profile_source: Optional[ProfileSource] = None


class PatientResponse(PatientBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PatientSummary(BaseModel):
    """Brief patient info for list display."""
    id: int
    patient_id: str
    age: int
    eye: Eye
    design: Design
    sph: float
    add_target: float
    avg_k: float
    epi_central: float

    model_config = {"from_attributes": True}


# ── Calculation ─────────────────────────────────────────────────────────

class CalculationResponse(BaseModel):
    id: int
    patient_id: int
    bozr1: float
    bozr2: float
    rc1: float
    rc2: float
    fa: float
    pa: float
    td: float
    predicted_add: float
    night_glare: str
    fit_score: str
    created_at: datetime

    model_config = {"from_attributes": True}


class LensParamsResponse(BaseModel):
    """Full lens parameter output, mirrors the JS lensParams() result."""
    patient: PatientResponse
    calculation: CalculationResponse
    actual_add: float   # simulated actual for demo


# ── FollowUp ────────────────────────────────────────────────────────────

class FollowUpCreate(BaseModel):
    patient_id: int
    calculation_id: Optional[int] = None
    visit_date: datetime = Field(default_factory=datetime.utcnow)
    actual_add: Optional[float] = None
    visual_quality: Optional[float] = Field(None, ge=0.0, le=1.0)
    notes: Optional[str] = None


class FollowUpResponse(BaseModel):
    id: int
    patient_id: int
    calculation_id: Optional[int]
    visit_date: datetime
    actual_add: Optional[float]
    visual_quality: Optional[float]
    notes: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Aggregated ──────────────────────────────────────────────────────────

class CohortStats(BaseModel):
    """Summary statistics for the cohort analysis tab."""
    total_patients: int
    cf_count: int
    cn_count: int
    avg_predicted_add: float
    avg_actual_add: float
    add_achievement_rate: float  # mean(actual_add / add_target)
