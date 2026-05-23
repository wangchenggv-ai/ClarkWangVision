"""Tests for BOZR calculation engine."""

import pytest
from engine.bozr import calculate_bozr


class TestBOZR:
    """Verify BOZR calculations match the original JS implementation."""

    def test_cf_design_basic(self):
        """CF: PT-001 parameters (low myopia -1.50D)."""
        bozr = calculate_bozr(k1=7.82, k2=7.70, sph=-1.50, design='CF', add_target=1.00)
        # avgK=7.76, ΔR_sph=7.76²×1.5/337.5≈0.268 → BOZR1=8.0276→8.03, BOZR2=7.85
        assert bozr.bozr1 == 8.03
        assert bozr.bozr2 == 7.85

    def test_cf_design_moderate_myopia(self):
        """CF: PT-002 parameters (-4.00D)."""
        bozr = calculate_bozr(k1=7.65, k2=7.55, sph=-4.00, design='CF', add_target=1.00)
        # avgK=7.60, BOZR1=7.60+0.685=8.285→8.28, BOZR2=8.28-0.171=8.11
        assert bozr.bozr1 == 8.28
        assert bozr.bozr2 == 8.11

    def test_cn_design_basic(self):
        """CN: PT-001 parameters (-1.50D)."""
        bozr = calculate_bozr(k1=7.82, k2=7.70, sph=-1.50, design='CN', add_target=1.00)
        # avgK=7.76, BOZR_far=8.03, BOZR1=7.85, BOZR2=8.03
        assert bozr.bozr1 == 7.85
        assert bozr.bozr2 == 8.03

    def test_cn_design_small_pupil(self):
        """CN: PT-008 parameters (-1.00D, small pupil 2.5mm)."""
        bozr = calculate_bozr(k1=7.88, k2=7.75, sph=-1.00, design='CN', add_target=0.75)
        # avgK=7.815, BOZR_far=8.00, BOZR1=7.86, BOZR2=8.00
        assert bozr.bozr1 == 7.86
        assert bozr.bozr2 == 8.00

    def test_invalid_design_raises(self):
        with pytest.raises(ValueError, match="Unknown design"):
            calculate_bozr(7.80, 7.70, -1.50, 'XX', 1.00)

    def test_bozr1_always_positive(self):
        """BOZR radii should always be positive for realistic inputs."""
        bozr = calculate_bozr(7.00, 7.00, -10.00, 'CF', 3.00)
        assert bozr.bozr1 > 0
        assert bozr.bozr2 > 0
