"""Patient management API endpoints."""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from db import get_db
from models.patient import Patient, Design, Eye
from models.calculation import Calculation
from models.schemas import (
    PatientCreate,
    PatientUpdate,
    PatientResponse,
    PatientSummary,
    LensParamsResponse,
    CalculationResponse,
)
from engine.lens_params import calculate_lens_params

router = APIRouter(prefix="/api/patients", tags=["patients"])


@router.get("/", response_model=List[PatientSummary])
def list_patients(
    design: Optional[str] = Query(None, description="Filter by design (CF/CN)"),
    db: Session = Depends(get_db),
):
    """List all patients, optionally filtered by design."""
    q = db.query(Patient)
    if design:
        q = q.filter(Patient.design == Design(design.upper()))
    return q.order_by(Patient.patient_id).all()


@router.get("/{patient_id}", response_model=PatientResponse)
def get_patient(patient_id: int, db: Session = Depends(get_db)):
    """Get a single patient by database ID."""
    patient = db.query(Patient).filter(Patient.id == patient_id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    return patient


@router.post("/", response_model=PatientResponse, status_code=201)
def create_patient(data: PatientCreate, db: Session = Depends(get_db)):
    """Create a new patient record."""
    existing = db.query(Patient).filter(Patient.patient_id == data.patient_id).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Patient {data.patient_id} already exists")

    patient = Patient(**data.model_dump())
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


@router.put("/{patient_id}", response_model=PatientResponse)
def update_patient(patient_id: int, data: PatientUpdate, db: Session = Depends(get_db)):
    """Update an existing patient."""
    patient = db.query(Patient).filter(Patient.id == patient_id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(patient, key, value)

    db.commit()
    db.refresh(patient)
    return patient


@router.delete("/{patient_id}", status_code=204)
def delete_patient(patient_id: int, db: Session = Depends(get_db)):
    """Delete a patient and all associated calculations/followups."""
    patient = db.query(Patient).filter(Patient.id == patient_id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    db.delete(patient)
    db.commit()


@router.post("/{patient_id}/calculate", response_model=LensParamsResponse)
def calculate_for_patient(
    patient_id: int,
    seed: Optional[int] = Query(None, description="Random seed for reproducibility"),
    db: Session = Depends(get_db),
):
    """
    Run the full lens parameter calculation for a patient.
    Saves the result as a Calculation record and returns it.
    """
    patient = db.query(Patient).filter(Patient.id == patient_id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    params = calculate_lens_params(
        k1=patient.k1,
        k2=patient.k2,
        sph=patient.sph,
        cyl=patient.cyl,
        e_value=patient.e_value,
        hvid=patient.hvid,
        epi_central=patient.epi_central,
        pupil=patient.pupil,
        add_target=patient.add_target,
        design=patient.design.value,
        seed=seed,
    )

    # Save calculation record
    calc = Calculation(
        patient_id=patient.id,
        bozr1=params['bozr1'],
        bozr2=params['bozr2'],
        rc1=params['rc1'],
        rc2=params['rc2'],
        fa=params['fa'],
        pa=params['pa'],
        td=params['td'],
        predicted_add=params['predicted_add'],
        night_glare=params['night_glare'],
        fit_score=params['fit_score'],
    )
    db.add(calc)
    db.commit()
    db.refresh(calc)

    return LensParamsResponse(
        patient=PatientResponse.model_validate(patient),
        calculation=CalculationResponse.model_validate(calc),
        actual_add=params['actual_add'],
    )


@router.get("/{patient_id}/calculations", response_model=List[CalculationResponse])
def get_patient_calculations(patient_id: int, db: Session = Depends(get_db)):
    """Get all calculation history for a patient."""
    patient = db.query(Patient).filter(Patient.id == patient_id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    return patient.calculations


@router.get("/{patient_id}/export")
def export_patient_data(patient_id: int, db: Session = Depends(get_db)):
    """
    Export complete patient data including calculations and followups
    as a structured JSON for external use (reports, analysis).
    """
    patient = db.query(Patient).filter(Patient.id == patient_id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    return {
        "patient": PatientResponse.model_validate(patient).model_dump(),
        "calculations": [
            CalculationResponse.model_validate(c).model_dump()
            for c in patient.calculations
        ],
        "followups": [
            {
                "id": f.id,
                "visit_date": f.visit_date.isoformat() if f.visit_date else None,
                "actual_add": f.actual_add,
                "visual_quality": f.visual_quality,
                "notes": f.notes,
            }
            for f in patient.followups
        ],
    }
