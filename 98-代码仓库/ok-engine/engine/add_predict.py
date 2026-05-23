"""ADD prediction model for multifocal OK lenses."""

import random
from typing import NamedTuple

from engine.cornea import avg_keratometry, delta_radius_for_power


class ADDPrediction(NamedTuple):
    predicted_add: float  # D, model prediction
    actual_add: float     # D, simulated actual (with noise)


def predict_add(
    k1: float,
    k2: float,
    sph: float,
    e_value: float,
    epi_central: float,
    pupil: float,
    design: str,
    add_target: float,
    seed: int = None,
) -> ADDPrediction:
    """
    Predict achievable ADD for a given patient.

    The model combines:
    - Epithelial plasticity coefficient (k_coef), influenced by central
      epithelial thickness and corneal eccentricity.
    - For CF: ADD comes from para-central epithelial mounding after central
      flattening. Limited by available epithelial reserve (|sph|).
    - For CN: ADD is built into the central zone curvature directly. Less
      dependent on epithelial reserve, more sensitive to pupil size.
    - Simulated measurement noise for realism.

    Args:
        k1, k2: Keratometry (mm).
        sph: Sphere (D, negative).
        e_value: Corneal eccentricity.
        epi_central: Central epithelial thickness (μm).
        pupil: Photopic pupil diameter (mm).
        design: 'CF' or 'CN'.
        add_target: Desired ADD (D).
        seed: Optional random seed for reproducibility.

    Returns:
        ADDPrediction named tuple (predicted_add, actual_add).
    """
    # Epithelial plasticity coefficient
    k_coef = 0.82 + (epi_central - 50.0) * 0.008 + e_value * 0.05

    avg_k = avg_keratometry(k1, k2)

    if design == 'CF':
        # ADD from para-central epithelial mounding
        epithelial_reserve = abs(sph) * 3.8  # μm available
        peak_mound = epithelial_reserve * k_coef * 0.55
        delta_r = delta_radius_for_power(avg_k, add_target)
        # ADD achievement ratio: limited by mound height vs required ΔR
        ratio = min(1.0, peak_mound / max(delta_r * 450, 0.001))
        predicted = add_target * ratio * 0.92
    elif design == 'CN':
        # ADD built into central zone curvature directly
        if pupil > 3.0:
            pupil_penalty = 0.85
        elif pupil > 2.8:
            pupil_penalty = 0.92
        else:
            pupil_penalty = 1.0
        predicted = add_target * k_coef * pupil_penalty * 0.97
    else:
        raise ValueError(f"Unknown design: {design}")

    predicted_add = round(predicted, 2)

    # Simulated measurement noise
    rng = random.Random(seed)
    noise = (rng.random() - 0.5) * 0.15
    actual_add = round(predicted_add + noise, 2)

    return ADDPrediction(predicted_add=predicted_add, actual_add=actual_add)
