"""Tests for the lens parameter orchestrator."""

import pytest
from engine.lens_params import calculate_lens_params


class TestLensParams:
    """Verify integrated lens parameter calculation."""

    def test_returns_all_keys(self):
        result = calculate_lens_params(
            k1=7.82, k2=7.70, sph=-1.50, cyl=-0.25,
            e_value=0.44, hvid=11.8, epi_central=52,
            pupil=2.5, add_target=1.00, design='CN',
        )
        expected_keys = {
            'bozr1', 'bozr2', 'rc1', 'rc2', 'fa', 'pa', 'td',
            'predicted_add', 'actual_add', 'night_glare', 'fit_score',
        }
        assert set(result.keys()) == expected_keys

    def test_bozr1_less_than_bozr2_for_cn(self):
        """CN design: center steeper → BOZR1 < BOZR2."""
        result = calculate_lens_params(
            k1=7.82, k2=7.70, sph=-1.50, cyl=0,
            e_value=0.44, hvid=11.8, epi_central=52,
            pupil=2.5, add_target=1.00, design='CN',
        )
        assert result['bozr1'] < result['bozr2']

    def test_bozr1_greater_than_bozr2_for_cf(self):
        """CF design: center flatter → BOZR1 > BOZR2."""
        result = calculate_lens_params(
            k1=7.82, k2=7.70, sph=-1.50, cyl=0,
            e_value=0.44, hvid=11.8, epi_central=52,
            pupil=2.5, add_target=1.00, design='CF',
        )
        assert result['bozr1'] > result['bozr2']

    def test_cn_small_pupil_optimal_fit(self):
        """CN + small pupil → fit_score = '优'."""
        result = calculate_lens_params(
            k1=7.82, k2=7.70, sph=-1.50, cyl=0,
            e_value=0.44, hvid=11.8, epi_central=52,
            pupil=2.5, add_target=1.00, design='CN',
        )
        assert result['fit_score'] == '优'

    def test_cn_large_pupil_acceptable_fit(self):
        """CN + large pupil → fit_score = '可'."""
        result = calculate_lens_params(
            k1=7.82, k2=7.70, sph=-1.50, cyl=0,
            e_value=0.44, hvid=11.8, epi_central=52,
            pupil=3.5, add_target=1.00, design='CN',
        )
        assert result['fit_score'] == '可'

    def test_td_based_on_hvid(self):
        """Total diameter ≈ HVID - 0.8."""
        result = calculate_lens_params(
            k1=7.82, k2=7.70, sph=-1.50, cyl=0,
            e_value=0.44, hvid=12.0, epi_central=52,
            pupil=2.5, add_target=1.00, design='CN',
        )
        assert result['td'] == 11.2
