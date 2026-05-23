"""Corneal geometry utilities."""

import math
from typing import Tuple


def avg_keratometry(k1: float, k2: float) -> float:
    """Mean corneal curvature radius in mm."""
    return (k1 + k2) / 2.0


def corneal_power(radius_mm: float, refractive_index: float = 1.3375) -> float:
    """Convert radius (mm) to dioptric power using the keratometric index."""
    if radius_mm == 0:
        return 0.0
    return (refractive_index - 1.0) * 1000.0 / radius_mm


def radius_from_power(power_d: float, refractive_index: float = 1.3375) -> float:
    """Convert dioptric power to radius (mm)."""
    if power_d == 0:
        return float('inf')
    return (refractive_index - 1.0) * 1000.0 / power_d


def delta_radius_for_power(avg_k_mm: float, delta_d: float) -> float:
    """
    Approximate the radius change needed to produce a given power change.

    Based on the clinical approximation: ΔR ≈ (R² × ΔD) / 337.5
    where R is the base radius in mm and ΔD is the desired power change in D.

    Returns the radius adjustment (positive = flatter).
    """
    return (avg_k_mm * avg_k_mm * abs(delta_d)) / 337.5
