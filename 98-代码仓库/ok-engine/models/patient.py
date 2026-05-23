"""Patient model — core entity for OK lens fitting."""

from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, Enum as SAEnum
from sqlalchemy.orm import relationship
import enum

from db import Base


class Design(str, enum.Enum):
    CF = "CF"
    CN = "CN"


class ProfileSource(str, enum.Enum):
    PARAMETRIC = "parametric"       # from K/e/sphere parameters
    TOPOGRAPHY = "topography"       # from real corneal height map


class Eye(str, enum.Enum):
    OD = "OD"
    OS = "OS"


class Patient(Base):
    __tablename__ = "patients"

    id = Column(Integer, primary_key=True, autoincrement=True)
    patient_id = Column(String(20), unique=True, nullable=False, index=True)  # e.g. "PT-001"
    age = Column(Integer, nullable=False)
    eye = Column(SAEnum(Eye), nullable=False, default=Eye.OD)

    # Corneal parameters
    k1 = Column(Float, nullable=False)          # mm, flat keratometry
    k2 = Column(Float, nullable=False)          # mm, steep keratometry
    e_value = Column(Float, nullable=False)     # eccentricity
    hvid = Column(Float, nullable=False)         # mm, horizontal visible iris diameter
    epi_central = Column(Float, nullable=False) # μm, central epithelial thickness
    pupil = Column(Float, nullable=False)        # mm, photopic pupil diameter

    # Refraction
    sph = Column(Float, nullable=False)          # D, sphere (negative for myopia)
    cyl = Column(Float, nullable=False, default=0.0)  # D, cylinder
    add_target = Column(Float, nullable=False)   # D, desired ADD power

    # Design choice
    design = Column(SAEnum(Design), nullable=False, default=Design.CN)

    # Data source for epithelial modelling
    profile_source = Column(SAEnum(ProfileSource), nullable=False, default=ProfileSource.PARAMETRIC)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    calculations = relationship("Calculation", back_populates="patient", cascade="all, delete-orphan")
    followups = relationship("FollowUp", back_populates="patient", cascade="all, delete-orphan")

    @property
    def avg_k(self) -> float:
        return round((self.k1 + self.k2) / 2, 2)

    def __repr__(self):
        return f"<Patient {self.patient_id} {self.design.value} {self.eye.value}>"
