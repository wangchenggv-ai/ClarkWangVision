"""FollowUp model — post-wear measurements and observations."""

from datetime import datetime
from sqlalchemy import Column, Integer, Float, String, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship

from db import Base


class FollowUp(Base):
    __tablename__ = "followups"

    id = Column(Integer, primary_key=True, autoincrement=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False, index=True)
    calculation_id = Column(Integer, ForeignKey("calculations.id"), nullable=True)

    visit_date = Column(DateTime, default=datetime.utcnow)
    actual_add = Column(Float, nullable=True)       # D, measured ADD
    visual_quality = Column(Float, nullable=True)   # 0.0–1.0 subjective score
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    patient = relationship("Patient", back_populates="followups")

    def __repr__(self):
        return f"<FollowUp #{self.id} Patient #{self.patient_id}>"
