"""Exams router: create, read, and update baseline examinations."""

from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.permissions import get_center_filter, get_current_user, require_doctor_or_admin
from app.database import get_db
from app.models.baseline_exam import BaselineExam
from app.models.patient import Patient
from app.models.user import User

router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class BaselineExamCreate(BaseModel):
    patient_id: int
    exam_date: date

    # Right eye (OD)
    od_sphere: Optional[float] = None
    od_cylinder: Optional[float] = None
    od_axis: Optional[int] = None
    od_va: Optional[float] = None
    od_axial_length: Optional[float] = None
    od_corneal_curvature_flat: Optional[float] = None
    od_corneal_curvature_steep: Optional[float] = None

    # Left eye (OS)
    os_sphere: Optional[float] = None
    os_cylinder: Optional[float] = None
    os_axis: Optional[int] = None
    os_va: Optional[float] = None
    os_axial_length: Optional[float] = None
    os_corneal_curvature_flat: Optional[float] = None
    os_corneal_curvature_steep: Optional[float] = None

    # Lens prescription
    lens_brand: Optional[str] = None
    lens_od_addition: Optional[float] = None
    lens_os_addition: Optional[float] = None


class BaselineExamUpdate(BaseModel):
    exam_date: Optional[date] = None

    od_sphere: Optional[float] = None
    od_cylinder: Optional[float] = None
    od_axis: Optional[int] = None
    od_va: Optional[float] = None
    od_axial_length: Optional[float] = None
    od_corneal_curvature_flat: Optional[float] = None
    od_corneal_curvature_steep: Optional[float] = None

    os_sphere: Optional[float] = None
    os_cylinder: Optional[float] = None
    os_axis: Optional[int] = None
    os_va: Optional[float] = None
    os_axial_length: Optional[float] = None
    os_corneal_curvature_flat: Optional[float] = None
    os_corneal_curvature_steep: Optional[float] = None

    lens_brand: Optional[str] = None
    lens_od_addition: Optional[float] = None
    lens_os_addition: Optional[float] = None


class BaselineExamResponse(BaseModel):
    id: int
    patient_id: int
    exam_date: date

    od_sphere: Optional[float]
    od_cylinder: Optional[float]
    od_axis: Optional[int]
    od_va: Optional[float]
    od_axial_length: Optional[float]
    od_corneal_curvature_flat: Optional[float]
    od_corneal_curvature_steep: Optional[float]

    os_sphere: Optional[float]
    os_cylinder: Optional[float]
    os_axis: Optional[int]
    os_va: Optional[float]
    os_axial_length: Optional[float]
    os_corneal_curvature_flat: Optional[float]
    os_corneal_curvature_steep: Optional[float]

    lens_brand: Optional[str]
    lens_od_addition: Optional[float]
    lens_os_addition: Optional[float]

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
    """Fetch a patient and verify center access; raise 404/403 as needed."""
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


# ---------------------------------------------------------------------------
# POST /baseline — create baseline exam
# ---------------------------------------------------------------------------

@router.post(
    "/baseline",
    response_model=BaselineExamResponse,
    status_code=status.HTTP_201_CREATED,
    summary="录入基线检查",
)
def create_baseline_exam(
    body: BaselineExamCreate,
    current_user: User = Depends(require_doctor_or_admin),
    center_filter: Optional[int] = Depends(get_center_filter),
    db: Session = Depends(get_db),
):
    """Create a baseline exam for a patient.

    Each patient may have at most one baseline exam.  Raises HTTP 400 if one
    already exists.
    """
    _get_patient_checked(body.patient_id, center_filter, db)

    existing = (
        db.query(BaselineExam)
        .filter(BaselineExam.patient_id == body.patient_id)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该患者已存在基线检查记录，不可重复录入",
        )

    exam = BaselineExam(
        **body.model_dump(),
        examiner_id=current_user.id,
        created_at=datetime.now(timezone.utc),
    )
    db.add(exam)
    db.commit()
    db.refresh(exam)
    return exam


# ---------------------------------------------------------------------------
# GET /baseline/{patient_id}
# ---------------------------------------------------------------------------

@router.get(
    "/baseline/{patient_id}",
    response_model=BaselineExamResponse,
    summary="获取患者基线检查",
)
def get_baseline_exam(
    patient_id: int,
    current_user: User = Depends(get_current_user),
    center_filter: Optional[int] = Depends(get_center_filter),
    db: Session = Depends(get_db),
):
    """Return the baseline exam for a given patient."""
    _get_patient_checked(patient_id, center_filter, db)

    exam: Optional[BaselineExam] = (
        db.query(BaselineExam)
        .filter(BaselineExam.patient_id == patient_id)
        .first()
    )
    if not exam:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="该患者尚未录入基线检查数据",
        )
    return exam


# ---------------------------------------------------------------------------
# PUT /baseline/{patient_id}
# ---------------------------------------------------------------------------

@router.put(
    "/baseline/{patient_id}",
    response_model=BaselineExamResponse,
    summary="更新患者基线检查",
)
def update_baseline_exam(
    patient_id: int,
    body: BaselineExamUpdate,
    current_user: User = Depends(require_doctor_or_admin),
    center_filter: Optional[int] = Depends(get_center_filter),
    db: Session = Depends(get_db),
):
    """Update an existing baseline exam record."""
    _get_patient_checked(patient_id, center_filter, db)

    exam: Optional[BaselineExam] = (
        db.query(BaselineExam)
        .filter(BaselineExam.patient_id == patient_id)
        .first()
    )
    if not exam:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="该患者尚未录入基线检查数据，无法更新",
        )

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(exam, field, value)
    db.commit()
    db.refresh(exam)
    return exam
