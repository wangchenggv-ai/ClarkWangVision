# Central Near-Vision (CN) Design Ortho-K Lens — R&D Test Report

> **Objective:** Determine whether the CN-design lens delivers meaningfully better near vision than a standard Ortho-K lens, and identify the parameter sensitivities that drive the near-vision response.

---

## 1. Test Objectives

1. Verify whether the CN-design lens improves near vision compared to a standard Ortho-K lens.
2. Change only one parameter per iteration, and compare the four-way response: distance-with-lens, near-with-lens, distance-post-removal, near-post-removal.

---

## 2. Test Subject

| Eye | Myopia Level | Spherical Equivalent | Dominant Eye |
|:---:|:---:|:---:|:---:|
| Right (OD) | Low myopia | ≈ −2.00 D | Yes |
| Left (OS) | High myopia | ≈ −5.50 D | No |

Each eye was tuned independently, forming two parallel iteration tracks:
**OD → Low-Myopia Track** · **OS → High-Myopia Track** · 5 rounds each.

---

## 3. Method

Baseline = prior distance-only design parameters. CN lenses were fabricated, and in each round **one** variable was changed (C factor / ADD / Power). Four outcomes were recorded per round:

- **Distance vision with lens on** (on-lens distance)
- **Near vision with lens on** (on-lens near)
- **Distance vision after removal** (post-removal distance)
- **Near vision after removal** (post-removal near)

---

## 4. OD Iteration Track — Low Myopia (≈ −2.00 D)

|  #  |  BC   | Power | Dia. |    ADD    | C factor |  Change  | On-lens Distance |          On-lens Near           |               Post-removal Distance               | Post-removal Near                                   |
| :-: | :---: | :---: | :--: | :-------: | :------: | :------: | :--------------: | :-----------------------------: | :-----------------------------------------------: | --------------------------------------------------- |
| R1  | 44.25 | −1.25 | 10.6 |   +1.5D   |   4.0    | Baseline |    Very good     | Slightly better than prior MCOK |                     Very good                     | Baseline; near below expectation                    |
| R2  | 44.25 | −1.25 | 10.6 |   +1.5D   | **6.0**  |   C ↑    |    No effect     |                —                | Better than prior (prior MCOK was over-corrected) | C↑ no negative impact on distance; near ~same as R1 |
| R3  | 44.25 | −1.25 | 10.6 | **+2.5D** |   6.0    |  ADD ↑   |      Clear       |           Holding up            |                0.8 (next-day wear)                | ADD↑ improved near (next-day wear)                  |
| R4  | 44.25 | −1.25 | 10.6 |   +2.5D   | **4.0**  |   C ↓    |      Clear       |          Similar to R3          |                         —                         | C 6.0 → 4.0: negligible difference                  |
| R5  | 44.25 | −1.25 | 10.6 |   +2.5D   | **1.0**  |   C ↓↓   |     Mediocre     |              Worse              |                         —                         | C too low; near degrades                            |

### OD Summary

- Toggling C factor between 4.0 ↔ 6.0 produced little observable difference in either distance or near → **low myopia appears C-factor-insensitive within this range**.
- Pushing C factor to the extreme (1.0) clearly worsened near → **a lower bound exists**.
- Raising ADD from +1.5 D → +2.5 D improved near on next-day wear; usable at normal reading distance but not equivalent to +2.5 D reading glasses.
- Overall, near vision was **modestly better** than a standard Ortho-K lens, **but did not reach the target outcome**.

---

## 5. OS Iteration Track — High Myopia (≈ −5.50 D)

|  #  |  BC   |   Power   | Dia. |  ADD  | C factor |  Change  |         On-lens Distance         |       On-lens Near        | Post-removal Distance | Post-removal Near                                  |
| :-: | :---: | :-------: | :--: | :---: | :------: | :------: | :------------------------------: | :-----------------------: | :-------------------: | -------------------------------------------------- |
| L1  | 44.00 |   −4.75   | 10.6 | +2.5D |   4.0    | Baseline |               0.6                |        Comfortable        | 0.6 (under-corrected) | Affected by sleep and wear duration                |
| L2  | 44.00 | **−6.00** | 10.6 | +2.5D |   4.0    | Power ↑↑ | Blurry (small-ring interference) |           Poor            |          1.2          | Multi-focal sensation at near                      |
| L3  | 44.00 | **−5.25** | 10.6 | +2.5D |   4.0    | Power ↓  |              Clear               |           Poor            |    0.8 (2 nights)     | Distance clear after down-titration; near mediocre |
| L4  | 44.00 |   −5.25   | 10.6 | +2.5D | **6.0**  |   C ↑    |              Clear               | Clear, better than before |         Good          | C↑ improved both distance and near                 |
| L5  | 44.00 |   −5.25   | 10.6 | +2.5D | **10.0** |   C ↑↑   |              Worse               |      No improvement       |           —           | C too high; distance degrades, near no lift        |

### OS Summary

- **Power path:** −4.75 → −6.00 (over-corrected, back off) → −5.25 (balance point).
- **C factor path:** 4.0 → 6.0 (improved) → 10.0 (degraded) → **high myopia is C-factor-sensitive with an apparent optimum near 6.0**.

---

## 6. Cross-Comparison

| Dimension | OD (Low Myopia) | OS (High Myopia) |
|---|---|---|
| **C factor sensitivity** | Low — 4.0 ↔ 6.0 indistinguishable; only breaks at 1.0 | High — 4.0 → 6.0 improves, 6.0 → 10.0 reverses |
| **C factor optimum** | ≥ 4.0 sufficient; no need to push higher | ~ 6.0 |
| **ADD effect** | Core variable; +2.5 D improves near | Not isolated (held at +2.5 D throughout) |
| **Power tuning** | Not adjusted (−1.25 stable) | Fine-tuning required; narrow window |

---

## 7. Overall Findings *(AI-generated synthesis — to be reviewed)*

1. **ADD is the primary driver of near vision.** Effect was clearest on the low-myopia eye (R2 → R3).
2. **C factor sensitivity is power-dependent.** Low myopia tolerates a wide C-factor range (4.0–6.0 ≈ equivalent); high myopia shows a narrow optimum near 6.0, with 10.0 actively degrading distance.
3. **C factor also affects lens cosmesis** — the higher the C, the more visible the central ring (barely visible at 1.0 → prominent at 10.0).
4. **High myopia has a narrower tuning window** on both axes — both power over-correction (−6.00) and excessive C factor (10.0) required back-off.

---

## 8. Open Questions & Critical Notes *(for review before acting on the findings)*


- **"Near did not reach expectation"** (OD summary) is a subjective endpoint. Before the next cycle, consider defining a quantitative near-vision threshold (e.g., reading acuity at 40 cm, or a specific J-value) so "meets expectation" is falsifiable.
- **ADD was never isolated on the high-myopia track.** Whether high myopia responds to ADD the way low myopia does remains untested.

---

*人是主驾，AI 是副驾 @Clark*
