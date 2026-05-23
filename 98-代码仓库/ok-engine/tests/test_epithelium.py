"""Tests for epithelial profile models."""

import math
import pytest
from engine.epithelium import (
    gaussian,
    build_cf_profile,
    build_cn_profile,
    build_profile,
)


class TestGaussian:
    def test_peak_at_center(self):
        """Gaussian centered at 0: peak = amplitude."""
        assert gaussian(0.0, 0.0, 1.0, 5.0) == pytest.approx(5.0)

    def test_decay_at_sigma(self):
        """At 1σ, value ≈ amplitude × e⁻¹."""
        val = gaussian(1.0, 0.0, 1.0, 1.0)
        assert val == pytest.approx(math.exp(-1.0), rel=1e-3)

    def test_zero_far_away(self):
        """Far from center, gaussian ≈ 0."""
        assert gaussian(10.0, 0.0, 0.5, 1.0) < 1e-10


class TestCFProfile:
    def test_central_thinning(self):
        """CF: center is thinner than baseline."""
        profile = build_cf_profile(sph=-1.50, epi_central=50, add_target=1.00)
        assert profile(0.0) < 50.0

    def test_add_peak_exists(self):
        """CF: there is a para-central peak for ADD."""
        profile = build_cf_profile(sph=-4.00, epi_central=50, add_target=1.00)
        # Peak should be around r=2.0
        assert profile(2.0) > profile(1.0)
        assert profile(2.0) > profile(3.0)

    def test_deeper_myopia_deeper_thinning(self):
        """More myopia → more central thinning."""
        low = build_cf_profile(sph=-1.00, epi_central=50, add_target=1.00)
        high = build_cf_profile(sph=-6.00, epi_central=50, add_target=1.00)
        assert high(0.0) < low(0.0)

    def test_returns_base_at_large_r(self):
        """At large radius, profile returns to baseline."""
        profile = build_cf_profile(sph=-4.00, epi_central=50, add_target=1.00)
        assert profile(5.0) == pytest.approx(50.0, abs=1.0)


class TestCNProfile:
    def test_central_mound(self):
        """CN: center is thicker than baseline."""
        profile = build_cn_profile(sph=-1.50, epi_central=50, add_target=1.00)
        assert profile(0.0) > 50.0

    def test_add_mound_scales_with_target(self):
        """Higher ADD target → higher central mound."""
        low_add = build_cn_profile(sph=-1.50, epi_central=50, add_target=0.75)
        high_add = build_cn_profile(sph=-1.50, epi_central=50, add_target=2.00)
        assert high_add(0.0) > low_add(0.0)

    def test_far_trough_exists(self):
        """CN: para-central region shows thinning for distance correction."""
        profile = build_cn_profile(sph=-4.00, epi_central=50, add_target=1.00)
        assert profile(2.2) < 50.0


class TestBuildProfile:
    def test_factory_cf(self):
        fn = build_profile('CF', sph=-1.50, epi_central=50, add_target=1.00)
        assert callable(fn)
        assert fn(0.0) < 50.0

    def test_factory_cn(self):
        fn = build_profile('CN', sph=-1.50, epi_central=50, add_target=1.00)
        assert callable(fn)
        assert fn(0.0) > 50.0

    def test_topography_not_implemented(self):
        with pytest.raises(NotImplementedError):
            build_profile('CF', sph=-1.50, epi_central=50, add_target=1.00,
                          profile_source='topography')
