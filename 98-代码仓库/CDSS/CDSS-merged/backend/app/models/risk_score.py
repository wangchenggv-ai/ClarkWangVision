"""SQLAlchemy model for AI-generated patient risk scores."""

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database import Base


class RiskScore(Base):
    """Model-generated risk assessment for a patient.

    progression_risk: 'high' | 'medium' | 'low'
    lens_response:    'effective' | 'moderate' | 'ineffective'
    """

    __tablename__ = "risk_scores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patient_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("patients.id", ondelete="CASCADE"), nullable=False
    )

    # ── Risk classification ───────────────────────────────────────────────────
    progression_risk: Mapped[str | None] = mapped_column(
        String(10), nullable=True  # high | medium | low
    )
    progression_confidence: Mapped[float | None] = mapped_column(
        Float, nullable=True  # 0.0 – 1.0
    )
    lens_response: Mapped[str | None] = mapped_column(
        String(10), nullable=True  # effective | moderate | ineffective
    )
    lens_response_confidence: Mapped[float | None] = mapped_column(
        Float, nullable=True  # 0.0 – 1.0
    )

    # ── Model metadata ────────────────────────────────────────────────────────
    model_version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    scored_at: Mapped[datetime] = mapped_column(
        DateTime, default=func.now(), nullable=False
    )
    scored_by_model: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Relationships
    patient: Mapped["Patient"] = relationship(  # noqa: F821
        "Patient", back_populates="risk_scores", lazy="select"
    )

    def __repr__(self) -> str:
        return (
            f"<RiskScore id={self.id} patient_id={self.patient_id} "
            f"progression_risk={self.progression_risk!r} "
            f"lens_response={self.lens_response!r}>"
        )
