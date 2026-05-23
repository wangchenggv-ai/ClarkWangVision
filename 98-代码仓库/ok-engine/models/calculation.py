"""Calculation model — snapshot of lens parameters for a patient."""

from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from db import Base


class Calculation(Base):
    __tablename__ = "calculations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False, index=True)

    # Lens geometry
    bozr1 = Column(Float, nullable=False)   # mm, central zone radius
    bozr2 = Column(Float, nullable=False)   # mm, para-central zone radius
    rc1 = Column(Float, nullable=False)     # mm, inner reverse curve
    rc2 = Column(Float, nullable=False)     # mm, outer reverse curve
    fa = Column(Float, nullable=False)      # mm, fitting arc / landing zone
    pa = Column(Float, nullable=False)      # mm, peripheral arc
    td = Column(Float, nullable=False)      # mm, total diameter

    # Predictions
    predicted_add = Column(Float, nullable=False)   # D
    night_glare = Column(String(10), nullable=False)  # 高/中/低
    fit_score = Column(String(10), nullable=False)    # 优/可/差

    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    patient = relationship("Patient", back_populates="calculations")

    def __repr__(self):
        return f"<Calculation #{self.id} for Patient #{self.patient_id}>"
