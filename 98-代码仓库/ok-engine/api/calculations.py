"""Cohort analysis API endpoints."""

from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from db import get_db
from models.patient import Patient, Design
from models.calculation import Calculation
from models.followup import FollowUp
from models.schemas import PatientSummary, CalculationResponse, FollowUpResponse, CohortStats

router = APIRouter(prefix="/api/cohort", tags=["cohort"])


@router.get("/stats", response_model=CohortStats)
def cohort_statistics(db: Session = Depends(get_db)):
    """Aggregate statistics across all patients."""
    patients = db.query(Patient).all()
    total = len(patients)
    cf_count = sum(1 for p in patients if p.design == Design.CF)
    cn_count = total - cf_count

    # Use the latest calculation for each patient
    calcs = db.query(Calculation).all()
    if calcs:
        avg_pred = sum(c.predicted_add for c in calcs) / len(calcs)
    else:
        avg_pred = 0.0

    fups = db.query(FollowUp).filter(FollowUp.actual_add.isnot(None)).all()
    if fups:
        avg_actual = sum(f.actual_add for f in fups) / len(fups)
    else:
        avg_actual = 0.0

    # ADD achievement rate
    rates = []
    for p in patients:
        latest_calc = (
            db.query(Calculation)
            .filter(Calculation.patient_id == p.id)
            .order_by(Calculation.created_at.desc())
            .first()
        )
        if latest_calc and p.add_target > 0:
            rates.append(latest_calc.predicted_add / p.add_target)

    achievement = sum(rates) / len(rates) if rates else 0.0

    return CohortStats(
        total_patients=total,
        cf_count=cf_count,
        cn_count=cn_count,
        avg_predicted_add=round(avg_pred, 2),
        avg_actual_add=round(avg_actual, 2),
        add_achievement_rate=round(achievement, 2),
    )


@router.get("/compare")
def compare_designs(
    sph: float = Query(-1.50, description="Sphere power (D)"),
    add_target: float = Query(1.00, description="ADD target (D)"),
    epi_central: float = Query(50, description="Central epithelial thickness (μm)"),
    pupil: float = Query(2.6, description="Pupil diameter (mm)"),
    k1: float = Query(7.82, description="Flat K (mm)"),
    k2: float = Query(7.70, description="Steep K (mm)"),
    e_value: float = Query(0.42, description="Eccentricity"),
):
    """
    Compare CF vs CN designs for the same input parameters.
    Returns calculated lens params for both designs side by side.
    """
    from engine.lens_params import calculate_lens_params

    cf_result = calculate_lens_params(
        k1=k1, k2=k2, sph=sph, cyl=0, e_value=e_value,
        hvid=11.8, epi_central=epi_central, pupil=pupil,
        add_target=add_target, design='CF', seed=1,
    )
    cn_result = calculate_lens_params(
        k1=k1, k2=k2, sph=sph, cyl=0, e_value=e_value,
        hvid=11.8, epi_central=epi_central, pupil=pupil,
        add_target=add_target, design='CN', seed=1,
    )

    return {
        "input": {
            "sph": sph, "add_target": add_target, "epi_central": epi_central,
            "pupil": pupil, "k1": k1, "k2": k2, "e_value": e_value,
        },
        "CF": cf_result,
        "CN": cn_result,
    }
