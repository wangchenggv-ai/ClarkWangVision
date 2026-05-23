"""Epithelial redistribution profile models for multifocal OK lenses.

Defines the Profile protocol (r → thickness) and provides two implementations:
- ParametricProfile: Gaussian-superposition model from K/e/sphere parameters.
- Future: TopographyProfile from real corneal height maps.

All profile functions are callables that take radial distance (mm) and return
epithelial thickness (μm).
"""

import math
from typing import Protocol, Callable


# ── Profile protocol ─────────────────────────────────────────────────────

class Profile(Protocol):
    """Callable: radial distance (mm) → epithelial thickness (μm)."""
    def __call__(self, r: float) -> float: ...


ProfileFn = Callable[[float], float]


# ── Gaussian helpers ─────────────────────────────────────────────────────

def gaussian(r: float, center: float, sigma: float, amplitude: float) -> float:
    """Gaussian component: amplitude × exp(-((r-center)/sigma)²)."""
    return amplitude * math.exp(-((r - center) / sigma) ** 2)


# ── Parametric profiles ──────────────────────────────────────────────────

def build_cf_profile(
    sph: float,
    epi_central: float,
    add_target: float,
    e_value: float = 0.42,
) -> ProfileFn:
    """
    CF (Center-Far) epithelial profile.

    Features:
    - Central thinning proportional to myopia (corrective flattening)
    - Para-central peak at ~2.0 mm for ADD
    - Outer ring for peripheral defocus control

    Args:
        sph: Sphere (D, negative for myopia).
        epi_central: Baseline central epithelial thickness (μm).
        add_target: Desired ADD (D).
        e_value: Corneal eccentricity (for scaling, reserved).

    Returns:
        Callable r (mm) → thickness (μm).
    """
    abs_s = abs(sph)

    def profile(r: float) -> float:
        central = -abs_s * 3.8 * gaussian(r, 0.0, 1.2, 1.0)
        add_peak = abs_s * 3.8 * 0.55 * gaussian(r, 2.0, 0.65, 1.0)
        outer = abs_s * 1.2 * gaussian(r, 3.3, 0.5, 1.0)
        return epi_central + central + add_peak + outer

    return profile


def build_cn_profile(
    sph: float,
    epi_central: float,
    add_target: float,
    e_value: float = 0.42,
) -> ProfileFn:
    """
    CN (Center-Near) epithelial profile.

    Features:
    - Central ADD mound (epithelial thickening)
    - Para-central thinning at ~2.2 mm for distance correction
    - Outer ring for peripheral defocus control

    Args:
        sph: Sphere (D, negative for myopia).
        epi_central: Baseline central epithelial thickness (μm).
        add_target: Desired ADD (D).
        e_value: Corneal eccentricity (for scaling, reserved).

    Returns:
        Callable r (mm) → thickness (μm).
    """
    abs_s = abs(sph)

    def profile(r: float) -> float:
        add_mound = add_target * 9.0 * gaussian(r, 0.0, 1.1, 1.0)
        far_trough = -abs_s * 4.5 * gaussian(r, 2.2, 0.75, 1.0)
        outer = 2.5 * gaussian(r, 3.5, 0.5, 1.0)
        return epi_central + add_mound + far_trough + outer

    return profile


# ── Profile factory ──────────────────────────────────────────────────────

def build_profile(
    design: str,
    sph: float,
    epi_central: float,
    add_target: float,
    e_value: float = 0.42,
    profile_source: str = "parametric",
) -> ProfileFn:
    """
    Factory: return the appropriate epithelial profile function.

    Args:
        design: 'CF' or 'CN'.
        sph: Sphere (D, negative).
        epi_central: Central epithelial thickness (μm).
        add_target: Desired ADD (D).
        e_value: Corneal eccentricity.
        profile_source: 'parametric' (default) or 'topography' (future).

    Returns:
        Callable r (mm) → thickness (μm).
    """
    if profile_source == "topography":
        raise NotImplementedError(
            "Topography-based profiles will be supported in Phase 5."
        )

    builders = {
        'CF': build_cf_profile,
        'CN': build_cn_profile,
    }

    if design not in builders:
        raise ValueError(f"Unknown design: {design}. Use 'CF' or 'CN'.")

    return builders[design](
        sph=sph,
        epi_central=epi_central,
        add_target=add_target,
        e_value=e_value,
    )
