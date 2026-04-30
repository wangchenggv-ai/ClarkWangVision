"""SQLAlchemy model for myopia patients."""

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database import Base


class Patient(Base):
    """Patient enrolled in a defocus lens study at a research center."""

    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patient_no: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    gender: Mapped[str | None] = mapped_column(String(10), nullable=True)  # male | female
    birth_date: Mapped[date] = mapped_column(Date, nullable=False)
    school_grade: Mapped[str | None] = mapped_column(String(50), nullable=True)  # e.g. 小学三年级
    parent_myopia: Mapped[str | None] = mapped_column(
        String(20), nullable=True  # none | one | both
    )
    outdoor_hours_per_day: Mapped[float | None] = mapped_column(Float, nullable=True)
    near_work_hours_per_day: Mapped[float | None] = mapped_column(Float, nullable=True)
    center_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("centers.id", ondelete="RESTRICT"), nullable=False
    )
    enrolled_by: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    enrolled_at: Mapped[datetime] = mapped_column(
        DateTime, default=func.now(), nullable=False
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Relationships
    center: Mapped["Center"] = relationship(  # noqa: F821
        "Center", back_populates="patients", lazy="select"
    )
    enrolled_by_user: Mapped["User"] = relationship(  # noqa: F821
        "User",
        foreign_keys=[enrolled_by],
        back_populates="enrolled_patients",
        lazy="select",
    )
    baseline_exams: Mapped[list["BaselineExam"]] = relationship(  # noqa: F821
        "BaselineExam",
        back_populates="patient",
        cascade="all, delete-orphan",
        lazy="select",
    )
    follow_up_visits: Mapped[list["FollowUpVisit"]] = relationship(  # noqa: F821
        "FollowUpVisit",
        back_populates="patient",
        cascade="all, delete-orphan",
        lazy="select",
    )
    risk_scores: Mapped[list["RiskScore"]] = relationship(  # noqa: F821
        "RiskScore",
        back_populates="patient",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<Patient id={self.id} patient_no={self.patient_no!r} name={self.name!r}>"
