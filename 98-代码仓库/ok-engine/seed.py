"""Seed the database with 10 simulated patients from the original HTML prototype.

Usage:
    python seed.py          # seed with defaults
    python seed.py --reset  # drop existing data first
"""

import sys
from pathlib import Path

# Ensure we can import from the project root
sys.path.insert(0, str(Path(__file__).resolve().parent))

from db import engine, SessionLocal, Base
from models.patient import Patient, Design, Eye
from engine.lens_params import calculate_lens_params
from models.calculation import Calculation

PATIENTS_SEED = [
    {"patient_id": "PT-001", "age": 46, "eye": Eye.OD, "k1": 7.82, "k2": 7.70, "e_value": 0.44,
     "hvid": 11.8, "epi_central": 52, "pupil": 2.5, "sph": -1.50, "cyl": -0.25,
     "add_target": 1.00, "design": Design.CN},
    {"patient_id": "PT-002", "age": 42, "eye": Eye.OS, "k1": 7.65, "k2": 7.55, "e_value": 0.38,
     "hvid": 11.6, "epi_central": 50, "pupil": 2.8, "sph": -4.00, "cyl": -0.50,
     "add_target": 1.00, "design": Design.CF},
    {"patient_id": "PT-003", "age": 48, "eye": Eye.OD, "k1": 7.90, "k2": 7.78, "e_value": 0.50,
     "hvid": 12.0, "epi_central": 55, "pupil": 2.4, "sph": -1.25, "cyl": 0.00,
     "add_target": 1.25, "design": Design.CN},
    {"patient_id": "PT-004", "age": 44, "eye": Eye.OS, "k1": 7.72, "k2": 7.60, "e_value": 0.42,
     "hvid": 11.7, "epi_central": 48, "pupil": 3.0, "sph": -3.50, "cyl": -0.75,
     "add_target": 1.00, "design": Design.CF},
    {"patient_id": "PT-005", "age": 50, "eye": Eye.OD, "k1": 7.58, "k2": 7.45, "e_value": 0.36,
     "hvid": 11.5, "epi_central": 46, "pupil": 2.6, "sph": -2.75, "cyl": -0.25,
     "add_target": 1.50, "design": Design.CF},
    {"patient_id": "PT-006", "age": 45, "eye": Eye.OS, "k1": 8.02, "k2": 7.88, "e_value": 0.48,
     "hvid": 12.1, "epi_central": 54, "pupil": 2.7, "sph": -1.75, "cyl": 0.00,
     "add_target": 1.00, "design": Design.CN},
    {"patient_id": "PT-007", "age": 43, "eye": Eye.OD, "k1": 7.68, "k2": 7.55, "e_value": 0.40,
     "hvid": 11.8, "epi_central": 51, "pupil": 2.9, "sph": -4.25, "cyl": -0.50,
     "add_target": 1.00, "design": Design.CF},
    {"patient_id": "PT-008", "age": 47, "eye": Eye.OS, "k1": 7.88, "k2": 7.75, "e_value": 0.46,
     "hvid": 11.9, "epi_central": 53, "pupil": 2.5, "sph": -1.00, "cyl": -0.25,
     "add_target": 0.75, "design": Design.CN},
    {"patient_id": "PT-009", "age": 41, "eye": Eye.OD, "k1": 7.75, "k2": 7.62, "e_value": 0.41,
     "hvid": 11.7, "epi_central": 49, "pupil": 3.1, "sph": -3.00, "cyl": -0.75,
     "add_target": 1.00, "design": Design.CF},
    {"patient_id": "PT-010", "age": 49, "eye": Eye.OS, "k1": 7.95, "k2": 7.82, "e_value": 0.52,
     "hvid": 12.0, "epi_central": 56, "pupil": 2.6, "sph": -1.50, "cyl": 0.00,
     "add_target": 1.25, "design": Design.CN},
]


def seed(reset: bool = False):
    """Populate database with initial patient data."""
    if reset:
        print("Dropping existing tables...")
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
    else:
        Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        existing = db.query(Patient).count()
        if existing > 0 and not reset:
            print(f"Database already has {existing} patients. Use --reset to re-seed.")
            return

        print(f"Seeding {len(PATIENTS_SEED)} patients...")
        for i, data in enumerate(PATIENTS_SEED):
            patient = Patient(**data)
            db.add(patient)
            db.flush()  # get patient.id

            # Run initial calculation
            params = calculate_lens_params(
                k1=data["k1"], k2=data["k2"], sph=data["sph"], cyl=data["cyl"],
                e_value=data["e_value"], hvid=data["hvid"],
                epi_central=data["epi_central"], pupil=data["pupil"],
                add_target=data["add_target"], design=data["design"].value,
                seed=i,
            )
            calc = Calculation(
                patient_id=patient.id,
                bozr1=params["bozr1"], bozr2=params["bozr2"],
                rc1=params["rc1"], rc2=params["rc2"],
                fa=params["fa"], pa=params["pa"], td=params["td"],
                predicted_add=params["predicted_add"],
                night_glare=params["night_glare"],
                fit_score=params["fit_score"],
            )
            db.add(calc)
            print(f"  [OK] {data['patient_id']} ({data['design'].value}) "
                  f"predicted ADD={params['predicted_add']}D")

        db.commit()
        print(f"\nDone. {len(PATIENTS_SEED)} patients seeded with initial calculations.")

    finally:
        db.close()


if __name__ == "__main__":
    reset = "--reset" in sys.argv
    seed(reset=reset)
