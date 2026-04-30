"""SQLAlchemy model for baseline eye examinations."""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database import Base


class BaselineExam(Base):
    """Baseline ophthalmic examination — one per patient, taken at enrollment.

    OD = oculus dexter (right eye)
    OS = oculus sinister (left eye)
    """

    __tablename__ = "baseline_exams"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patient_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("patients.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,  # exactly one baseline per patient
    )
    exam_date: Mapped[date] = mapped_column(Date, nullable=False)

    # ── Right eye (OD) ────────────────────────────────────────────────────────
    od_sphere: Mapped[float | None] = mapped_column(Float, nullable=True)  # 球镜 D
    od_cylinder: Mapped[float | None] = mapped_column(Float, nullable=True)  # 柱镜 D
    od_axis: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 轴向 °
    od_va: Mapped[float | None] = mapped_column(Float, nullable=True)  # 视力
    od_axial_length: Mapped[float | None] = mapped_column(Float, nullable=True)  # 眼轴 mm
    od_corneal_curvature_flat: Mapped[float | None] = mapped_column(
        Float, nullable=True  # 角膜曲率 K1 (flat meridian) D
    )
    od_corneal_curvature_steep: Mapped[float | None] = mapped_column(
        Float, nullable=True  # 角膜曲率 K2 (steep meridian) D
    )

    # ── Left eye (OS) ─────────────────────────────────────────────────────────
    os_sphere: Mapped[float | None] = mapped_column(Float, nullable=True)
    os_cylinder: Mapped[float | None] = mapped_column(Float, nullable=True)
    os_axis: Mapped[int | None] = mapped_column(Integer, nullable=True)
    os_va: Mapped[float | None] = mapped_column(Float, nullable=True)
    os_axial_length: Mapped[float | None] = mapped_column(Float, nullable=True)
    os_corneal_curvature_flat: Mapped[float | None] = mapped_column(Float, nullable=True)
    os_corneal_curvature_steep: Mapped[float | None] = mapped_column(Float, nullable=True)

    # ── Lens prescription ─────────────────────────────────────────────────────
    lens_brand: Mapped[str | None] = mapped_column(String(200), nullable=True)
    lens_od_addition: Mapped[float | None] = mapped_column(Float, nullable=True)
    lens_os_addition: Mapped[float | None] = mapped_column(Float, nullable=True)

    # ── Audit ─────────────────────────────────────────────────────────────────
    examiner_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=func.now(), nullable=False
    )

    # Relationships
    patient: Mapped["Patient"] = relationship(  # noqa: F821
        "Patient", back_populates="baseline_exams", lazy="select"
    )
    examiner: Mapped["User"] = relationship(  # noqa: F821
        "User", back_populates="baseline_exams", lazy="select"
    )

    def __repr__(self) -> str:
        return (
            f"<BaselineExam id={self.id} patient_id={self.patient_id} "
            f"exam_date={self.exam_date}>"
        )
