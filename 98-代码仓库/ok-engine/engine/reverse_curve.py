"""Reverse curve (RC) calculation."""

from typing import NamedTuple


class ReverseCurve(NamedTuple):
    rc1: float  # mm, inner reverse curve
    rc2: float  # mm, outer reverse curve


def calculate_rc(
    bozr1: float,
    design: str,
    add_target: float,
    epi_central: float,
) -> ReverseCurve:
    """
    Calculate reverse curve radii.

    The reverse curve is deeper than BOZR to drive epithelial redistribution.
    CN designs use slightly deeper RC1 to enhance the central ADD formation.

    Args:
        bozr1: Central BOZR radius (mm).
        design: 'CF' or 'CN'.
        add_target: ADD target (D) — reserved for future refinement.
        epi_central: Central epithelial thickness (μm).

    Returns:
        ReverseCurve named tuple (rc1, rc2).
    """
    rc1_base = bozr1 - 0.85
    if design == 'CN':
        rc1 = rc1_base - 0.05  # slightly deeper for CN central mound
    else:
        rc1 = rc1_base

    rc2 = rc1 + 0.40

    return ReverseCurve(rc1=round(rc1, 2), rc2=round(rc2, 2))
