"""BOZR (Back Optic Zone Radius) calculation for CF and CN designs."""

from typing import NamedTuple
from engine.cornea import avg_keratometry, delta_radius_for_power


class BOZR(NamedTuple):
    bozr1: float   # mm, central zone
    bozr2: float   # mm, para-central zone


def calculate_bozr(
    k1: float,
    k2: float,
    sph: float,
    design: str,
    add_target: float,
) -> BOZR:
    """
    Calculate back optic zone radii for multifocal OK lenses.

    CF (Center-Far):
        Central zone flattens to correct myopia.
        Para-central zone steepens slightly to produce ADD.

    CN (Center-Near):
        Central zone preserves ADD (steeper).
        Para-central zone corrects distance vision.

    Args:
        k1: Flat keratometry (mm).
        k2: Steep keratometry (mm).
        sph: Spherical refraction (D, negative for myopia).
        design: 'CF' or 'CN'.
        add_target: Desired ADD power (D).

    Returns:
        BOZR named tuple (bozr1, bozr2).
    """
    avg_k = avg_keratometry(k1, k2)
    abs_sph = abs(sph)

    if design == 'CF':
        # Central: flatten to correct myopia
        bozr1 = avg_k + delta_radius_for_power(avg_k, abs_sph)
        # Para-central: steepen for ADD
        delta_r = delta_radius_for_power(avg_k, add_target)
        bozr2 = bozr1 - delta_r
    elif design == 'CN':
        # Base radius for full distance correction
        bozr_far = avg_k + delta_radius_for_power(avg_k, abs_sph)
        delta_r = delta_radius_for_power(avg_k, add_target)
        # Central: steeper to create ADD mound
        bozr1 = bozr_far - delta_r
        # Para-central: distance correction
        bozr2 = bozr_far
    else:
        raise ValueError(f"Unknown design: {design}. Use 'CF' or 'CN'.")

    return BOZR(bozr1=round(bozr1, 2), bozr2=round(bozr2, 2))
