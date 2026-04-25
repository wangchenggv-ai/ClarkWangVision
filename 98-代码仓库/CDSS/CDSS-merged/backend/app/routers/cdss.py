"""CDSS router: clinical decision support analysis endpoints."""

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.permissions import get_current_user
from app.database import get_db
from app.models.user import User

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CDSSInput(BaseModel):
    patient_id: int
    age: int
    se: float  # spherical equivalent
    axial_length: float
    al_growth_last_year: float  # mm/yr
    outdoor_hours: float
    near_work_hours: float
    bcc: float  # lag of accommodation
    parent_myopia: str  # none | one | both


class RiskDimension(BaseModel):
    score: float
    level: str  # high | medium | low


class CDSSResult(BaseModel):
    total_score: float
    genetic: RiskDimension
    environmental: RiskDimension
    physiological: RiskDimension
    recommendation: str
    prediction_18yo_se: float
    similar_cases_count: int


# ---------------------------------------------------------------------------
# POST /analyze
# ---------------------------------------------------------------------------

@router.post("/analyze", response_model=CDSSResult, summary="CDSS临床决策分析")
def analyze(
    body: CDSSInput,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Run CDSS analysis on patient data and return risk scores + recommendation."""

    # Genetic risk
    if body.parent_myopia == "both":
        g_score = 80.0
    elif body.parent_myopia == "one":
        g_score = 50.0
    else:
        g_score = 20.0

    # Environmental risk
    if body.outdoor_hours < 1 or body.near_work_hours > 4:
        e_score = 80.0
    elif body.outdoor_hours < 2 or body.near_work_hours > 3:
        e_score = 50.0
    else:
        e_score = 20.0

    # Physiological risk
    if body.al_growth_last_year >= 0.35 or abs(body.se) > 4:
        p_score = 80.0
    elif body.al_growth_last_year >= 0.2:
        p_score = 50.0
    else:
        p_score = 20.0

    # Total weighted score
    total = round(g_score * 0.3 + e_score * 0.3 + p_score * 0.4, 1)

    def _level(s: float) -> str:
        return "high" if s >= 60 else "medium" if s >= 40 else "low"

    # Product recommendation
    if body.bcc > 0.75 or body.axial_length > 25:
        rec = "Ultra 系列 (强效点扩散)"
    elif body.axial_length > 24 or abs(body.se) > 3:
        rec = "时空之眼 (标准级)"
    else:
        rec = "小旋风 (入门级)"

    # Prediction at age 18
    years_to_18 = 18 - body.age
    prediction_se = body.se - years_to_18 * (total / 100 * 1.0)

    return CDSSResult(
        total_score=total,
        genetic=RiskDimension(score=g_score, level=_level(g_score)),
        environmental=RiskDimension(score=e_score, level=_level(e_score)),
        physiological=RiskDimension(score=p_score, level=_level(p_score)),
        recommendation=rec,
        prediction_18yo_se=round(prediction_se, 2),
        similar_cases_count=min(int(total * 3), 300),
    )
