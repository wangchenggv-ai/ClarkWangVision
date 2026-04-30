"""Export router: stream all patient + exam + visit data as a wide-format CSV."""

import csv
import io
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.auth.permissions import get_center_filter, require_doctor_or_admin
from app.database import get_db
from app.models.baseline_exam import BaselineExam
from app.models.center import Center
from app.models.follow_up_visit import FollowUpVisit
from app.models.patient import Patient
from app.models.user import User

router = APIRouter()

# Follow-up visit types in chronological order (used for column generation)
VISIT_TYPES_ORDERED = ["1M", "3M", "6M", "12M"]

# Per-visit columns emitted in the wide export
VISIT_EYE_COLS = [
    "od_sphere",
    "od_cylinder",
    "od_axis",
    "od_va",
    "od_axial_length",
    "os_sphere",
    "os_cylinder",
    "os_axis",
    "os_va",
    "os_axial_length",
]


def _build_header() -> list[str]:
    """Return the ordered list of CSV column names."""
    base_cols = [
        "patient_no",
        "name",
        "gender",
        "birth_date",
        "school_grade",
        "parent_myopia",
        "outdoor_hours",
        "near_work_hours",
        "center_name",
        # Baseline exam
        "baseline_date",
        "od_sphere",
        "od_cylinder",
        "od_axis",
        "od_va",
        "od_axial_length",
        "od_k1",
        "od_k2",
        "os_sphere",
        "os_cylinder",
        "os_axis",
        "os_va",
        "os_axial_length",
        "os_k1",
        "os_k2",
        "lens_brand",
        "lens_od_addition",
        "lens_os_addition",
    ]

    visit_cols: list[str] = []
    for vtype in VISIT_TYPES_ORDERED:
        prefix = vtype.lower()  # e.g. "1m"
        visit_cols.append(f"{prefix}_date")
        for col in VISIT_EYE_COLS:
            visit_cols.append(f"{prefix}_{col}")
        visit_cols.append(f"{prefix}_wearing_hours")

    return base_cols + visit_cols


def _safe(value) -> str:
    """Convert a value to a CSV-safe string, using empty string for None."""
    if value is None:
        return ""
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value)


def _build_row(
    patient: Patient,
    center_name: str,
    baseline: Optional[BaselineExam],
    visits_by_type: dict[str, FollowUpVisit],
) -> list[str]:
    """Build one CSV row for the given patient."""
    row: list[str] = [
        _safe(patient.patient_no),
        _safe(patient.name),
        _safe(patient.gender),
        _safe(patient.birth_date),
        _safe(patient.school_grade),
        _safe(patient.parent_myopia),
        _safe(patient.outdoor_hours_per_day),
        _safe(patient.near_work_hours_per_day),
        center_name,
    ]

    # Baseline columns
    if baseline:
        row += [
            _safe(baseline.exam_date),
            _safe(baseline.od_sphere),
            _safe(baseline.od_cylinder),
            _safe(baseline.od_axis),
            _safe(baseline.od_va),
            _safe(baseline.od_axial_length),
            _safe(baseline.od_corneal_curvature_flat),
            _safe(baseline.od_corneal_curvature_steep),
            _safe(baseline.os_sphere),
            _safe(baseline.os_cylinder),
            _safe(baseline.os_axis),
            _safe(baseline.os_va),
            _safe(baseline.os_axial_length),
            _safe(baseline.os_corneal_curvature_flat),
            _safe(baseline.os_corneal_curvature_steep),
            _safe(baseline.lens_brand),
            _safe(baseline.lens_od_addition),
            _safe(baseline.lens_os_addition),
        ]
    else:
        row += [""] * 18  # 18 baseline columns after patient_no block

    # Follow-up visit columns
    for vtype in VISIT_TYPES_ORDERED:
        visit = visits_by_type.get(vtype)
        if visit:
            row += [
                _safe(visit.visit_date),
                _safe(visit.od_sphere),
                _safe(visit.od_cylinder),
                _safe(visit.od_axis),
                _safe(visit.od_va),
                _safe(visit.od_axial_length),
                _safe(visit.os_sphere),
                _safe(visit.os_cylinder),
                _safe(visit.os_axis),
                _safe(visit.os_va),
                _safe(visit.os_axial_length),
                _safe(visit.wearing_hours_per_day),
            ]
        else:
            row += [""] * 12  # date + 10 eye cols + wearing_hours

    return row


def _generate_csv(
    db: Session,
    center_filter: Optional[int],
    admin_center_id: Optional[int],
    start_date: Optional[date],
    end_date: Optional[date],
):
    """Generator that yields CSV text line-by-line for use in StreamingResponse."""
    # Build query
    query = db.query(Patient).filter(Patient.is_active.is_(True))

    effective_center = center_filter  # None for admin
    if effective_center is not None:
        query = query.filter(Patient.center_id == effective_center)
    elif admin_center_id is not None:
        query = query.filter(Patient.center_id == admin_center_id)

    if start_date:
        query = query.filter(Patient.enrolled_at >= datetime(start_date.year, start_date.month, start_date.day, tzinfo=timezone.utc))
    if end_date:
        query = query.filter(Patient.enrolled_at <= datetime(end_date.year, end_date.month, end_date.day, 23, 59, 59, tzinfo=timezone.utc))

    patients = query.order_by(Patient.patient_no).all()

    # Pre-fetch all relevant centers
    center_ids = {p.center_id for p in patients}
    centers: dict[int, str] = {}
    for cid in center_ids:
        c = db.get(Center, cid)
        if c:
            centers[cid] = c.name

    # Stream header
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(_build_header())
    yield output.getvalue()
    output.seek(0)
    output.truncate(0)

    for patient in patients:
        # Fetch baseline
        baseline: Optional[BaselineExam] = (
            db.query(BaselineExam)
            .filter(BaselineExam.patient_id == patient.id)
            .first()
        )
        # Fetch visits indexed by type
        raw_visits = (
            db.query(FollowUpVisit)
            .filter(FollowUpVisit.patient_id == patient.id)
            .all()
        )
        visits_by_type: dict[str, FollowUpVisit] = {v.visit_type: v for v in raw_visits}

        center_name = centers.get(patient.center_id, "")
        row = _build_row(patient, center_name, baseline, visits_by_type)

        writer.writerow(row)
        yield output.getvalue()
        output.seek(0)
        output.truncate(0)


# ---------------------------------------------------------------------------
# GET /csv
# ---------------------------------------------------------------------------

@router.get(
    "/csv",
    summary="导出数据为 CSV（管理员或医生）",
    response_class=StreamingResponse,
)
def export_csv(
    center_id: Optional[int] = Query(None, description="按中心筛选（仅管理员有效）"),
    start_date: Optional[date] = Query(None, description="入组开始日期（含）"),
    end_date: Optional[date] = Query(None, description="入组结束日期（含）"),
    current_user: User = Depends(require_doctor_or_admin),
    center_filter: Optional[int] = Depends(get_center_filter),
    db: Session = Depends(get_db),
):
    """Export all patient data (baseline + follow-up visits) as a wide-format CSV.

    Each patient occupies one row.  Baseline exam data and each follow-up visit
    type (1M, 3M, 6M, 12M) are flattened into separate column groups.

    The file is streamed directly to avoid buffering the entire result set in
    memory.
    """
    if start_date and end_date and start_date > end_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="开始日期不能晚于结束日期",
        )

    # Non-admin users cannot override center_id; it is already fixed by center_filter
    admin_center_override = center_id if current_user.role == "admin" else None

    today_str = datetime.now(timezone.utc).strftime("%Y%m%d")
    filename = f"myopia_data_{today_str}.csv"

    return StreamingResponse(
        content=_generate_csv(db, center_filter, admin_center_override, start_date, end_date),
        media_type="text/csv; charset=utf-8-sig",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )
