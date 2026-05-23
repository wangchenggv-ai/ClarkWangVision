"""Lens parameter orchestrator — combines all calculation modules.

Mirrors the JS lensParams() function: given patient data, produce
a complete set of lens design parameters and predictions.
"""

from typing import Dict, Any
from engine.bozr import calculate_bozr
from engine.reverse_curve import calculate_rc
from engine.add_predict import predict_add


def calculate_lens_params(
    k1: float,
    k2: float,
    sph: float,
    cyl: float,
    e_value: float,
    hvid: float,
    epi_central: float,
    pupil: float,
    add_target: float,
    design: str,
    seed: int = None,
) -> Dict[str, Any]:
    """
    Compute full lens design parameters for a patient.

    Args:
        k1, k2: Keratometry (mm).
        sph: Sphere (D, negative for myopia).
        cyl: Cylinder (D, negative or zero).
        e_value: Corneal eccentricity.
        hvid: Horizontal visible iris diameter (mm).
        epi_central: Central epithelial thickness (μm).
        pupil: Photopic pupil diameter (mm).
        add_target: Desired ADD power (D).
        design: 'CF' or 'CN'.
        seed: Optional random seed for ADD prediction noise.

    Returns:
        Dict with all computed lens parameters.
    """
    # 1. BOZR
    bozr = calculate_bozr(k1, k2, sph, design, add_target)

    # 2. Reverse curves
    rc = calculate_rc(bozr.bozr1, design, add_target, epi_central)

    # 3. Fitting arc (定位弧)
    fa = round(bozr.bozr2 + 1.25, 2)

    # 4. Peripheral arc — standard
    pa = 12.5

    # 5. Total diameter — based on HVID
    td = round(hvid - 0.8, 1)

    # 6. ADD prediction
    add_pred = predict_add(
        k1=k1, k2=k2, sph=sph, e_value=e_value,
        epi_central=epi_central, pupil=pupil,
        design=design, add_target=add_target, seed=seed,
    )

    # 7. Clinical assessments
    if design == 'CF':
        night_glare = '高' if abs(sph) > 3 else '中'
    else:
        night_glare = '高' if pupil > 3.0 else '低'

    if design == 'CN' and pupil <= 2.8:
        fit_score = '优'
    elif design == 'CN':
        fit_score = '可'
    else:
        fit_score = '优'

    return {
        'bozr1': bozr.bozr1,
        'bozr2': bozr.bozr2,
        'rc1': rc.rc1,
        'rc2': rc.rc2,
        'fa': fa,
        'pa': pa,
        'td': td,
        'predicted_add': add_pred.predicted_add,
        'actual_add': add_pred.actual_add,
        'night_glare': night_glare,
        'fit_score': fit_score,
    }
