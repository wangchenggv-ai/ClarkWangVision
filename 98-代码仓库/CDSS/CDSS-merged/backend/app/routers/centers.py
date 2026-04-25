"""Centers router: CRUD for research centers plus per-center statistics."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.permissions import get_current_user, require_admin
from app.database import get_db
from app.models.center import Center
from app.models.patient import Patient
from app.models.user import User

router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class CenterCreate(BaseModel):
    name: str
    city: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None


class CenterUpdate(BaseModel):
    name: Optional[str] = None
    city: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    is_active: Optional[bool] = None


class CenterResponse(BaseModel):
    id: int
    name: str
    city: Optional[str]
    contact_name: Optional[str]
    contact_phone: Optional[str]
    is_active: bool

    model_config = {"from_attributes": True}


class CenterStatsResponse(BaseModel):
    center_id: int
    center_name: str
    patient_count: int
    visit_count: int


# ---------------------------------------------------------------------------
# GET /
# ---------------------------------------------------------------------------

@router.get(
    "/",
    response_model=list[CenterResponse],
    summary="获取所有研究中心（仅管理员）",
)
def list_centers(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Return every research center.  Admin only."""
    return db.query(Center).order_by(Center.id).all()


# ---------------------------------------------------------------------------
# POST /
# ---------------------------------------------------------------------------

@router.post(
    "/",
    response_model=CenterResponse,
    status_code=status.HTTP_201_CREATED,
    summary="创建研究中心（仅管理员）",
)
def create_center(
    body: CenterCreate,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Create a new research center.  Admin only."""
    existing = db.query(Center).filter(Center.name == body.name).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"名称为 '{body.name}' 的研究中心已存在",
        )
    center = Center(**body.model_dump())
    db.add(center)
    db.commit()
    db.refresh(center)
    return center


# ---------------------------------------------------------------------------
# GET /{id}
# ---------------------------------------------------------------------------

@router.get(
    "/{center_id}",
    response_model=CenterResponse,
    summary="获取研究中心详情",
)
def get_center(
    center_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return details for a single center.

    Non-admin users may only view their own center.
    """
    center: Optional[Center] = db.get(Center, center_id)
    if not center:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="研究中心不存在",
        )
    if current_user.role != "admin" and current_user.center_id != center_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权查看其他中心的信息",
        )
    return center


# ---------------------------------------------------------------------------
# PUT /{id}
# ---------------------------------------------------------------------------

@router.put(
    "/{center_id}",
    response_model=CenterResponse,
    summary="更新研究中心（仅管理员）",
)
def update_center(
    center_id: int,
    body: CenterUpdate,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Update an existing research center.  Admin only."""
    center: Optional[Center] = db.get(Center, center_id)
    if not center:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="研究中心不存在",
        )
    update_data = body.model_dump(exclude_unset=True)
    # Check name uniqueness if name is being changed
    if "name" in update_data and update_data["name"] != center.name:
        conflict = (
            db.query(Center).filter(Center.name == update_data["name"]).first()
        )
        if conflict:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"名称为 '{update_data['name']}' 的研究中心已存在",
            )
    for field, value in update_data.items():
        setattr(center, field, value)
    db.commit()
    db.refresh(center)
    return center


# ---------------------------------------------------------------------------
# GET /{id}/stats
# ---------------------------------------------------------------------------

@router.get(
    "/{center_id}/stats",
    response_model=CenterStatsResponse,
    summary="获取研究中心统计数据",
)
def get_center_stats(
    center_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return patient count and total follow-up visit count for a center.

    Non-admin users may only query stats for their own center.
    """
    center: Optional[Center] = db.get(Center, center_id)
    if not center:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="研究中心不存在",
        )
    if current_user.role != "admin" and current_user.center_id != center_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权查看其他中心的统计数据",
        )

    # Import here to avoid circular import issues at module load time
    from app.models.patient import Patient  # noqa: PLC0415
    try:
        from app.models.follow_up_visit import FollowUpVisit  # noqa: PLC0415
        visit_count: int = (
            db.query(func.count(FollowUpVisit.id))
            .join(Patient, FollowUpVisit.patient_id == Patient.id)
            .filter(Patient.center_id == center_id)
            .scalar()
            or 0
        )
    except ImportError:
        visit_count = 0

    patient_count: int = (
        db.query(func.count(Patient.id))
        .filter(Patient.center_id == center_id, Patient.is_active.is_(True))
        .scalar()
        or 0
    )

    return CenterStatsResponse(
        center_id=center_id,
        center_name=center.name,
        patient_count=patient_count,
        visit_count=visit_count,
    )
