"""Visits router: create and manage follow-up visits for patients."""

from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.permissions import (
    get_center_filter,
    get_current_user,
    require_doctor_or_admin,
)
from app.database import get_db
from app.models.follow_up_visit import FollowUpVisit
from app.models.patient import Patient
from app.models.user import User

router = APIRouter()

# Valid visit type values
VISIT_TYPES = {"1M", "3M", "6M", "12M", "other"}


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class VisitCreate(BaseModel):
    patient_id: int
    visit_type: str         # 1M | 3M | 6M | 12M | other
    visit_date: date

    # Right eye (OD)
    od_sphere: Optional[float] = None
    od_cylinder: Optional[float] = None
    od_axis: Optional[int] = None
    od_va: Optional[float] = None
    od_axial_length: Optional[float] = None

    # Left eye (OS)
    os_sphere: Optional[float] = None
    os_cylinder: Optional[float] = None
    os_axis: Optional[int] = None
    os_va: Optional[float] = None
    os_axial_length: Optional[float] = None

    # Compliance
    wearing_hours_per_day: Optional[float] = None
    compliance_good: Optional[bool] = None
    complaints: Optional[str] = None
    examiner_notes: Optional[str] = None


class VisitUpdate(BaseModel):
    visit_date: Optional[date] = None
    visit_type: Optional[str] = None

    od_sphere: Optional[float] = None
    od_cylinder: Optional[float] = None
    od_axis: Optional[int] = None
    od_va: Optional[float] = None
    od_axial_length: Optional[float] = None

    os_sphere: Optional[float] = None
    os_cylinder: Optional[float] = None
    os_axis: Optional[int] = None
    os_va: Optional[float] = None
    os_axial_length: Optional[float] = None

    wearing_hours_per_day: Optional[float] = None
    compliance_good: Optional[bool] = None
    complaints: Optional[str] = None
    examiner_notes: Optional[str] = None


class VisitResponse(BaseModel):
    id: int
    patient_id: int
    visit_type: str
    visit_date: date

    od_sphere: Optional[float]
    od_cylinder: Optional[float]
    od_axis: Optional[int]
    od_va: Optional[float]
    od_axial_length: Optional[float]

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

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_patient_checked(
    patient_id: int,
    center_filter: Optional[int],
    db: Session,
) -> Patient:
    patient: Optional[Patient] = db.get(Patient, patient_id)
    if not patient or not patient.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="患者不存在",
        )
    if center_filter is not None and patient.center_id != center_filter:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权操作其他中心的患者数据",
        )
    return patient


def _get_visit_checked(
    visit_id: int,
    center_filter: Optional[int],
    db: Session,
) -> FollowUpVisit:
    visit: Optional[FollowUpVisit] = db.get(FollowUpVisit, visit_id)
    if not visit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="随访记录不存在",
        )
    if center_filter is not None:
        patient: Optional[Patient] = db.get(Patient, visit.patient_id)
        if patient is None or patient.center_id != center_filter:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="无权操作其他中心的随访数据",
            )
    return visit


# ---------------------------------------------------------------------------
# POST / — create follow-up visit
# ---------------------------------------------------------------------------

@router.post(
    "/",
    response_model=VisitResponse,
    status_code=status.HTTP_201_CREATED,
    summary="录入随访记录",
)
def create_visit(
    body: VisitCreate,
    current_user: User = Depends(require_doctor_or_admin),
    center_filter: Optional[int] = Depends(get_center_filter),
    db: Session = Depends(get_db),
):
    """Create a new follow-up visit for a patient.

    The visit_type must be unique per patient (enforced at DB level via unique
    constraint).  A human-readable 400 is raised if the constraint is violated.
    """
    if body.visit_type not in VISIT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"无效的随访类型，允许值: {', '.join(sorted(VISIT_TYPES))}",
        )

    _get_patient_checked(body.patient_id, center_filter, db)

    # Check uniqueness before insert to give a friendly error
    existing = (
        db.query(FollowUpVisit)
        .filter(
            FollowUpVisit.patient_id == body.patient_id,
            FollowUpVisit.visit_type == body.visit_type,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"该患者的 {body.visit_type} 随访记录已存在",
        )

    visit = FollowUpVisit(
        **body.model_dump(),
        examiner_id=current_user.id,
        created_at=datetime.now(timezone.utc),
    )
    db.add(visit)
    db.commit()
    db.refresh(visit)
    return visit


# ---------------------------------------------------------------------------
# GET /{patient_id} — list all visits for a patient
# ---------------------------------------------------------------------------

@router.get(
    "/{patient_id}",
    response_model=list[VisitResponse],
    summary="获取患者所有随访记录",
)
def list_visits(
    patient_id: int,
    current_user: User = Depends(get_current_user),
    center_filter: Optional[int] = Depends(get_center_filter),
    db: Session = Depends(get_db),
):
    """Return all follow-up visits for a patient, ordered by visit date."""
    _get_patient_checked(patient_id, center_filter, db)

    visits = (
        db.query(FollowUpVisit)
        .filter(FollowUpVisit.patient_id == patient_id)
        .order_by(FollowUpVisit.visit_date.asc())
        .all()
    )
    return visits


# ---------------------------------------------------------------------------
# GET /single/{visit_id} — get a specific visit
# ---------------------------------------------------------------------------

@router.get(
    "/single/{visit_id}",
    response_model=VisitResponse,
    summary="获取单条随访记录",
)
def get_visit(
    visit_id: int,
    current_user: User = Depends(get_current_user),
    center_filter: Optional[int] = Depends(get_center_filter),
    db: Session = Depends(get_db),
):
    """Return a single follow-up visit by its ID."""
    return _get_visit_checked(visit_id, center_filter, db)


# ---------------------------------------------------------------------------
# PUT /{visit_id} — update visit
# ---------------------------------------------------------------------------

@router.put(
    "/{visit_id}",
    response_model=VisitResponse,
    summary="更新随访记录",
)
def update_visit(
    visit_id: int,
    body: VisitUpdate,
    current_user: User = Depends(require_doctor_or_admin),
    center_filter: Optional[int] = Depends(get_center_filter),
    db: Session = Depends(get_db),
):
    """Update an existing follow-up visit record."""
    visit = _get_visit_checked(visit_id, center_filter, db)

    update_data = body.model_dump(exclude_unset=True)
    # Validate visit_type if being changed
    if "visit_type" in update_data and update_data["visit_type"] not in VISIT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"无效的随访类型，允许值: {', '.join(sorted(VISIT_TYPES))}",
        )

    for field, value in update_data.items():
        setattr(visit, field, value)
    db.commit()
    db.refresh(visit)
    return visit


# ---------------------------------------------------------------------------
# DELETE /{visit_id} — delete visit
# ---------------------------------------------------------------------------

@router.delete(
    "/{visit_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除随访记录",
)
def delete_visit(
    visit_id: int,
    current_user: User = Depends(require_doctor_or_admin),
    center_filter: Optional[int] = Depends(get_center_filter),
    db: Session = Depends(get_db),
):
    """Permanently delete a follow-up visit record."""
    visit = _get_visit_checked(visit_id, center_filter, db)
    db.delete(visit)
    db.commit()
