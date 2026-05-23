"""Tests for ADD prediction model."""

import pytest
from engine.add_predict import predict_add


class TestADDPrediction:
    """Verify ADD predictions match the original JS implementation."""

    def test_cf_prediction_low_myopia(self):
        """
        CF with low myopia (−1.50D): epithelial reserve too small.
        This is the CORRECT clinical finding: CF design fails for
        low myopes because there isn't enough central thinning to
        redistribute into the para-central ADD mound.
        """
        result = predict_add(
            k1=7.82, k2=7.70, sph=-1.50, e_value=0.44,
            epi_central=52, pupil=2.5, design='CF', add_target=1.00,
            seed=42,
        )
        # Very low prediction: CF can't deliver ADD for low myopia
        assert result.predicted_add < 0.15

    def test_cf_prediction_moderate_myopia_higher(self):
        """CF with -4.00D: more epithelial reserve → higher ADD."""
        result = predict_add(
            k1=7.65, k2=7.55, sph=-4.00, e_value=0.38,
            epi_central=50, pupil=2.8, design='CF', add_target=1.00,
            seed=42,
        )
        # Still limited, but better than -1.50D
        assert 0.05 < result.predicted_add < 0.20

    def test_cf_high_myopia_better_add(self):
        """CF at -8.00D: sufficient epithelial reserve for meaningful ADD."""
        # This is the clinical sweet spot for CF design
        result = predict_add(
            k1=7.80, k2=7.70, sph=-8.00, e_value=0.42,
            epi_central=52, pupil=2.6, design='CF', add_target=1.00,
            seed=42,
        )
        assert result.predicted_add > 0.12

    def test_cn_prediction_small_pupil(self):
        """CN with small pupil: typical prediction."""
        result = predict_add(
            k1=7.82, k2=7.70, sph=-1.50, e_value=0.44,
            epi_central=52, pupil=2.5, design='CN', add_target=1.00,
            seed=42,
        )
        # k_coef=0.858, pupil_penalty=1.0, predicted≈0.83
        assert 0.78 < result.predicted_add < 0.90

    def test_cn_prediction_large_pupil_penalty(self):
        """CN with large pupil: penalized by pupil size."""
        result_small = predict_add(
            k1=7.82, k2=7.70, sph=-1.50, e_value=0.44,
            epi_central=52, pupil=2.5, design='CN', add_target=1.00,
            seed=42,
        )
        result_large = predict_add(
            k1=7.82, k2=7.70, sph=-1.50, e_value=0.44,
            epi_central=52, pupil=3.5, design='CN', add_target=1.00,
            seed=42,
        )
        assert result_large.predicted_add < result_small.predicted_add

    def test_seed_reproducibility(self):
        """Same inputs + same seed → same output."""
        a = predict_add(7.82, 7.70, -1.50, 0.44, 52, 2.5, 'CN', 1.00, seed=12345)
        b = predict_add(7.82, 7.70, -1.50, 0.44, 52, 2.5, 'CN', 1.00, seed=12345)
        assert a.predicted_add == b.predicted_add
        assert a.actual_add == b.actual_add

    def test_cf_ratio_never_exceeds_target(self):
        """CF predicted ADD should never exceed target."""
        for sph in [-0.50, -1.50, -4.00, -8.00]:
            result = predict_add(
                k1=7.80, k2=7.70, sph=sph, e_value=0.42,
                epi_central=52, pupil=2.6, design='CF', add_target=2.50,
                seed=1,
            )
            assert result.predicted_add <= 2.50

    def test_unknown_design_raises(self):
        with pytest.raises(ValueError, match="Unknown design"):
            predict_add(7.80, 7.70, -1.50, 0.42, 52, 2.6, 'XX', 1.00)
