"""SQLAlchemy model for platform users (admins, doctors, viewers)."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database import Base


class User(Base):
    """Platform user.  Role is one of: 'admin', 'doctor', 'viewer'."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # admin | doctor | viewer
    center_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("centers.id", ondelete="SET NULL"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=func.now(), nullable=False
    )
    last_login: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Relationships
    center: Mapped["Center"] = relationship(  # noqa: F821
        "Center", back_populates="users", lazy="select"
    )
    enrolled_patients: Mapped[list["Patient"]] = relationship(  # noqa: F821
        "Patient",
        foreign_keys="Patient.enrolled_by",
        back_populates="enrolled_by_user",
        lazy="select",
    )
    baseline_exams: Mapped[list["BaselineExam"]] = relationship(  # noqa: F821
        "BaselineExam", back_populates="examiner", lazy="select"
    )
    follow_up_visits: Mapped[list["FollowUpVisit"]] = relationship(  # noqa: F821
        "FollowUpVisit", back_populates="examiner", lazy="select"
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} username={self.username!r} role={self.role!r}>"
