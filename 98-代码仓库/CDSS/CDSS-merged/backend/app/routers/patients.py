"""Patients router: list, create, read, update, soft-delete, and overdue checks."""

from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auth.permissions import (
    get_center_filter,
    get_current_user,
    require_doctor_or_admin,
)
from app.database import get_db
from app.models.center import Center
from app.models.patient import Patient
from app.models.user import User

router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class PatientCreate(BaseModel):
    name: str
    gender: Optional[str] = None          # male | female
    birth_date: date
    school_grade: Optional[str] = None
    parent_myopia: Optional[str] = None   # none | one | both
    outdoor_hours_per_day: Optional[float] = None
    near_work_hours_per_day: Optional[float] = None
    center_id: Optional[int] = None       # admin may specify; others auto-filled
    notes: Optional[str] = None


class PatientUpdate(BaseModel):
    name: Optional[str] = None
    gender: Optional[str] = None
    birth_date: Optional[date] = None
    school_grade: Optional[str] = None
    parent_myopia: Optional[str] = None
    outdoor_hours_per_day: Optional[float] = None
    near_work_hours_per_day: Optional[float] = None
    notes: Optional[str] = None


class PatientResponse(BaseModel):
    id: int
    patient_no: str
    name: str
    gender: Optional[str]
    birth_date: date
    school_grade: Optional[str]
    parent_myopia: Optional[str]
    outdoor_hours_per_day: Optional[float]
    near_work_hours_per_day: Optional[float]
    center_id: int
    enrolled_by: int
    enrolled_at: datetime
    notes: Optional[str]
    is_active: bool

    model_config = {"from_attributes": True}


class PatientDetailResponse(PatientResponse):
    """Extends PatientResponse with aggregate counts."""
    follow_up_count: int = 0
    has_baseline: bool = False


class PaginatedPatients(BaseModel):
    items: list[PatientResponse]
    total: int
    page: int
    page_size: int


# ---------------------------------------------------------------------------
# Helper: generate patient_no
# ---------------------------------------------------------------------------

def _generate_patient_no(db: Session, center: Center) -> str:
    """Generate a patient number in the format ``{PREFIX}-{YEAR}-{SEQ:04d}``.

    The prefix is derived from the first 3 uppercase letters of the center
    name (ASCII only), falling back to "CTR" if the name has no ASCII letters.
    The sequence number is the count of existing patients in that center this
    year plus one.
    """
    import re

    ascii_letters = re.sub(r"[^A-Za-z]", "", center.name)
    prefix = (ascii_letters[:3].upper()) if ascii_letters else "CTR"
    year = datetime.now(timezone.utc).year

    # Count patients already registered at this center this year
    year_start = datetime(year, 1, 1, tzinfo=timezone.utc)
    year_end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    count: int = (
        db.query(Patient)
        .filter(
            Patient.center_id == center.id,
            Patient.enrolled_at >= year_start,
            Patient.enrolled_at < year_end,
        )
        .count()
    )
    seq = count + 1
    return f"{prefix}-{year}-{seq:04d}"


# ---------------------------------------------------------------------------
# GET /
# ---------------------------------------------------------------------------

@router.get(
    "/",
    response_model=PaginatedPatients,
    summary="获取患者列表（分页+搜索）",
)
def list_patients(
    page: int = Query(1, ge=1, description="页码（从1开始）"),
    page_size: int = Query(20, ge=1, le=200, description="每页记录数"),
    search: Optional[str] = Query(None, description="按姓名或患者编号搜索"),
    center_id: Optional[int] = Query(None, description="按中心筛选（仅管理员有效）"),
    current_user: User = Depends(get_current_user),
    center_filter: Optional[int] = Depends(get_center_filter),
    db: Session = Depends(get_db),
):
    """Return a paginated list of active patients.

    Non-admin users automatically see only their own center's patients.
    Admins may pass ``center_id`` as an additional filter.
    """
    query = db.query(Patient).filter(Patient.is_active.is_(True))

    # Center scoping
    effective_center = center_filter  # None for admin
    if effective_center is not None:
        query = query.filter(Patient.center_id == effective_center)
    elif center_id is not None:
        # Admin explicitly filtering by center
        query = query.filter(Patient.center_id == center_id)

    # Text search
    if search:
        pattern = f"%{search}%"
        query = query.filter(
            or_(Patient.name.ilike(pattern), Patient.patient_no.ilike(pattern))
        )

    total: int = query.count()
    items = (
        query.order_by(Patient.enrolled_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return PaginatedPatients(items=items, total=total, page=page, page_size=page_size)


# ---------------------------------------------------------------------------
# POST /
# ---------------------------------------------------------------------------

@router.post(
    "/",
    response_model=PatientResponse,
    status_code=status.HTTP_201_CREATED,
    summary="创建新患者",
)
def create_patient(
    body: PatientCreate,
    current_user: User = Depends(require_doctor_or_admin),
    db: Session = Depends(get_db),
):
    """Create a new patient record.

    Doctors/viewers have their ``center_id`` set automatically; admins may
    supply an explicit ``center_id``.  A unique ``patient_no`` is generated
    automatically.
    """
    # Determine center
    if current_user.role == "admin":
        if body.center_id is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="管理员创建患者时必须指定 center_id",
            )
        center_id = body.center_id
    else:
        if current_user.center_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="当前账号未关联任何研究中心，请联系管理员",
            )
        center_id = current_user.center_id

    center: Optional[Center] = db.get(Center, center_id)
    if not center or not center.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="指定的研究中心不存在或已停用",
        )

    patient_no = _generate_patient_no(db, center)

    patient = Patient(
        patient_no=patient_no,
        name=body.name,
        gender=body.gender,
        birth_date=body.birth_date,
        school_grade=body.school_grade,
        parent_myopia=body.parent_myopia,
        outdoor_hours_per_day=body.outdoor_hours_per_day,
        near_work_hours_per_day=body.near_work_hours_per_day,
        center_id=center_id,
        enrolled_by=current_user.id,
        notes=body.notes,
        enrolled_at=datetime.now(timezone.utc),
    )
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


# ---------------------------------------------------------------------------
# GET /overdue  (must be declared before /{id} to avoid route conflict)
# ---------------------------------------------------------------------------

@router.get(
    "/overdue",
    response_model=list[PatientDetailResponse],
    summary="获取随访逾期患者",
)
def list_overdue_patients(
    current_user: User = Depends(get_current_user),
    center_filter: Optional[int] = Depends(get_center_filter),
    db: Session = Depends(get_db),
):
    """Return patients who have missed an expected follow-up visit.

    Rules:
    - Enrolled > 30 days ago without a 1-month visit.
    - Enrolled > 90 days ago without a 3-month visit.
    - Enrolled > 180 days ago without a 6-month visit.
    - Enrolled > 365 days ago without a 12-month visit.
    """
    # Import here to avoid circular import at module level
    try:
        from app.models.follow_up_visit import FollowUpVisit  # noqa: PLC0415
    except ImportError:
        return []

    now = datetime.now(timezone.utc)
    thresholds = [
        (30, "1M"),
        (90, "3M"),
        (180, "6M"),
        (365, "12M"),
    ]

    base_query = db.query(Patient).filter(Patient.is_active.is_(True))
    if center_filter is not None:
        base_query = base_query.filter(Patient.center_id == center_filter)

    overdue_patients: list[PatientDetailResponse] = []
    seen_ids: set[int] = set()

    for days, visit_type in thresholds:
        cutoff = now - timedelta(days=days)
        # Patients enrolled before the cutoff
        candidates = base_query.filter(Patient.enrolled_at <= cutoff).all()

        for patient in candidates:
            if patient.id in seen_ids:
                continue
            # Check if the required visit type exists
            has_visit = (
                db.query(FollowUpVisit)
                .filter(
                    FollowUpVisit.patient_id == patient.id,
                    FollowUpVisit.visit_type == visit_type,
                )
                .first()
            )
            if not has_visit:
                visit_count = (
                    db.query(FollowUpVisit)
                    .filter(FollowUpVisit.patient_id == patient.id)
                    .count()
                )
                from app.models.baseline_exam import BaselineExam  # noqa: PLC0415
                has_baseline = (
                    db.query(BaselineExam)
                    .filter(BaselineExam.patient_id == patient.id)
                    .first()
                    is not None
                )
                overdue_patients.append(
                    PatientDetailResponse(
                        **PatientResponse.model_validate(patient).model_dump(),
                        follow_up_count=visit_count,
                        has_baseline=has_baseline,
                    )
                )
                seen_ids.add(patient.id)

    return overdue_patients


# ---------------------------------------------------------------------------
# GET /{id}
# ---------------------------------------------------------------------------

@router.get(
    "/{patient_id}",
    response_model=PatientDetailResponse,
    summary="获取患者详情",
)
def get_patient(
    patient_id: int,
    current_user: User = Depends(get_current_user),
    center_filter: Optional[int] = Depends(get_center_filter),
    db: Session = Depends(get_db),
):
    """Return full details for a single patient including visit counts."""
    patient: Optional[Patient] = db.get(Patient, patient_id)
    if not patient or not patient.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="患者不存在",
        )
    if center_filter is not None and patient.center_id != center_filter:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权查看其他中心的患者信息",
        )

    visit_count = 0
    has_baseline = False
    try:
        from app.models.follow_up_visit import FollowUpVisit  # noqa: PLC0415
        visit_count = (
            db.query(FollowUpVisit)
            .filter(FollowUpVisit.patient_id == patient_id)
            .count()
        )
    except ImportError:
        pass
    try:
        from app.models.baseline_exam import BaselineExam  # noqa: PLC0415
        has_baseline = (
            db.query(BaselineExam)
            .filter(BaselineExam.patient_id == patient_id)
            .first()
            is not None
        )
    except ImportError:
        pass

    return PatientDetailResponse(
        **PatientResponse.model_validate(patient).model_dump(),
        follow_up_count=visit_count,
        has_baseline=has_baseline,
    )


# ---------------------------------------------------------------------------
# PUT /{id}
# ---------------------------------------------------------------------------

@router.put(
    "/{patient_id}",
    response_model=PatientResponse,
    summary="更新患者信息",
)
def update_patient(
    patient_id: int,
    body: PatientUpdate,
    current_user: User = Depends(require_doctor_or_admin),
    center_filter: Optional[int] = Depends(get_center_filter),
    db: Session = Depends(get_db),
):
    """Update demographic / lifestyle information for a patient."""
    patient: Optional[Patient] = db.get(Patient, patient_id)
    if not patient or not patient.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="患者不存在",
        )
    if center_filter is not None and patient.center_id != center_filter:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权修改其他中心的患者信息",
        )
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(patient, field, value)
    db.commit()
    db.refresh(patient)
    return patient


# ---------------------------------------------------------------------------
# DELETE /{id}
# ---------------------------------------------------------------------------

@router.delete(
    "/{patient_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="软删除患者（设置 is_active=False）",
)
def delete_patient(
    patient_id: int,
    current_user: User = Depends(require_doctor_or_admin),
    center_filter: Optional[int] = Depends(get_center_filter),
    db: Session = Depends(get_db),
):
    """Soft-delete a patient by setting ``is_active = False``."""
    patient: Optional[Patient] = db.get(Patient, patient_id)
    if not patient or not patient.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="患者不存在",
        )
    if center_filter is not None and patient.center_id != center_filter:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权删除其他中心的患者",
        )
    patient.is_active = False
    db.commit()
