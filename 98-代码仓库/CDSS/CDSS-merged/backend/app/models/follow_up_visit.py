"""SQLAlchemy model for follow-up visits."""

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database import Base


class FollowUpVisit(Base):
    """Periodic follow-up visit for a patient wearing defocus lenses.

    visit_type values: '1M', '3M', '6M', '12M', 'other'
    One record per (patient_id, visit_type) enforced by a unique constraint.
    """

    __tablename__ = "follow_up_visits"
    __table_args__ = (
        UniqueConstraint("patient_id", "visit_type", name="uq_visit_patient_type"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patient_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("patients.id", ondelete="CASCADE"), nullable=False
    )
    visit_type: Mapped[str] = mapped_column(
        String(10), nullable=False  # 1M | 3M | 6M | 12M | other
    )
    visit_date: Mapped[date] = mapped_column(Date, nullable=False)

    # ── Right eye (OD) ────────────────────────────────────────────────────────
    od_sphere: Mapped[float | None] = mapped_column(Float, nullable=True)
    od_cylinder: Mapped[float | None] = mapped_column(Float, nullable=True)
    od_axis: Mapped[int | None] = mapped_column(Integer, nullable=True)
    od_va: Mapped[float | None] = mapped_column(Float, nullable=True)
    od_axial_length: Mapped[float | None] = mapped_column(Float, nullable=True)

    # ── Left eye (OS) ─────────────────────────────────────────────────────────
    os_sphere: Mapped[float | None] = mapped_column(Float, nullable=True)
    os_cylinder: Mapped[float | None] = mapped_column(Float, nullable=True)
    os_axis: Mapped[int | None] = mapped_column(Integer, nullable=True)
    os_va: Mapped[float | None] = mapped_column(Float, nullable=True)
    os_axial_length: Mapped[float | None] = mapped_column(Float, nullable=True)

    # ── Compliance & clinical notes ───────────────────────────────────────────
    wearing_hours_per_day: Mapped[float | None] = mapped_column(Float, nullable=True)
    compliance_good: Mapped[bool | None] = mapped_column(Boolean, nullable=True)  # 佩戴依从性
    complaints: Mapped[str | None] = mapped_column(Text, nullable=True)
    examiner_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Audit ─────────────────────────────────────────────────────────────────
    examiner_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=func.now(), nullable=False
    )

    # Relationships
    patient: Mapped["Patient"] = relationship(  # noqa: F821
        "Patient", back_populates="follow_up_visits", lazy="select"
    )
    examiner: Mapped["User"] = relationship(  # noqa: F821
        "User", back_populates="follow_up_visits", lazy="select"
    )

    def __repr__(self) -> str:
        return (
            f"<FollowUpVisit id={self.id} patient_id={self.patient_id} "
            f"visit_type={self.visit_type!r} visit_date={self.visit_date}>"
        )
